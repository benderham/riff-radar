/**
 * The model, over the provider's OpenAI-compatible endpoint.
 *
 * Built-in `fetch`, no provider SDK (ADR-0014): the SDK's retry and streaming
 * machinery would hide the request and response shape, which is part of what
 * this project sets out to make visible. So the mapping between our message
 * shape and the wire format lives here, in the open, and is the only code that
 * knows either.
 *
 * Whether the provider reports a cached-token breakdown decides whether cost is
 * a measurement or a ceiling: when `prompt_tokens_details.cached_tokens` is
 * absent, every input token is priced as uncached and the run is labelled as an
 * upper bound (ADR-0020).
 */

import { MODEL_ENDPOINT, MODEL_ID } from '../../config.ts'
import { categoriseFailure, withCategory } from '../domain/failure.ts'
import type { ModelMessage, ModelPort, ModelResponse, ProposedToolCall } from '../ports.ts'

/** Our message shape as the OpenAI-compatible endpoint wants it. */
const wireMessage = (message: ModelMessage): Record<string, unknown> => ({
  role: message.role,
  content: message.content,
  ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId }),
  ...(message.toolCalls === undefined
    ? {}
    : {
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.argumentsJson },
        })),
      }),
})

interface WireResponse {
  choices?: {
    message?: {
      content?: string | null
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[]
    }
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
  }
}

/**
 * A request that never got an answer, told apart from one that came back badly.
 *
 * Named and shaped as the `http` adapter's own `attempted`, and for the same
 * reason: a dead socket and a wrong key are both `model_error` in the trace,
 * and only the category says which one stopped the run. The message is left
 * exactly as it was, because what it says is not this ticket's business.
 */
const attempted = async (request: () => Promise<Response>): Promise<Response> => {
  try {
    return await request()
  } catch (error) {
    throw withCategory(error as Error, 'transient')
  }
}

export const fireworksModel = (apiKey: string): ModelPort => ({
  async complete({ messages, tools }) {
    // The model is the one provider not reached through the `http` port, so the
    // contract that an unanswered request is a fact rather than a mystery
    // (ADR-0043) is kept here by hand: it still throws, because a run cannot
    // continue without a model, but it throws saying what kind of thing failed.
    const response = await attempted(() => fetch(MODEL_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      // Tool definitions and the stable prefix lead; the per-step history is
      // appended to `messages` and never inserted ahead of it.
      body: JSON.stringify({
        model: MODEL_ID,
        tools: tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        tool_choice: 'auto',
        // One action per step is the loop's shape, and the model does not
        // honour the prompt's request for it: left to itself it proposes all
        // three source fetches at once, which the loop refuses as an invalid
        // action. Asking the provider is the reliable half of that guardrail.
        parallel_tool_calls: false,
        messages: messages.map(wireMessage),
      }),
    }))

    if (!response.ok) {
      // The body can carry provider detail worth having, and carries no secret
      // of ours: the key travels in the request, never in the reply.
      const detail = await response.text().catch(() => '')
      // A model failure ends the run as `tool_failure`, which says only that it
      // could not continue. The category is what says whether the provider was
      // busy or the key was wrong, and it is knowable only here (ADR-0048).
      throw withCategory(
        new Error(`model request failed: ${response.status} ${response.statusText} ${detail}`.trim()),
        categoriseFailure(response.status, detail),
      )
    }

    const body = (await response.json()) as WireResponse
    const message = body.choices?.[0]?.message

    const toolCalls: ProposedToolCall[] = (message?.tool_calls ?? []).map((call, index) => ({
      id: call.id ?? `call-${index}`,
      // Untrusted, both of them: validated against the action schema before
      // anything is dispatched.
      name: call.function?.name ?? '',
      argumentsJson: call.function?.arguments ?? '',
    }))

    const promptTokens = body.usage?.prompt_tokens ?? 0
    const cachedTokens = body.usage?.prompt_tokens_details?.cached_tokens
    const cacheReported = typeof cachedTokens === 'number'

    return {
      content: message?.content ?? '',
      toolCalls,
      usage: {
        uncachedInputTokens: promptTokens - (cacheReported ? cachedTokens : 0),
        cachedInputTokens: cacheReported ? cachedTokens : 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
      },
      cacheReported,
      raw: body,
    } satisfies ModelResponse
  },
})
