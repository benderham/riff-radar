import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { StoredRun } from '../store/store.ts'
import { resumeRefusal } from './run.ts'

const versions = { promptVersion: 3, profileVersion: 2, actionSchemaVersion: 1 }

const parent = (over: Partial<StoredRun> = {}): StoredRun => ({
  runId: 'killed-parent',
  resolvedFrom: '2026-09-08',
  resolvedTo: '2026-09-14',
  resumedFrom: null,
  terminationReason: null,
  ...versions,
  ...over,
})

test('a run killed part way through is resumable', () => {
  assert.equal(resumeRefusal(parent(), 4, versions), undefined)
})

test('a run that already ended is a re-run, not a resume', () => {
  const refusal = resumeRefusal(parent({ terminationReason: 'completed' }), 4, versions)
  assert.match(String(refusal), /already ended: completed/)
  assert.match(String(refusal), /re-run/)
})

test('a run that recorded no steps is a re-run too', () => {
  assert.match(String(resumeRefusal(parent(), 0, versions)), /recorded no steps/)
})

// ADR-0047: half under one version and half under another is a trace nobody can
// reason about, and a later milestone would have to exclude it from every count.
test('a resume is refused when a version has moved, and says which', () => {
  const cases = [
    ['promptVersion', /prompt version \(3, now 4\)/],
    ['profileVersion', /profile version \(2, now 4\)/],
    ['actionSchemaVersion', /action-schema version \(1, now 4\)/],
  ] as const

  for (const [moved, expected] of cases) {
    const refusal = resumeRefusal(parent(), 4, { ...versions, [moved]: 4 })
    assert.match(String(refusal), expected, moved)
    assert.match(String(refusal), /re-run/, moved)
  }
})

test('every version that moved is named, not just the first', () => {
  const refusal = resumeRefusal(parent(), 4, { promptVersion: 4, profileVersion: 3, actionSchemaVersion: 1 })
  assert.match(String(refusal), /prompt version/)
  assert.match(String(refusal), /profile version/)
  assert.doesNotMatch(String(refusal), /action-schema/)
})

// A run that ended is over whatever else is true of it: saying the versions
// moved as well would be describing a run that is not going to be resumed.
test('an ended run is refused for having ended, whatever its versions say', () => {
  const refusal = resumeRefusal(parent({ terminationReason: 'aborted' }), 0, {
    promptVersion: 9,
    profileVersion: 9,
    actionSchemaVersion: 9,
  })
  assert.match(String(refusal), /already ended/)
  assert.doesNotMatch(String(refusal), /version/)
})
