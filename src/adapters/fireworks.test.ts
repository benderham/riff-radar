import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

import { PRICE_PER_MILLION } from '../../config.ts'
import { estimateCost } from '../domain/cost.ts'
import { toolDefinitions } from '../tools.ts'
import { fireworksModel } from './fireworks.ts'

/** A response body as the provider sends one, with the usage block varied. */
const body = (usage: Record<string, unknown>) => ({
  id: 'chatcmpl-1',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_abc',
            type: 'function',
            function: { name: 'fetch_source', arguments: '{"source_id": "aoty"}' },
          },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ],
  usage,
})

/** Replaces the global `fetch` for one test and hands back what it was called with. */
const stubFetch = (response: { ok?: boolean; status?: number; body: unknown }) => {
  const calls: { url: string; init: RequestInit }[] = []

  mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      statusText: 'OK',
      json: async () => response.body,
      text: async () => JSON.stringify(response.body),
    } as unknown as Response
  })

  return calls
}

test.afterEach(() => mock.restoreAll())

const messages = [
  { role: 'system' as const, content: 'stable prefix' },
  { role: 'user' as const, content: 'the brief' },
]

test('a reported cache breakdown is split into cached and uncached input', async () => {
  stubFetch({
    body: body({
      prompt_tokens: 5000,
      completion_tokens: 40,
      prompt_tokens_details: { cached_tokens: 4800 },
    }),
  })

  const response = await fireworksModel('fw-key').complete({ messages, tools: toolDefinitions })

  assert.equal(response.cacheReported, true)
  assert.deepEqual(response.usage, {
    uncachedInputTokens: 200,
    cachedInputTokens: 4800,
    outputTokens: 40,
  })
})

test('no cache breakdown prices every input token as uncached, and says so', async () => {
  stubFetch({ body: body({ prompt_tokens: 5000, completion_tokens: 40 }) })

  const response = await fireworksModel('fw-key').complete({ messages, tools: toolDefinitions })

  assert.equal(response.cacheReported, false)
  assert.deepEqual(response.usage, {
    uncachedInputTokens: 5000,
    cachedInputTokens: 0,
    outputTokens: 40,
  })
  // The point of the flag: this number is a ceiling, and a long way above the
  // same run priced with its cache hits counted.
  assert.ok(estimateCost(response.usage) > (5000 * PRICE_PER_MILLION.cachedInput) / 1_000_000)
})

test('a missing usage block is zero rather than a crash', async () => {
  stubFetch({ body: body({}) })

  const response = await fireworksModel('fw-key').complete({ messages, tools: toolDefinitions })
  assert.deepEqual(response.usage, {
    uncachedInputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  })
})

test('a tool call is carried through as untrusted text', async () => {
  stubFetch({ body: body({ prompt_tokens: 1, completion_tokens: 1 }) })

  const response = await fireworksModel('fw-key').complete({ messages, tools: toolDefinitions })

  assert.deepEqual(response.toolCalls, [
    { id: 'call_abc', name: 'fetch_source', argumentsJson: '{"source_id": "aoty"}' },
  ])
})

test('the request carries the key, the derived tool definitions and the messages in order', async () => {
  const calls = stubFetch({ body: body({ prompt_tokens: 1, completion_tokens: 1 }) })
  await fireworksModel('fw-key').complete({ messages, tools: toolDefinitions })

  const [call] = calls
  const headers = call?.init.headers as Record<string, string>
  assert.equal(headers['authorization'], 'Bearer fw-key')

  const sent = JSON.parse(String(call?.init.body))
  assert.equal(sent.model, 'accounts/fireworks/models/deepseek-v4p1-flash')
  assert.equal(sent.tools.length, 4)
  assert.equal(sent.tools[0].function.name, 'fetch_source')
  assert.ok(sent.tools[0].function.parameters, 'the derived JSON schema travels with the tool')
  assert.deepEqual(sent.messages, [
    { role: 'system', content: 'stable prefix' },
    { role: 'user', content: 'the brief' },
  ])
})

test('an assistant message with tool calls round-trips in the provider shape', async () => {
  const calls = stubFetch({ body: body({ prompt_tokens: 1, completion_tokens: 1 }) })

  await fireworksModel('fw-key').complete({
    messages: [
      ...messages,
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_abc', name: 'web_search', argumentsJson: '{"query": "x"}' }],
      },
      { role: 'tool', toolCallId: 'call_abc', content: 'nothing found' },
    ],
    tools: toolDefinitions,
  })

  const sent = JSON.parse(String(calls[0]?.init.body))
  assert.deepEqual(sent.messages[2].tool_calls, [
    { id: 'call_abc', type: 'function', function: { name: 'web_search', arguments: '{"query": "x"}' } },
  ])
  assert.equal(sent.messages[3].tool_call_id, 'call_abc')
})

test('a failed request throws with the provider status', async () => {
  stubFetch({ ok: false, status: 429, body: { error: 'rate limited' } })

  await assert.rejects(
    fireworksModel('fw-key').complete({ messages, tools: toolDefinitions }),
    /429/,
  )
})

test('a failed request never echoes the key', async () => {
  stubFetch({ ok: false, status: 401, body: { error: 'unauthorized' } })

  await assert.rejects(
    fireworksModel('fw-secret-key').complete({ messages, tools: toolDefinitions }),
    (error: Error) => !error.message.includes('fw-secret-key'),
  )
})
