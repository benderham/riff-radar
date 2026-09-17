import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { FAILURE_CATEGORIES } from '../domain/failure.ts'
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
  'resumed_from', 'musicbrainz_degraded',
]

const STEP_COLUMNS = [
  'step_id', 'run_id', 'step_index', 'timestamp', 'duration_ms', 'kind', 'model_response',
  'proposed_action', 'validation_result', 'dispatched_action', 'tool_name', 'tool_args',
  'tool_result', 'error', 'warning', 'failure_category', 'candidates_after',
  'uncached_input_tokens', 'cached_input_tokens', 'output_tokens', 'cost',
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
  toolArgs: '{"source_id":"loudwire"}',
  toolResult: 'cleaned text',
  error: null,
  warning: null,
  failureCategory: null,
  candidatesAfter: null,
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

// The milestone's four new columns arrive in one schema change, so a database
// written before them is refused once rather than twice, and the message names
// the columns rather than the first one it noticed. Only the names matter to
// the check, so the older schema is rebuilt from the column lists above.
const MILESTONE_2_COLUMNS = ['resumed_from', 'musicbrainz_degraded', 'failure_category', 'candidates_after']

const tableOf = (name: string, columns: readonly string[], skip: readonly string[] = []) =>
  `CREATE TABLE ${name} (${columns.filter((column) => !skip.includes(column)).join(' TEXT, ')} TEXT);`

const olderDatabaseAt = (suffix: string, sql: string): string => {
  const path = `${tmpdir()}/riff-radar-${suffix}-${process.pid}.db`
  const older = new DatabaseSync(path)
  older.exec(sql)
  older.close()
  return path
}

test('a database written before this milestone is told all four columns at once', () => {
  const path = olderDatabaseAt(
    'milestone-1',
    tableOf('runs', RUN_COLUMNS, MILESTONE_2_COLUMNS) +
      tableOf('steps', STEP_COLUMNS, MILESTONE_2_COLUMNS) +
      tableOf('source_texts', SOURCE_TEXT_COLUMNS),
  )

  assert.throws(() => openStore(path), (error: Error) => {
    assert.match(error.message, /runs is missing resumed_from, musicbrainz_degraded/)
    assert.match(error.message, /steps is missing failure_category, candidates_after/)
    assert.match(error.message, /Delete the file and run again/)
    return true
  })

  rmSync(path)
})

test('the schema accepts every failure category and refuses anything else', () => {
  const store = openStore(':memory:')
  store.startRun(started)

  for (const [index, category] of FAILURE_CATEGORIES.entries()) {
    store.recordStep({ ...step, stepId: `step-${category}`, stepIndex: index, failureCategory: category })
  }
  assert.equal(
    store.database.prepare('SELECT count(*) AS n FROM steps WHERE failure_category IS NOT NULL').get()?.['n'],
    FAILURE_CATEGORIES.length,
  )

  assert.throws(() =>
    store.database.prepare('UPDATE steps SET failure_category = ? WHERE step_id = ?').run('broke', 'step-transient'),
  )
})

test('a step records the category beside the prose, and null when nothing broke', () => {
  const store = openStore(':memory:')
  store.startRun(started)
  store.recordStep({ ...step, warning: 'loudwire.com returned HTTP 503', failureCategory: 'transient' })
  store.recordStep({ ...step, stepId: 'step-2', stepIndex: 1 })

  const rows = store.database.prepare('SELECT * FROM steps ORDER BY step_index').all()
  assert.equal(rows[0]?.['failure_category'], 'transient')
  assert.equal(rows[0]?.['warning'], 'loudwire.com returned HTTP 503')
  assert.equal(rows[1]?.['failure_category'], null)
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
    sourceId: 'wikipedia',
    url: 'https://en.wikipedia.org/wiki/2026_in_heavy_metal_music',
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
      sourceId: 'wikipedia',
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

test('a resumed run records the run it continues', () => {
  const store = openStore(':memory:')
  store.startRun(started)
  store.startRun({ ...started, runId: 'run-2', resumedFrom: 'run-1' })

  assert.equal(
    store.database.prepare('SELECT resumed_from FROM runs WHERE run_id = ?').get('run-2')?.[
      'resumed_from'
    ],
    'run-1',
  )
  // The parent's own row says nothing about the child: the link points one way.
  assert.equal(
    store.database.prepare('SELECT resumed_from FROM runs WHERE run_id = ?').get('run-1')?.[
      'resumed_from'
    ],
    null,
  )
})

test('a run cannot claim to resume a run that does not exist', () => {
  const store = openStore(':memory:')
  assert.throws(() => store.startRun({ ...started, runId: 'run-2', resumedFrom: 'no-such-run' }))
})

test('the run a resume needs is readable by id', () => {
  const store = openStore(':memory:')
  store.startRun(started)

  assert.deepEqual(store.runOf('run-1'), {
    runId: 'run-1',
    resolvedFrom: '2026-09-08',
    resolvedTo: '2026-09-14',
    resumedFrom: null,
  })
  assert.equal(store.runOf('no-such-run'), undefined)
})

test('the steps a resume replays come back in order, with what it replays them from', () => {
  const store = openStore(':memory:')
  store.startRun(started)
  store.recordStep({ ...step, stepIndex: 1, stepId: 'step-b', candidatesAfter: '[]' })
  store.recordStep({ ...step, stepIndex: 0, stepId: 'step-a', candidatesAfter: null })

  assert.deepEqual(
    store.stepsOf('run-1').map((each) => each.candidatesAfter),
    [null, '[]'],
  )
  const [first] = store.stepsOf('run-1')
  assert.equal(first?.kind, 'action')
  assert.equal(first?.toolResult, 'cleaned text')
  assert.equal(first?.cachedInputTokens, 20)
})

// ADR-0046: the one part of a step a resume cannot replay from what the trace
// already holds, so what goes in has to come back out unchanged.
test('a candidate list round-trips through the column it is stored in', () => {
  const store = openStore(':memory:')
  store.startRun(started)

  const candidates = [
    {
      artist: 'Ulcerate',
      title: 'Cutting the Throat of God',
      releaseDates: ['2026-09-12'],
      sourceUrls: ['https://example.test/one'],
      label: 'Debemur Morti Productions',
      lookup: {
        found: true,
        releaseGroupId: 'rg-1',
        primaryType: 'Album',
        secondaryTypes: [],
        firstReleaseDate: '2026-09-12',
        genres: ['death metal'],
        artists: ['Ulcerate'],
      },
    },
    { artist: 'Chat Pile', title: 'Cool World', releaseDates: [], sourceUrls: [], lookup: { found: false } },
  ]
  store.recordStep({ ...step, candidatesAfter: JSON.stringify(candidates) })

  const [only] = store.stepsOf('run-1')
  assert.deepEqual(JSON.parse(only?.candidatesAfter ?? 'null'), candidates)
})

test('an aborted run records what it spent and claims nothing else', () => {
  const store = openStore(':memory:')
  store.startRun(started)
  store.abortRun({
    runId: 'run-1',
    endedAt: '2026-09-14T09:00:05.000Z',
    uncachedInputTokens: 200,
    cachedInputTokens: 40,
    outputTokens: 20,
    estimatedCost: 0.0002,
  })

  const row = store.database.prepare('SELECT * FROM runs WHERE run_id = ?').get('run-1')
  assert.equal(row?.['termination_reason'], 'aborted')
  assert.equal(row?.['ended_at'], '2026-09-14T09:00:05.000Z')
  assert.equal(row?.['uncached_input_tokens'], 200)
  // A run whose work was handed on is in no position to say what it produced.
  assert.equal(row?.['shortlist_size'], 0)
  assert.equal(row?.['notion_write_performed'], 0)
})

test('aborting keeps the one-reason-per-run guarantee, in both directions', () => {
  const store = openStore(':memory:')
  store.startRun(started)
  const aborting = {
    runId: 'run-1',
    endedAt: '2026-09-14T09:00:05.000Z',
    uncachedInputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    estimatedCost: 0,
  }
  store.abortRun(aborting)

  assert.throws(() => store.abortRun(aborting), /already ended/)
  assert.throws(
    () =>
      store.finishRun({
        ...aborting,
        terminationReason: 'completed',
        shortlistSize: 5,
        notionWritePerformed: true,
        costIsUpperBound: false,
      }),
    /already ended/,
  )
})

test('a run is findable by the first few characters of its id, as the listing prints it', () => {
  const store = openStore(':memory:')
  store.startRun({ ...started, runId: 'f55f647d-aaaa-bbbb-cccc-dddddddddddd' })

  assert.deepEqual(
    store.runsMatching('f55f647d').map((run) => run.runId),
    ['f55f647d-aaaa-bbbb-cccc-dddddddddddd'],
  )
  assert.deepEqual(store.runsMatching('nope'), [])
  // The exact read is still exact: a chain is walked by whole ids.
  assert.equal(store.runOf('f55f647d'), undefined)
  assert.equal(store.runOf('f55f647d-aaaa-bbbb-cccc-dddddddddddd')?.runId, 'f55f647d-aaaa-bbbb-cccc-dddddddddddd')
})

test('an ambiguous prefix reports every run it matches, oldest first', () => {
  const store = openStore(':memory:')
  store.startRun({ ...started, runId: 'ab-second', startedAt: '2026-09-14T10:00:00.000Z' })
  store.startRun({ ...started, runId: 'ab-first', startedAt: '2026-09-14T09:00:00.000Z' })

  assert.deepEqual(
    store.runsMatching('ab').map((run) => run.runId),
    ['ab-first', 'ab-second'],
  )
})
