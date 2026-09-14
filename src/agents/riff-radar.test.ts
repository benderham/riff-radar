import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { ClockPort } from '../ports.ts'
import { openStore } from '../store/store.ts'
import { tasteProfileSchema } from '../domain/taste-profile.ts'
import { runRiffRadar } from './riff-radar.ts'

const fakeClock = (...instants: readonly Date[]): ClockPort => {
  let index = 0
  return {
    now: () => instants[Math.min(index++, instants.length - 1)] as Date,
  }
}

const profile = tasteProfileSchema.parse({
  version: 3,
  artists: { always: [], watch: [], exclude: [] },
  labels: { include: [], exclude: [] },
  genres: { include: [], exclude: [] },
  personnel: { include: [], exclude: [] },
  vibe_notes: { include: [], exclude: [] },
})

const start = () => {
  const store = openStore(':memory:')
  const clock = fakeClock(new Date(2026, 8, 14, 9, 0, 0), new Date(2026, 8, 14, 9, 0, 2))
  return { store, clock }
}

const rowFor = (store: ReturnType<typeof openStore>, runId: string) =>
  store.database.prepare('SELECT * FROM runs WHERE run_id = ?').get(runId)

test('a run that reaches no candidates ends with no_candidates', () => {
  const { store, clock } = start()
  const outcome = runRiffRadar({
    args: { command: 'run', lastDays: 7, dryRun: false, raw: 'run' },
    ports: { clock },
    store,
    profile,
  })

  assert.equal(outcome.terminationReason, 'no_candidates')
  assert.equal(rowFor(store, outcome.runId)?.['termination_reason'], 'no_candidates')
})

test('the trace records the resolved absolute window, not the flag', () => {
  const { store, clock } = start()
  const outcome = runRiffRadar({
    args: { command: 'run', lastDays: 14, dryRun: false, raw: 'run --last-days 14' },
    ports: { clock },
    store,
    profile,
  })

  const row = rowFor(store, outcome.runId)
  assert.equal(row?.['resolved_from'], '2026-09-01')
  assert.equal(row?.['resolved_to'], '2026-09-14')
  assert.deepEqual(outcome.window, { from: '2026-09-01', to: '2026-09-14' })
})

test('the command line is recorded alongside the resolved window', () => {
  const { store, clock } = start()
  const outcome = runRiffRadar({
    args: { command: 'run', lastDays: 14, dryRun: true, raw: 'run --last-days 14 --dry-run' },
    ports: { clock },
    store,
    profile,
  })

  assert.equal(rowFor(store, outcome.runId)?.['cli_args'], 'run --last-days 14 --dry-run')
})

test('a run with no candidates performs no write and proposes nothing', () => {
  const { store, clock } = start()
  const outcome = runRiffRadar({
    args: { command: 'run', lastDays: 7, dryRun: false, raw: 'run' },
    ports: { clock },
    store,
    profile,
  })

  assert.equal(outcome.notionWritePerformed, false)
  const row = rowFor(store, outcome.runId)
  assert.equal(row?.['notion_write_performed'], 0)
  assert.equal(row?.['shortlist_size'], 0)
})

test('the run is stamped with the versions that produced it', () => {
  const { store, clock } = start()
  const outcome = runRiffRadar({
    args: { command: 'run', lastDays: 7, dryRun: false, raw: 'run' },
    ports: { clock },
    store,
    profile,
  })

  const row = rowFor(store, outcome.runId)
  assert.equal(row?.['profile_version'], 3)
  assert.equal(row?.['prompt_version'], 1)
  assert.equal(row?.['action_schema_version'], 1)
  assert.equal(row?.['model_id'], 'accounts/fireworks/models/deepseek-v4p1-flash')
})

test('the run records when it started and when it ended', () => {
  const { store, clock } = start()
  const outcome = runRiffRadar({
    args: { command: 'run', lastDays: 7, dryRun: false, raw: 'run' },
    ports: { clock },
    store,
    profile,
  })

  const row = rowFor(store, outcome.runId)
  assert.equal(row?.['started_at'], new Date(2026, 8, 14, 9, 0, 0).toISOString())
  assert.equal(row?.['ended_at'], new Date(2026, 8, 14, 9, 0, 2).toISOString())
})

test('exactly one termination reason is recorded, and the run leaves one row', () => {
  const { store, clock } = start()
  runRiffRadar({
    args: { command: 'run', lastDays: 7, dryRun: false, raw: 'run' },
    ports: { clock },
    store,
    profile,
  })

  const rows = store.database.prepare('SELECT termination_reason FROM runs').all()
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.['termination_reason'], 'no_candidates')
})

test('two runs in one database are distinct rows', () => {
  const { store, clock } = start()
  const args = { command: 'run', lastDays: 7, dryRun: false, raw: 'run' } as const
  const first = runRiffRadar({ args, ports: { clock }, store, profile })
  const second = runRiffRadar({ args, ports: { clock }, store, profile })

  assert.notEqual(first.runId, second.runId)
  assert.equal(store.database.prepare('SELECT count(*) AS n FROM runs').get()?.['n'], 2)
})
