import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'

import { TERMINATION_REASONS } from '../domain/run.ts'
import { openStore } from './store.ts'

// The specification names these columns. A trace that drops one cannot be
// reconstructed, so the schema is asserted against the list rather than trusted.
const RUN_COLUMNS = [
  'run_id', 'started_at', 'ended_at', 'cli_args', 'resolved_from', 'resolved_to',
  'prompt_version', 'profile_version', 'action_schema_version', 'model_id',
  'termination_reason', 'uncached_input_tokens', 'cached_input_tokens', 'output_tokens',
  'estimated_cost', 'shortlist_size', 'notion_write_performed',
]

const STEP_COLUMNS = [
  'step_id', 'run_id', 'step_index', 'timestamp', 'duration_ms', 'kind', 'model_response',
  'proposed_action', 'validation_result', 'dispatched_action', 'tool_name', 'tool_args',
  'tool_result', 'error', 'uncached_input_tokens', 'cached_input_tokens', 'output_tokens', 'cost',
]

const columnsOf = (database: DatabaseSync, table: string) =>
  database.prepare(`PRAGMA table_info(${table})`).all().map((row) => row['name'] as string)

const started = {
  runId: 'run-1',
  startedAt: '2026-09-14T09:00:00.000Z',
  cliArgs: 'run --last-days 7',
  resolvedFrom: '2026-09-08',
  resolvedTo: '2026-09-14',
  promptVersion: 1,
  profileVersion: 3,
  actionSchemaVersion: 1,
  modelId: 'accounts/fireworks/models/deepseek-v4p1-flash',
}

test('the runs table carries every column the specification names', () => {
  const store = openStore(':memory:')
  assert.deepEqual(columnsOf(store.database, 'runs').sort(), [...RUN_COLUMNS].sort())
})

test('the steps table carries every column the specification names', () => {
  const store = openStore(':memory:')
  assert.deepEqual(columnsOf(store.database, 'steps').sort(), [...STEP_COLUMNS].sort())
})

test('a started run is readable with plain SQL, before it has ended', () => {
  const store = openStore(':memory:')
  store.startRun(started)

  const row = store.database.prepare('SELECT * FROM runs WHERE run_id = ?').get('run-1')
  assert.equal(row?.['resolved_from'], '2026-09-08')
  assert.equal(row?.['resolved_to'], '2026-09-14')
  assert.equal(row?.['cli_args'], 'run --last-days 7')
  assert.equal(row?.['profile_version'], 3)
  assert.equal(row?.['ended_at'], null)
  assert.equal(row?.['termination_reason'], null)
  assert.equal(row?.['notion_write_performed'], 0)
})

test('finishing a run records its reason, its end and its accounting', () => {
  const store = openStore(':memory:')
  store.startRun(started)
  store.finishRun({
    runId: 'run-1',
    endedAt: '2026-09-14T09:00:02.000Z',
    terminationReason: 'no_candidates',
    uncachedInputTokens: 120,
    cachedInputTokens: 4000,
    outputTokens: 38,
    estimatedCost: 0.000079,
    shortlistSize: 0,
    notionWritePerformed: false,
  })

  const row = store.database.prepare('SELECT * FROM runs WHERE run_id = ?').get('run-1')
  assert.equal(row?.['termination_reason'], 'no_candidates')
  assert.equal(row?.['ended_at'], '2026-09-14T09:00:02.000Z')
  assert.equal(row?.['cached_input_tokens'], 4000)
  assert.equal(row?.['notion_write_performed'], 0)
})

test('a run cannot be given a second termination reason', () => {
  const store = openStore(':memory:')
  store.startRun(started)
  const ending = {
    runId: 'run-1',
    endedAt: '2026-09-14T09:00:02.000Z',
    terminationReason: 'no_candidates' as const,
    uncachedInputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    estimatedCost: 0,
    shortlistSize: 0,
    notionWritePerformed: false,
  }
  store.finishRun(ending)

  assert.throws(() => store.finishRun({ ...ending, terminationReason: 'completed' }), /already ended/)
  assert.equal(
    store.database.prepare('SELECT termination_reason FROM runs WHERE run_id = ?').get('run-1')?.[
      'termination_reason'
    ],
    'no_candidates',
  )
})

test('the database refuses a termination reason that is not one of the nine', () => {
  const store = openStore(':memory:')
  store.startRun(started)
  assert.throws(() =>
    store.database
      .prepare('UPDATE runs SET termination_reason = ? WHERE run_id = ?')
      .run('gave_up', 'run-1'),
  )
})

test('every documented termination reason is accepted by the schema', () => {
  const store = openStore(':memory:')
  for (const reason of TERMINATION_REASONS) {
    store.startRun({ ...started, runId: `run-${reason}` })
    store.finishRun({
      runId: `run-${reason}`,
      endedAt: started.startedAt,
      terminationReason: reason,
      uncachedInputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
      shortlistSize: 0,
      notionWritePerformed: false,
    })
  }
  assert.equal(store.database.prepare('SELECT count(*) AS n FROM runs').get()?.['n'], TERMINATION_REASONS.length)
})

test('a step cannot reference a run that does not exist', () => {
  const store = openStore(':memory:')
  assert.throws(() =>
    store.database
      .prepare('INSERT INTO steps (step_id, run_id, step_index, timestamp, kind) VALUES (?, ?, ?, ?, ?)')
      .run('step-1', 'no-such-run', 0, started.startedAt, 'model'),
  )
})
