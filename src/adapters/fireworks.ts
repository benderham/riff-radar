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

export const fireworksModel = (apiKey: string): ModelPort => ({
  async complete({ messages, tools }) {
    const response = await fetch(MODEL_ENDPOINT, {
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
    })

    if (!response.ok) {
      // The body can carry provider detail worth having, and carries no secret
      // of ours: the key travels in the request, never in the reply.
      const detail = await response.text().catch(() => '')
      throw new Error(`model request failed: ${response.status} ${response.statusText} ${detail}`.trim())
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
