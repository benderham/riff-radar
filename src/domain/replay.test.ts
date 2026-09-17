import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { TracedStep } from '../store/store.ts'
import { recordedModelResponse, replay } from './replay.ts'

const said = (content: string, ...calls: readonly { id: string; name: string; argumentsJson: string }[]) =>
  recordedModelResponse({ content, toolCalls: calls, raw: { provider: 'shape' } })

const traced = (over: Partial<TracedStep> = {}): TracedStep => ({
  kind: 'action',
  modelResponse: null,
  toolResult: null,
  error: null,
  candidatesAfter: null,
  uncachedInputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  ...over,
})

const fetched = traced({
  modelResponse: said('', { id: 'call-1', name: 'fetch_source', argumentsJson: '{"source_id":"loudwire"}' }),
  toolResult: '2 releases found',
  candidatesAfter: '[{"artist":"Ulcerate","title":"Cutting the Throat of God","releaseDates":[],"sourceUrls":[]}]',
  uncachedInputTokens: 100,
  cachedInputTokens: 20,
  outputTokens: 10,
})

test('an empty trace replays to nothing', () => {
  assert.deepEqual(replay([]), {
    messages: [],
    candidates: [],
    usage: { uncachedInputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
    consecutiveInvalid: 0,
  })
})

test('a dispatched action replays as the model saying it and the tool answering', () => {
  assert.deepEqual(replay([fetched]).messages, [
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call-1', name: 'fetch_source', argumentsJson: '{"source_id":"loudwire"}' }],
    },
    { role: 'tool', toolCallId: 'call-1', content: '2 releases found' },
  ])
})

// What the model said alongside its call is part of the history: dropping it
// would leave the resumed run reasoning from a conversation it never had.
test('the prose beside a tool call survives the round trip', () => {
  const step = traced({
    modelResponse: said('Fetching Loudwire first.', {
      id: 'call-1',
      name: 'fetch_source',
      argumentsJson: '{}',
    }),
    toolResult: 'ok',
  })
  assert.equal(replay([step]).messages[0]?.content, 'Fetching Loudwire first.')
})

test('an invalid action replays as the refusal the model was told', () => {
  const noAction = traced({
    kind: 'invalid_action',
    modelResponse: said('I think we should stop here.'),
    error: 'no action proposed; every step must call exactly one tool',
  })
  const badArguments = traced({
    kind: 'invalid_action',
    modelResponse: said('', { id: 'call-2', name: 'lookup_release', argumentsJson: 'not json' }),
    error: 'arguments are not JSON',
  })

  assert.deepEqual(replay([noAction]).messages, [
    { role: 'assistant', content: 'I think we should stop here.' },
    { role: 'user', content: 'Invalid action: no action proposed; every step must call exactly one tool' },
  ])
  assert.deepEqual(replay([badArguments]).messages[1], {
    role: 'tool',
    toolCallId: 'call-2',
    content: 'Invalid action, not dispatched: arguments are not JSON',
  })
})

// A step the loop broke on told the model nothing, so the resumed run simply
// takes it again. Replaying the half of it that exists would leave a proposed
// call with no answer, which is a conversation no provider accepts.
test('a step that never answered the model is dropped whole', () => {
  for (const kind of ['tool_error', 'model_error', 'finish', 'notion_write'] as const) {
    const step = traced({
      kind,
      modelResponse: said('', { id: 'call-3', name: 'fetch_source', argumentsJson: '{}' }),
      toolResult: 'half a thing',
    })
    assert.deepEqual(replay([fetched, step]).messages, replay([fetched]).messages, kind)
  }
})

test('what a step cost is counted whether or not it said anything to the model', () => {
  const failed = traced({ kind: 'tool_error', uncachedInputTokens: 7, cachedInputTokens: 3, outputTokens: 1 })

  assert.deepEqual(replay([fetched, failed]).usage, {
    uncachedInputTokens: 107,
    cachedInputTokens: 23,
    outputTokens: 11,
  })
})

test('the candidate list comes from the last step that recorded one', () => {
  const enriched = traced({
    modelResponse: said('', { id: 'call-4', name: 'lookup_release', argumentsJson: '{}' }),
    toolResult: 'looked up',
    candidatesAfter: JSON.stringify([
      {
        artist: 'Ulcerate',
        title: 'Cutting the Throat of God',
        releaseDates: ['2026-09-12'],
        sourceUrls: ['https://example.test/one'],
        lookup: { found: true, releaseGroupId: 'rg-1', secondaryTypes: [], artists: ['Ulcerate'] },
      },
    ]),
  })
  const later = traced({ kind: 'notion_write', candidatesAfter: null })

  // The `lookup` enrichment is the reason this column exists (ADR-0046): it is
  // the one thing no tool result contains, so it has to survive intact.
  assert.deepEqual(replay([fetched, enriched, later]).candidates, [
    {
      artist: 'Ulcerate',
      title: 'Cutting the Throat of God',
      releaseDates: ['2026-09-12'],
      sourceUrls: ['https://example.test/one'],
      lookup: { found: true, releaseGroupId: 'rg-1', secondaryTypes: [], artists: ['Ulcerate'] },
    },
  ])
})

test('the consecutive-invalid count is the trailing run of invalid actions', () => {
  const invalid = traced({ kind: 'invalid_action', modelResponse: said('no'), error: 'nope' })

  assert.equal(replay([invalid, invalid, fetched]).consecutiveInvalid, 0)
  assert.equal(replay([fetched, invalid, invalid]).consecutiveInvalid, 2)
  assert.equal(replay([invalid, fetched, invalid]).consecutiveInvalid, 1)
})

test('a trace that cannot be read is refused rather than half replayed', () => {
  assert.throws(() => replay([traced({ modelResponse: '{ truncated' })]), /cannot be replayed/)
  assert.throws(() => replay([traced({ candidatesAfter: '[{"artist":42}]' })]), /cannot be replayed/)
})
