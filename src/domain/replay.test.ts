import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { TracedStep } from '../store/store.ts'
import { recordedModelResponse, replay, shortlistRefusalMessage } from './replay.ts'
import { ResumeRefusal } from './run.ts'

const said = (content: string, ...calls: readonly { id: string; name: string; argumentsJson: string }[]) =>
  recordedModelResponse({ content, toolCalls: calls, raw: { provider: 'shape' } })

const traced = (over: Partial<TracedStep> = {}): TracedStep => ({
  kind: 'action',
  modelResponse: null,
  toolResult: null,
  toolName: null,
  failureCategory: null,
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
    consecutiveLookupFailures: 0,
    shortlistRefusals: 0,
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

// It happens before the run row, where nothing has been spent, so it is the
// same kind of refusal as a missing run id rather than a crash.
test('an unreadable trace is refused the way a resume is refused', () => {
  assert.throws(() => replay([traced({ modelResponse: '{ truncated' })]), ResumeRefusal)
  assert.throws(() => replay([traced({ candidatesAfter: '[{"artist":42}]' })]), ResumeRefusal)
})

// ── What a resume works out about MusicBrainz (ticket 05) ────────────────────

/** A lookup step as the trace holds it: the tool it called, and how it failed. */
const lookup = (failureCategory: TracedStep['failureCategory'] = null) =>
  traced({ toolName: 'lookup_release', failureCategory })

test('the lookup-failure count is the trailing run of silent lookups', () => {
  // Derived rather than stored, because it can be: ADR-0046 stores only what
  // cannot. Two of these is what a resumed run needs to stay degraded.
  assert.equal(replay([lookup('transient'), lookup('transient')]).consecutiveLookupFailures, 2)
  assert.equal(replay([lookup('unavailable'), lookup('unavailable')]).consecutiveLookupFailures, 2)
})

test('a lookup that answered resets the count, wherever it sits', () => {
  assert.equal(replay([lookup('transient'), lookup()]).consecutiveLookupFailures, 0)
  assert.equal(replay([lookup('transient'), lookup(), lookup('transient')]).consecutiveLookupFailures, 1)
})

test('a lookup the loop refused before dispatch is not an answer', () => {
  // `invalid_action` records the tool the model named, and nothing was asked of
  // MusicBrainz: reading it as an answer would set a degraded run knocking again.
  const refused = traced({ kind: 'invalid_action', toolName: 'lookup_release' })
  assert.equal(replay([lookup('transient'), lookup('transient'), refused]).consecutiveLookupFailures, 2)
})

test('only a lookup counts, and only the two categories that mean silence', () => {
  // A source that failed says nothing about MusicBrainz, and neither does a
  // 404 from it: `not_found` is an answer (ADR-0048).
  assert.equal(
    replay([lookup('transient'), traced({ toolName: 'fetch_source', failureCategory: 'refused' }), lookup('transient')])
      .consecutiveLookupFailures,
    2,
    'a step that was not a lookup neither counts nor resets',
  )
  assert.equal(replay([lookup('not_found'), lookup('not_found')]).consecutiveLookupFailures, 0)
})

// ── The one repair at finish (ADR-0053) ──────────────────────────────────────

test('a refused finish replays as the errors the model was handed back', () => {
  const refused = traced({
    kind: 'finish',
    modelResponse: said('Here are five.', { id: 'call-9', name: 'finish', argumentsJson: '{"shortlist":[]}' }),
    toolResult: '{"shortlist":[]}',
    error: 'item 1 has no source URL',
  })

  assert.deepEqual(replay([refused]).messages, [
    {
      role: 'assistant',
      content: 'Here are five.',
      toolCalls: [{ id: 'call-9', name: 'finish', argumentsJson: '{"shortlist":[]}' }],
    },
    shortlistRefusalMessage('item 1 has no source URL', 'call-9'),
  ])
})

test('the repair count is the number of refused finishes', () => {
  const refused = traced({
    kind: 'finish',
    modelResponse: said('', { id: 'call-9', name: 'finish', argumentsJson: '{}' }),
    error: 'item 1 has no source URL',
  })
  const accepted = traced({
    kind: 'finish',
    modelResponse: said('', { id: 'call-9', name: 'finish', argumentsJson: '{}' }),
  })

  assert.equal(replay([fetched]).shortlistRefusals, 0)
  assert.equal(replay([fetched, refused]).shortlistRefusals, 1)
  // An accepted finish is not a repair spent, and neither is a failure of some
  // other kind: only the validator refusing a shortlist consumes the one chance.
  assert.equal(replay([accepted, traced({ kind: 'tool_error', error: 'boom' })]).shortlistRefusals, 0)
})

// A refused finish is answered, so it is not one of these — the sibling test
// above covers a `finish` that ended its run, which told the model nothing.
test('a repair does not count towards the consecutive-invalid limit', () => {
  const refused = traced({
    kind: 'finish',
    modelResponse: said('', { id: 'call-9', name: 'finish', argumentsJson: '{}' }),
    error: 'item 1 has no source URL',
  })

  assert.equal(replay([traced({ kind: 'invalid_action', error: 'no' }), refused]).consecutiveInvalid, 0)
})
