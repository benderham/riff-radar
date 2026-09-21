import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { ProposalRow, RunProfile } from './taste.ts'
import { ratingNamed } from './known-set.ts'
import { measure } from './taste.ts'

const SHORTLIST = 5

/** An unjudged proposal from run `r1`: the case every test varies from. */
const row = (over: Partial<ProposalRow> = {}): ProposalRow => ({
  runId: 'r1',
  status: 'Proposed',
  ...over,
})

/** A row whose Status column is empty or renamed: unjudged, not an error. */
const noStatus: ProposalRow = { runId: 'r1' }

const runs: RunProfile[] = [
  { runId: 'r1', profileVersion: 1, terminationReason: 'completed' },
  { runId: 'r2', profileVersion: 1, terminationReason: 'completed' },
  { runId: 'r3', profileVersion: 2, terminationReason: 'completed' },
]

/** One version's reading, from the two runs that share profile version 1. */
const only = (rows: readonly ProposalRow[]) => {
  const reading = measure(rows, [runs[0]!], SHORTLIST).byProfileVersion
  assert.equal(reading.length, 1, 'expected exactly one profile version')

  return reading[0]!
}

test('a row with no Run ID is not a proposal', () => {
  const metrics = measure([row({ runId: '' }), row({ runId: '   ' })], [], SHORTLIST)

  assert.equal(metrics.handEntered, 2)
  assert.deepEqual(metrics.byProfileVersion, [])
})

test('a proposal whose run nothing records is bucketed as unknown, and sorts last', () => {
  const metrics = measure([row({ runId: 'lost' }), row()], runs.slice(0, 1), SHORTLIST)

  assert.deepEqual(
    metrics.byProfileVersion.map((reading) => [reading.profileVersion, reading.proposals]),
    [
      [1, 1],
      ['unknown', 1],
    ],
  )
})

test('Acceptance Rate counts everything not Rejected, including the unjudged', () => {
  const reading = only([
    row({ status: 'Proposed' }),
    row({ status: 'Confirmed' }),
    row({ status: 'Rejected' }),
    noStatus,
  ])

  assert.equal(reading.proposals, 4)
  assert.equal(reading.accepted, 3)
})

test('the unjudged are counted beside the rate, and an empty Status is unjudged', () => {
  const reading = only([row({ status: 'Proposed' }), noStatus, row({ status: 'Confirmed' })])

  assert.equal(reading.unjudged, 2)
})

test('Taste Yield divides by rated proposals, never by all of them', () => {
  const reading = only([
    row({ rating: 'AOTY' }),
    row({ rating: 'Rotate' }),
    row({ rating: 'OK' }),
    row({ rating: 'Nope' }),
    row(),
    row(),
  ])

  assert.equal(reading.proposals, 6)
  assert.equal(reading.rated, 4)
  assert.equal(reading.preferred, 2)
})

test('nothing rated is no yield rather than a yield of zero', () => {
  const reading = only([row(), row()])

  // The denominator, not the rate: a yield over nothing rated has no value,
  // and the command prints a dash for it.
  assert.equal(reading.rated, 0)
  assert.equal(reading.preferred, 0)
})

test('Fill Rate is runs that proposed the full five, over runs that decided', () => {
  const full = Array.from({ length: SHORTLIST }, () => row({ runId: 'r1' }))
  const partial = [row({ runId: 'r2' }), row({ runId: 'r2' })]
  const reading = measure([...full, ...partial], runs.slice(0, 2), SHORTLIST).byProfileVersion[0]!

  assert.equal(reading.runs, 2)
  assert.equal(reading.full, 1)
})

test('a completed run that proposed nothing is in the denominator', () => {
  // The cowardice case: proposing none is the extreme of proposing few, and a
  // denominator read off the Notion rows alone would never see it.
  const reading = measure([row({ runId: 'r1' })], runs.slice(0, 2), SHORTLIST).byProfileVersion[0]!

  assert.equal(reading.proposals, 1)
  assert.equal(reading.runs, 2)
  assert.equal(reading.full, 0)
})

test('completed_short and no_candidates are decisions: a short list is the point', () => {
  const decided: RunProfile[] = [
    { runId: 'r1', profileVersion: 1, terminationReason: 'completed_short' },
    { runId: 'r2', profileVersion: 1, terminationReason: 'no_candidates' },
  ]
  const reading = measure([row({ runId: 'r1' })], decided, SHORTLIST).byProfileVersion[0]!

  assert.equal(reading.runs, 2)
  assert.equal(reading.full, 0)
})

test('a run that ran out of steps before proposing anything is in no denominator', () => {
  const spent: RunProfile[] = [
    { runId: 'r1', profileVersion: 1, terminationReason: 'completed' },
    { runId: 'r2', profileVersion: 1, terminationReason: 'max_steps_exceeded' },
  ]

  assert.equal(measure([row({ runId: 'r1' })], spent, SHORTLIST).byProfileVersion[0]!.runs, 1)
})

test('a run killed before it proposed anything is in no denominator', () => {
  const killed: RunProfile[] = [
    { runId: 'r1', profileVersion: 1, terminationReason: 'completed' },
    { runId: 'r2', profileVersion: 1, terminationReason: null },
  ]
  const reading = measure([row({ runId: 'r1' })], killed, SHORTLIST).byProfileVersion[0]!

  assert.equal(reading.runs, 1)
})

test('a killed run that had already written a proposal still counts', () => {
  const killed: RunProfile[] = [{ runId: 'r1', profileVersion: 1, terminationReason: 'aborted' }]
  const reading = measure([row({ runId: 'r1' })], killed, SHORTLIST).byProfileVersion[0]!

  assert.equal(reading.runs, 1)
  assert.equal(reading.full, 0)
})

test('a version whose runs all proposed nothing still gets a reading', () => {
  const metrics = measure([], runs, SHORTLIST)

  assert.deepEqual(
    metrics.byProfileVersion.map((reading) => [reading.profileVersion, reading.proposals, reading.runs]),
    [
      [1, 0, 2],
      [2, 0, 1],
    ],
  )
})

test('proposals are split by the profile version their run ran under', () => {
  const metrics = measure(
    [row({ runId: 'r1', rating: 'AOTY' }), row({ runId: 'r3', status: 'Rejected' })],
    [runs[0]!, runs[2]!],
    SHORTLIST,
  )

  assert.deepEqual(
    metrics.byProfileVersion.map((reading) => [reading.profileVersion, reading.proposals, reading.accepted]),
    [
      [1, 1, 1],
      [2, 1, 0],
    ],
  )
})

test('no rows and no runs is an empty reading rather than a division by zero', () => {
  const metrics = measure([], [], SHORTLIST)

  assert.deepEqual(metrics.byProfileVersion, [])
  assert.equal(metrics.handEntered, 0)
})

test('a Rating outside the four options leaves the row unrated', () => {
  assert.equal(ratingNamed('Banger'), undefined)
  assert.equal(ratingNamed(undefined), undefined)
  assert.equal(ratingNamed('AOTY'), 'AOTY')
})
