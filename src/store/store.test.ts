import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { TERMINATION_REASONS } from '../domain/run.ts'
import type { RecordedStep } from './store.ts'
import { openStore } from './store.ts'

// The specification names these columns. A trace that drops one cannot be
// reconstructed, so the schema is asserted against the list rather than trusted.
const RUN_COLUMNS = [
  'run_id', 'started_at', 'ended_at', 'cli_args', 'resolved_from', 'resolved_to',
  'prompt_version', 'profile_version', 'action_schema_version', 'model_id',
  'termination_reason', 'uncached_input_tokens', 'cached_input_tokens', 'output_tokens',
  'estimated_cost', 'shortlist_size', 'notion_write_performed', 'cost_is_upper_bound',
]

const STEP_COLUMNS = [
  'step_id', 'run_id', 'step_index', 'timestamp', 'duration_ms', 'kind', 'model_response',
  'proposed_action', 'validation_result', 'dispatched_action', 'tool_name', 'tool_args',
  'tool_result', 'error', 'warning', 'uncached_input_tokens', 'cached_input_tokens', 'output_tokens',
  'cost',
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
    costIsUpperBound: false,
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
    costIsUpperBound: false,
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
      costIsUpperBound: false,
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

const step: RecordedStep = {
  stepId: 'step-1',
  runId: 'run-1',
  stepIndex: 0,
  timestamp: started.startedAt,
  durationMs: 412,
  kind: 'action',
  modelResponse: '{"choices":[]}',
  proposedAction: '{"name":"fetch_source"}',
  validationResult: 'valid',
  dispatchedAction: '{"name":"fetch_source"}',
  toolName: 'fetch_source',
  toolArgs: '{"source_id":"aoty"}',
  toolResult: 'cleaned text',
  error: null,
  warning: null,
  uncachedInputTokens: 100,
  cachedInputTokens: 20,
  outputTokens: 10,
  cost: 0.00003,
}

test('a recorded step is readable with plain SQL', () => {
  const store = openStore(':memory:')
  store.startRun(started)
  store.recordStep(step)

  const row = store.database.prepare('SELECT * FROM steps WHERE step_id = ?').get('step-1')
  assert.equal(row?.['duration_ms'], 412)
  assert.equal(row?.['validation_result'], 'valid')
  assert.equal(row?.['tool_result'], 'cleaned text')
  assert.equal(row?.['cached_input_tokens'], 20)
})

test('two steps of one run cannot share an index', () => {
  const store = openStore(':memory:')
  store.startRun(started)
  store.recordStep(step)

  assert.throws(() => store.recordStep({ ...step, stepId: 'step-2' }))
})

test('a database written by an older schema is reported at open time', () => {
  const path = `${tmpdir()}/riff-radar-stale-${process.pid}.db`
  const stale = new DatabaseSync(path)
  stale.exec('CREATE TABLE runs (run_id TEXT PRIMARY KEY)')
  stale.close()

  assert.throws(() => openStore(path), /older schema \(runs is missing .*cost_is_upper_bound/)
  rmSync(path)
})

const SOURCE_TEXT_COLUMNS = [
  'source_text_id', 'run_id', 'source_id', 'url', 'fetched_at', 'status',
  'raw_body', 'truncated', 'candidate_count', 'warning',
]

test('the source_texts table carries every column the trace needs', () => {
  const store = openStore(':memory:')
  assert.deepEqual(columnsOf(store.database, 'source_texts').sort(), [...SOURCE_TEXT_COLUMNS].sort())
})

test('a fetched page is readable back against its run, body intact', () => {
  const store = openStore(':memory:')
  store.startRun(started)
  store.recordSourceText({
    sourceTextId: 'text-1',
    runId: 'run-1',
    sourceId: 'aoty',
    url: 'https://www.albumoftheyear.org/genre/40-metal/recent/',
    fetchedAt: '2026-09-14T09:00:01.000Z',
    status: 200,
    rawBody: '<html><body>Ulcerate</body></html>',
    truncated: false,
    candidateCount: 4,
    warning: null,
  })

  const row = store.database.prepare('SELECT * FROM source_texts WHERE run_id = ?').get('run-1')
  assert.equal(row?.['raw_body'], '<html><body>Ulcerate</body></html>')
  assert.equal(row?.['candidate_count'], 4)
  assert.equal(row?.['truncated'], 0)
  assert.equal(row?.['warning'], null)
})

test('a page that disappointed is recorded with its warning, not omitted', () => {
  const store = openStore(':memory:')
  store.startRun(started)
  store.recordSourceText({
    sourceTextId: 'text-2',
    runId: 'run-1',
    sourceId: 'loudwire',
    url: 'https://loudwire.com/2026-hard-rock-metal-album-release-calendar/',
    fetchedAt: '2026-09-14T09:00:02.000Z',
    status: 403,
    rawBody: 'go away',
    truncated: false,
    candidateCount: 0,
    warning: 'returned HTTP 403',
  })

  const row = store.database.prepare('SELECT * FROM source_texts WHERE source_id = ?').get('loudwire')
  assert.equal(row?.['status'], 403)
  assert.equal(row?.['warning'], 'returned HTTP 403')
})

test('a source text cannot be recorded against a run that does not exist', () => {
  const store = openStore(':memory:')
  assert.throws(() =>
    store.recordSourceText({
      sourceTextId: 'text-3',
      runId: 'no-such-run',
      sourceId: 'aoty',
      url: 'https://example.test/',
      fetchedAt: '2026-09-14T09:00:03.000Z',
      status: 200,
      rawBody: 'x',
      truncated: false,
      candidateCount: 0,
      warning: null,
    }),
  )
})
