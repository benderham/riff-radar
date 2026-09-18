import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { CuratedRow } from './known-set.ts'
import { curate, preferredCount, weekEnding } from './known-set.ts'

/** A hand-entered, rated, dated row: the membership case every test varies from. */
const row = (over: Partial<CuratedRow> = {}): CuratedRow => ({
  artist: 'Ulcerate',
  title: 'Cutting the Throat of God',
  releaseDate: '2026-01-09',
  rating: 'OK',
  runId: '',
  ...over,
})

test('a hand-entered rated row is a member', () => {
  const known = curate([row()])

  assert.equal(known.members, 1)
  assert.deepEqual(
    known.weeks.map((week) => [week.weekEnding, week.k]),
    [['2026-01-09', 1]],
  )
})

test('OK counts, and so do Rotate and AOTY', () => {
  const known = curate([
    row({ rating: 'OK' }),
    row({ title: 'b', rating: 'Rotate' }),
    row({ title: 'c', rating: 'AOTY' }),
  ])

  assert.equal(known.members, 3)
})

test('Nope is excluded and counted', () => {
  const known = curate([row({ rating: 'Nope' })])

  assert.equal(known.members, 0)
  assert.equal(known.excluded.nope, 1)
})

test('an unrated row is excluded and counted, because it cannot be told from a Nope', () => {
  const { rating: _unrated, ...unrated } = row()
  const known = curate([unrated])

  assert.equal(known.members, 0)
  assert.equal(known.excluded.unrated, 1)
})

test('a row the agent wrote is excluded on its Run ID, whatever its rating', () => {
  const known = curate([row({ runId: 'd5d6e816', rating: 'AOTY' })])

  assert.equal(known.members, 0)
  assert.equal(known.excluded.agentWritten, 1)
})

test('a row with no Release Date is excluded, because it cannot be bucketed', () => {
  const { releaseDate: _undated, ...undated } = row()
  const known = curate([undated])

  assert.equal(known.excluded.undated, 1)
})

test('a row missing an identity is excluded rather than matching everything', () => {
  const known = curate([row({ artist: '   ' })])

  assert.equal(known.excluded.unidentifiable, 1)
})

test('a release keeps both identities where it has both', () => {
  const known = curate([row({ musicbrainzId: 'rg-1' })])

  assert.deepEqual(known.weeks[0]?.releases, [
    {
      artistTitle: 'ulcerate|cutting the throat of god',
      musicbrainzId: 'rg-1',
      rating: 'OK',
    },
  ])
})

test('the same release entered twice counts once in k', () => {
  const known = curate([row({ musicbrainzId: 'rg-1' }), row({ musicbrainzId: 'rg-1', rating: 'AOTY' })])

  assert.equal(known.weeks[0]?.k, 1)
})

test('a release entered twice, once with an id and once without, still counts once', () => {
  const known = curate([row({ musicbrainzId: 'rg-1' }), row()])

  assert.equal(known.weeks[0]?.k, 1)
})

test('an unreadable Release Date is undated rather than fatal', () => {
  const known = curate([row({ releaseDate: 'January 2026' })])

  assert.equal(known.excluded.undated, 1)
  assert.equal(known.weeks.length, 0)
})

test('the Rotate/AOTY count is what the cap-forced weeks are read by', () => {
  const known = curate([
    row({ rating: 'AOTY' }),
    row({ title: 'b', rating: 'Rotate' }),
    row({ title: 'c', rating: 'OK' }),
  ])

  const week = known.weeks[0]
  assert.ok(week !== undefined)
  assert.equal(preferredCount(week), 2)
})

test('weeks come back in date order, and a week with nothing in it is not a week', () => {
  const known = curate([
    row({ releaseDate: '2026-03-06' }),
    row({ releaseDate: '2026-01-09' }),
    row({ releaseDate: '2026-02-13', rating: 'Nope' }),
  ])

  assert.deepEqual(
    known.weeks.map((week) => week.weekEnding),
    ['2026-01-09', '2026-03-06'],
  )
})

test('rows are counted whole, members and exclusions apart', () => {
  const known = curate([row(), row({ rating: 'Nope' }), row({ runId: 'x' })])

  assert.equal(known.rows, 3)
  assert.equal(known.members, 1)
})

// ── The week boundary ────────────────────────────────────────────────────────
// `resolveWindow(now, 7)` is the six days before `now` plus `now`, so a Friday
// run covers Saturday through Friday: the bucket is named by its closing Friday
// and the Saturday after one Friday belongs to the next.

test('a Friday release is its own week', () => {
  assert.equal(weekEnding('2026-01-09'), '2026-01-09')
})

test('the Saturday after a Friday belongs to the following week', () => {
  assert.equal(weekEnding('2026-01-10'), '2026-01-16')
})

test('a Thursday closes with the Friday after it', () => {
  assert.equal(weekEnding('2026-01-15'), '2026-01-16')
})

test('the week may cross a month and a year', () => {
  assert.equal(weekEnding('2026-01-28'), '2026-01-30')
  assert.equal(weekEnding('2025-12-31'), '2026-01-02')
})
