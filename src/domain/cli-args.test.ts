import { test } from 'node:test'
import assert from 'node:assert/strict'

import { UsageError, parseCliArgs } from './cli-args.ts'

test('the bare run command defaults to seven days and a real write', () => {
  assert.deepEqual(parseCliArgs(['run']), {
    command: 'run',
    lastDays: 7,
    dryRun: false,
    raw: 'run',
  })
})

test('--last-days overrides the default window', () => {
  assert.equal(parseCliArgs(['run', '--last-days', '14']).lastDays, 14)
})

test('only the documented grammar is accepted', () => {
  // `run [--last-days N] [--dry-run]`; an equals form is not in it.
  assert.throws(() => parseCliArgs(['run', '--last-days=14']), UsageError)
})

test('--dry-run is recorded', () => {
  assert.equal(parseCliArgs(['run', '--dry-run']).dryRun, true)
})

test('flags may appear in either order', () => {
  assert.deepEqual(parseCliArgs(['run', '--dry-run', '--last-days', '3']), {
    command: 'run',
    lastDays: 3,
    dryRun: true,
    raw: 'run --dry-run --last-days 3',
  })
})

test('a missing command is a usage error', () => {
  assert.throws(() => parseCliArgs([]), UsageError)
})

test('an unknown command is a usage error naming it', () => {
  assert.throws(() => parseCliArgs(['walk']), (error: unknown) => {
    assert.ok(error instanceof UsageError)
    assert.match(error.message, /walk/)
    return true
  })
})

test('an unknown flag is a usage error naming it', () => {
  assert.throws(() => parseCliArgs(['run', '--from', '2026-01-01']), (error: unknown) => {
    assert.ok(error instanceof UsageError)
    assert.match(error.message, /--from/)
    return true
  })
})

test('a non-numeric or non-positive window is a usage error, not a bad run', () => {
  assert.throws(() => parseCliArgs(['run', '--last-days', 'seven']), UsageError)
  assert.throws(() => parseCliArgs(['run', '--last-days', '0']), UsageError)
  assert.throws(() => parseCliArgs(['run', '--last-days', '-1']), UsageError)
  assert.throws(() => parseCliArgs(['run', '--last-days', '1.5']), UsageError)
})

test('--last-days without a value is a usage error', () => {
  assert.throws(() => parseCliArgs(['run', '--last-days']), UsageError)
})

test('what was typed is kept verbatim for the trace', () => {
  assert.equal(parseCliArgs(['run', '--last-days', '14', '--dry-run']).raw, 'run --last-days 14 --dry-run')
})

test('--resume names the run to continue', () => {
  assert.deepEqual(parseCliArgs(['run', '--resume', 'abc-123']), {
    command: 'run',
    lastDays: 7,
    dryRun: false,
    resumeRunId: 'abc-123',
    raw: 'run --resume abc-123',
  })
})

test('--resume without a run id is a usage error', () => {
  assert.throws(() => parseCliArgs(['run', '--resume']), UsageError)
})

// The window comes from the parent's row, so a second one is a contradiction
// rather than an override, and guessing which was meant is what ADR-0047
// refuses to do.
test('--resume and a window argument together are refused', () => {
  for (const argv of [
    ['run', '--resume', 'abc-123', '--last-days', '14'],
    ['run', '--last-days', '14', '--resume', 'abc-123'],
  ]) {
    assert.throws(() => parseCliArgs(argv), (error: unknown) => {
      assert.ok(error instanceof UsageError)
      assert.match(error.message, /--resume/)
      assert.match(error.message, /--last-days/)
      return true
    })
  }
})

test('a resume may still be a dry run', () => {
  assert.equal(parseCliArgs(['run', '--resume', 'abc-123', '--dry-run']).dryRun, true)
})

test('without --resume there is no resume, even when one would be plausible', () => {
  // ADR-0047: the absence of the flag always means a new run.
  assert.equal(parseCliArgs(['run']).resumeRunId, undefined)
})
