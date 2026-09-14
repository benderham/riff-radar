import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MAX_RUN_COST_USD } from '../../config.ts'
import type { ShortlistItem } from '../domain/shortlist.ts'
import { tasteProfileSchema } from '../domain/taste-profile.ts'
import type { ClockPort, ModelMessage, ModelPort, ModelResponse, ToolDefinition } from '../ports.ts'
import { openStore } from '../store/store.ts'
import { runRiffRadar } from './riff-radar.ts'

/** Every `now()` is a second after the last, so durations are observable. */
const tickingClock = (from = new Date(2026, 8, 14, 9, 0, 0)): ClockPort => {
  let tick = 0
  return { now: () => new Date(from.getTime() + tick++ * 1000) }
}

const profile = tasteProfileSchema.parse({
  version: 3,
  artists: { always: [], watch: [], exclude: [] },
  labels: { include: [], exclude: [] },
  genres: { include: [], exclude: [] },
  personnel: { include: [], exclude: [] },
  vibe_notes: { include: [], exclude: [] },
})

type Scripted = Partial<ModelResponse> | Error

const DEFAULT_USAGE = { uncachedInputTokens: 100, cachedInputTokens: 20, outputTokens: 10 }

/**
 * A model that says exactly what the test tells it to. The last entry repeats,
 * so a loop that should run to a ceiling can be scripted in one line.
 */
const scriptedModel = (...script: readonly Scripted[]) => {
  const requests: { messages: readonly ModelMessage[]; tools: readonly ToolDefinition[] }[] = []
  let index = 0

  const port: ModelPort = {
    complete: async (request) => {
      // Snapshotted: the loop appends to one array, so a stored reference would
      // make every request look like the last one.
      requests.push({ ...request, messages: [...request.messages] })
      const next = script[Math.min(index++, script.length - 1)] ?? {}
      if (next instanceof Error) throw next

      return {
        content: '',
        toolCalls: [],
        usage: DEFAULT_USAGE,
        cacheReported: true,
        raw: { scripted: true },
        ...next,
      }
    },
  }

  return { port, requests, get calls() { return index } }
}

const proposes = (name: string, argumentsJson: string): Partial<ModelResponse> => ({
  toolCalls: [{ id: `call-${name}`, name, argumentsJson }],
})

const finishes = (shortlist: readonly unknown[]): Partial<ModelResponse> =>
  proposes('finish', JSON.stringify({ shortlist }))

const item = (index: number, overrides: Partial<ShortlistItem> = {}): ShortlistItem => ({
  artist: `Artist ${index}`,
  title: `Album ${index}`,
  releaseDate: '2026-09-10',
  sourceUrls: ['https://albumoftheyear.org/album/1'],
  rank: index,
  rationale: 'watch-list artist',
  musicbrainzId: `mbid-${index}`,
  ...overrides,
})

const items = (count: number) => Array.from({ length: count }, (_, index) => item(index + 1))

const run = async (model: ModelPort, args: Partial<{ dryRun: boolean }> = {}) => {
  const store = openStore(':memory:')
  const outcome = await runRiffRadar({
    args: { command: 'run', lastDays: 7, dryRun: args.dryRun ?? false, raw: 'run' },
    ports: { clock: tickingClock(), model },
    store,
    profile,
  })

  const runRow = store.database.prepare('SELECT * FROM runs WHERE run_id = ?').get(outcome.runId)
  const stepRows = store.database
    .prepare('SELECT * FROM steps WHERE run_id = ? ORDER BY step_index')
    .all(outcome.runId)

  return { outcome, store, runRow, stepRows }
}

// ── Termination reasons ──────────────────────────────────────────────────────

test('finish with five valid items ends the run completed', async () => {
  const { outcome, runRow } = await run(scriptedModel(finishes(items(5))).port)

  assert.equal(outcome.terminationReason, 'completed')
  assert.equal(outcome.shortlistSize, 5)
  assert.equal(runRow?.['termination_reason'], 'completed')
  assert.equal(runRow?.['shortlist_size'], 5)
})

test('finish with one to four valid items ends the run completed_short', async () => {
  const { outcome, runRow } = await run(scriptedModel(finishes(items(3))).port)

  assert.equal(outcome.terminationReason, 'completed_short')
  assert.equal(outcome.shortlistSize, 3)
  assert.equal(runRow?.['shortlist_size'], 3)
})

test('finish with an empty shortlist ends the run no_candidates', async () => {
  const { outcome, runRow } = await run(scriptedModel(finishes([])).port)

  assert.equal(outcome.terminationReason, 'no_candidates')
  assert.equal(runRow?.['notion_write_performed'], 0)
})

test('finish with an invalid shortlist ends the run validation_failed', async () => {
  const model = scriptedModel(finishes([item(1, { sourceUrls: [] })]))
  const { outcome, runRow, stepRows } = await run(model.port)

  assert.equal(outcome.terminationReason, 'validation_failed')
  assert.equal(outcome.shortlistSize, 0, 'an invalid shortlist is not a shortlist')
  assert.equal(runRow?.['notion_write_performed'], 0)
  assert.match(String(stepRows.at(-1)?.['error']), /no source URL/)
})

test('three consecutive invalid actions end the run invalid_action_limit', async () => {
  const model = scriptedModel(proposes('web_search', '{"q": "wrong key"}'))
  const { outcome, runRow, stepRows } = await run(model.port)

  assert.equal(outcome.terminationReason, 'invalid_action_limit')
  assert.equal(stepRows.length, 3, 'the third invalid action is the last step')
  assert.equal(runRow?.['notion_write_performed'], 0)
})

test('prose where an action was required counts as an invalid action', async () => {
  const model = scriptedModel({ content: 'I think I will have a think about it.' })
  const { outcome, stepRows } = await run(model.port)

  assert.equal(outcome.terminationReason, 'invalid_action_limit')
  assert.equal(stepRows[0]?.['kind'], 'invalid_action')
  assert.match(String(stepRows[0]?.['validation_result']), /no action proposed/)
})

test('two actions proposed in one step is an invalid action, and both are recorded', async () => {
  const model = scriptedModel(
    {
      toolCalls: [
        { id: 'a', name: 'web_search', argumentsJson: '{"query": "one"}' },
        { id: 'b', name: 'web_search', argumentsJson: '{"query": "two"}' },
      ],
    },
    finishes(items(1)),
  )
  const { outcome, stepRows } = await run(model.port)

  assert.equal(outcome.terminationReason, 'completed_short')
  assert.equal(stepRows[0]?.['kind'], 'invalid_action')
  assert.match(String(stepRows[0]?.['validation_result']), /2 actions proposed/)
  assert.equal(stepRows[0]?.['dispatched_action'], null)
  // Neither proposal is dropped: a refused action has to be in the trace.
  const proposed = String(stepRows[0]?.['proposed_action'])
  assert.match(proposed, /one/)
  assert.match(proposed, /two/)
})

test('thirty steps end the run max_steps_exceeded', async () => {
  const model = scriptedModel(proposes('web_search', '{"query": "again"}'))
  const { outcome, runRow, stepRows } = await run(model.port)

  assert.equal(outcome.terminationReason, 'max_steps_exceeded')
  assert.equal(stepRows.length, 30)
  assert.equal(runRow?.['notion_write_performed'], 0)
})

test('a run over the cost ceiling ends budget_exceeded', async () => {
  // One step's worth of output tokens priced past the ceiling on its own.
  const expensive = {
    ...proposes('web_search', '{"query": "expensive"}'),
    usage: { uncachedInputTokens: 0, cachedInputTokens: 0, outputTokens: 10_000_000 },
  }
  const { outcome, runRow, stepRows } = await run(scriptedModel(expensive).port)

  assert.equal(outcome.terminationReason, 'budget_exceeded')
  assert.equal(stepRows.length, 1, 'the ceiling is checked before the next call, not after it')
  assert.ok(outcome.estimatedCost >= MAX_RUN_COST_USD)
  assert.equal(runRow?.['notion_write_performed'], 0)
})

test('a model that fails unrecoverably ends the run tool_failure', async () => {
  const { outcome, runRow, stepRows } = await run(
    scriptedModel(new Error('502 from the provider')).port,
  )

  assert.equal(outcome.terminationReason, 'tool_failure')
  assert.equal(stepRows[0]?.['kind'], 'model_error')
  assert.match(String(stepRows[0]?.['error']), /502/)
  assert.equal(runRow?.['notion_write_performed'], 0)
})

test('exactly one termination reason is recorded per run', async () => {
  const { store, outcome } = await run(scriptedModel(finishes(items(2))).port)
  const rows = store.database.prepare('SELECT termination_reason FROM runs').all()

  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.['termination_reason'], outcome.terminationReason)
})

// ── Guardrails in the trace ──────────────────────────────────────────────────

test('a rejected action is visible: proposed and unvalidated, never dispatched', async () => {
  const model = scriptedModel(
    proposes('fetch_source', '{"source_id": "metal-archives"}'),
    finishes(items(1)),
  )
  const { stepRows } = await run(model.port)

  const rejected = stepRows[0]
  assert.match(String(rejected?.['proposed_action']), /metal-archives/)
  assert.ok(rejected?.['validation_result'], 'the reason it was rejected is recorded')
  assert.equal(rejected?.['dispatched_action'], null, 'nothing was dispatched')

  const dispatched = stepRows[1]
  assert.equal(dispatched?.['validation_result'], 'valid')
  assert.match(String(dispatched?.['dispatched_action']), /finish/)
})

test('malformed JSON arguments are recorded as an invalid action, not a crash', async () => {
  const model = scriptedModel(proposes('web_search', '{"query": '), finishes(items(1)))
  const { outcome, stepRows } = await run(model.port)

  assert.equal(outcome.terminationReason, 'completed_short')
  assert.match(String(stepRows[0]?.['validation_result']), /not valid JSON/)
})

test('the model may correct itself: the invalid counter resets on a valid action', async () => {
  const model = scriptedModel(
    proposes('web_search', 'not json'),
    proposes('web_search', 'still not json'),
    proposes('fetch_source', '{"source_id": "aoty"}'),
    proposes('web_search', 'not json again'),
    proposes('web_search', 'nor this'),
    finishes(items(1)),
  )
  const { outcome, stepRows } = await run(model.port)

  assert.equal(outcome.terminationReason, 'completed_short')
  assert.equal(stepRows.length, 6, 'four invalid actions, never three in a row')
})

test('a failed validation is returned to the model as that step result', async () => {
  const model = scriptedModel(proposes('web_search', '{"q": "wrong"}'), finishes(items(1)))
  await run(model.port)

  // The second request carries the rejection the first step produced.
  const second = model.requests[1]?.messages ?? []
  assert.match(
    second.map((message) => message.content).join('\n'),
    /Invalid action, not dispatched/,
  )
})

test('a dispatched action returns its result to the model', async () => {
  const model = scriptedModel(proposes('fetch_source', '{"source_id": "aoty"}'), finishes(items(1)))
  const { stepRows } = await run(model.port)

  assert.match(String(stepRows[0]?.['tool_result']), /Blood Incantation/)
  assert.match(
    (model.requests[1]?.messages ?? []).map((message) => message.content).join('\n'),
    /Blood Incantation/,
  )
})

test('every step records its duration', async () => {
  const model = scriptedModel(proposes('fetch_source', '{"source_id": "aoty"}'), finishes(items(1)))
  const { stepRows } = await run(model.port)

  assert.equal(stepRows.length, 2)
  for (const step of stepRows) {
    assert.equal(step['duration_ms'], 1000, 'one clock tick spent inside the step')
  }
})

// ── The stable prefix, tokens and cost ───────────────────────────────────────

test('the stable prefix leads every request and never moves', async () => {
  const model = scriptedModel(
    proposes('fetch_source', '{"source_id": "aoty"}'),
    proposes('web_search', '{"query": "ulcerate"}'),
    finishes(items(1)),
  )
  await run(model.port)

  assert.equal(model.requests.length, 3)
  const [first, , last] = model.requests

  assert.equal(first?.messages[0]?.role, 'system')
  assert.match(String(first?.messages[0]?.content), /Riff Radar/)
  assert.match(String(first?.messages[0]?.content), /Taste profile/)

  // Identical text in the identical position on the last request as the first,
  // with the step-by-step history appended after it.
  assert.deepEqual(last?.messages[0], first?.messages[0])
  assert.deepEqual(last?.messages[1], first?.messages[1])
  assert.ok((last?.messages.length ?? 0) > (first?.messages.length ?? 0))

  // Tool definitions travel beside the messages, not inside the history.
  assert.equal(first?.tools.length, 4)
})

test('tokens are counted three ways per step and summed onto the run', async () => {
  const model = scriptedModel(proposes('fetch_source', '{"source_id": "aoty"}'), finishes(items(1)))
  const { outcome, runRow, stepRows } = await run(model.port)

  for (const step of stepRows) {
    assert.equal(step['uncached_input_tokens'], DEFAULT_USAGE.uncachedInputTokens)
    assert.equal(step['cached_input_tokens'], DEFAULT_USAGE.cachedInputTokens)
    assert.equal(step['output_tokens'], DEFAULT_USAGE.outputTokens)
    assert.ok(Number(step['cost']) > 0)
  }

  assert.equal(runRow?.['uncached_input_tokens'], DEFAULT_USAGE.uncachedInputTokens * 2)
  assert.equal(runRow?.['cached_input_tokens'], DEFAULT_USAGE.cachedInputTokens * 2)
  assert.equal(runRow?.['output_tokens'], DEFAULT_USAGE.outputTokens * 2)
  assert.equal(runRow?.['estimated_cost'], outcome.estimatedCost)

  const stepCosts = stepRows.reduce((total, step) => total + Number(step['cost']), 0)
  assert.ok(Math.abs(stepCosts - outcome.estimatedCost) < 1e-12)
})

test('a provider that reports no cache breakdown makes the cost an upper bound', async () => {
  const model = scriptedModel({ ...finishes(items(1)), cacheReported: false })
  const { outcome, runRow } = await run(model.port)

  assert.equal(outcome.costIsUpperBound, true)
  assert.equal(runRow?.['cost_is_upper_bound'], 1)
})

test('a reported cache breakdown makes the cost a measurement', async () => {
  const { outcome, runRow } = await run(scriptedModel(finishes(items(1))).port)

  assert.equal(outcome.costIsUpperBound, false)
  assert.equal(runRow?.['cost_is_upper_bound'], 0)
})

// ── The run record ───────────────────────────────────────────────────────────

test('the trace records the resolved absolute window, not the flag', async () => {
  const store = openStore(':memory:')
  const outcome = await runRiffRadar({
    args: { command: 'run', lastDays: 14, dryRun: false, raw: 'run --last-days 14' },
    ports: { clock: tickingClock(), model: scriptedModel(finishes(items(1))).port },
    store,
    profile,
  })

  const row = store.database.prepare('SELECT * FROM runs WHERE run_id = ?').get(outcome.runId)
  assert.equal(row?.['resolved_from'], '2026-09-01')
  assert.equal(row?.['resolved_to'], '2026-09-14')
  assert.equal(row?.['cli_args'], 'run --last-days 14')
  assert.deepEqual(outcome.window, { from: '2026-09-01', to: '2026-09-14' })
})

test('the run is stamped with the versions that produced it', async () => {
  const { runRow } = await run(scriptedModel(finishes(items(1))).port)

  assert.equal(runRow?.['profile_version'], 3)
  assert.equal(runRow?.['prompt_version'], 1)
  assert.equal(runRow?.['action_schema_version'], 1)
  assert.equal(runRow?.['model_id'], 'accounts/fireworks/models/deepseek-v4p1-flash')
})

test('the run records when it started and when it ended', async () => {
  const { runRow } = await run(scriptedModel(finishes(items(1))).port)

  assert.equal(runRow?.['started_at'], new Date(2026, 8, 14, 9, 0, 0).toISOString())
  assert.ok(String(runRow?.['ended_at']) > String(runRow?.['started_at']))
})

test('no run writes to Notion yet, dry or not', async () => {
  for (const dryRun of [true, false]) {
    const { outcome, runRow } = await run(scriptedModel(finishes(items(5))).port, { dryRun })
    assert.equal(outcome.notionWritePerformed, false)
    assert.equal(runRow?.['notion_write_performed'], 0)
  }
})

test('two runs in one database are distinct rows with distinct steps', async () => {
  const store = openStore(':memory:')
  const args = { command: 'run', lastDays: 7, dryRun: false, raw: 'run' } as const
  const ports = { clock: tickingClock(), model: scriptedModel(finishes(items(1))).port }

  const first = await runRiffRadar({ args, ports, store, profile })
  const second = await runRiffRadar({ args, ports, store, profile })

  assert.notEqual(first.runId, second.runId)
  assert.equal(store.database.prepare('SELECT count(*) AS n FROM runs').get()?.['n'], 2)
  assert.equal(store.database.prepare('SELECT count(*) AS n FROM steps').get()?.['n'], 2)
})
