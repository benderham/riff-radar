import { test } from 'node:test'
import assert from 'node:assert/strict'

import { backtest, weeksToHarvest } from './backtest.ts'
import type { KnownRelease, KnownWeek } from './known-set.ts'
import type { ShortlistItem } from './shortlist.ts'

const known = (over: Partial<KnownRelease> = {}): KnownRelease => ({
  artistTitle: 'ulcerate|cutting the throat of god',
  rating: 'OK',
  ...over,
})

const week = (releases: readonly KnownRelease[]): KnownWeek => ({
  weekEnding: '2026-01-16',
  k: releases.length,
  releases,
})

const proposed = (over: Partial<ShortlistItem> = {}): ShortlistItem => ({
  artist: 'Ulcerate',
  title: 'Cutting the Throat of God',
  ...over,
})

test('below the cap it reads as recall', () => {
  const result = backtest(
    [proposed(), proposed({ title: 'b' })],
    week([known(), known({ artistTitle: 'ulcerate|b' }), known({ artistTitle: 'ulcerate|c' })]),
  )

  assert.equal(result.k, 3)
  assert.equal(result.hits, 2)
  assert.equal(result.score, 2 / 3)
})

test('at the cap a full shortlist of known albums scores one', () => {
  const titles = ['a', 'b', 'c', 'd', 'e']
  const result = backtest(
    titles.map((title) => proposed({ title })),
    week(titles.map((title) => known({ artistTitle: `ulcerate|${title}` }))),
  )

  assert.equal(result.k, 5)
  assert.equal(result.score, 1)
})

test('above the cap it reads as precision against the known pool', () => {
  const result = backtest(
    [proposed({ title: 'a' }), proposed({ title: 'b' }), proposed({ title: 'z' })],
    week(
      Array.from({ length: 14 }, (_none, index) =>
        known({ artistTitle: `ulcerate|${String.fromCharCode(97 + index)}` }),
      ),
    ),
  )

  // Three of five available slots, not three of fourteen: the cap is what
  // stopped it finding more, and the measure must not punish the cap.
  assert.equal(result.k, 14)
  assert.equal(result.hits, 2)
  assert.equal(result.score, 2 / 5)
})

test('the Rotate/AOTY number is reported only where the cap forced a choice', () => {
  const busy = week([
    known({ artistTitle: 'ulcerate|a', rating: 'AOTY' }),
    known({ artistTitle: 'ulcerate|b', rating: 'OK' }),
    ...Array.from({ length: 4 }, (_none, index) =>
      known({ artistTitle: `ulcerate|pad-${index}` }),
    ),
  ])

  const result = backtest([proposed({ title: 'a' }), proposed({ title: 'b' })], busy)

  assert.equal(result.k, 6)
  assert.equal(result.preferred, 1)
})

test('at or below the cap there is no secondary number to report', () => {
  const result = backtest([proposed()], week([known({ rating: 'AOTY' })]))

  assert.equal(result.preferred, undefined)
})

test('a release both sides identify matches on its MusicBrainz id', () => {
  const result = backtest(
    [proposed({ artist: 'spelled differently', musicbrainzId: 'rg-1' })],
    week([known({ musicbrainzId: 'rg-1' })]),
  )

  assert.equal(result.hits, 1)
})

test('two different ids are two different releases, whatever they are called', () => {
  const result = backtest(
    [proposed({ musicbrainzId: 'rg-2' })],
    week([known({ musicbrainzId: 'rg-1' })]),
  )

  assert.equal(result.hits, 0)
})

test('where either side has no id, artist and title decide', () => {
  const result = backtest(
    [proposed({ artist: 'ULCERATE ', title: ' Cutting The Throat Of God', musicbrainzId: 'rg-9' })],
    week([known()]),
  )

  assert.equal(result.hits, 1)
})

test('a proposal matching nothing known is not counted against the run', () => {
  const result = backtest([proposed(), proposed({ artist: 'nobody', title: 'nothing' })], week([known()]))

  assert.equal(result.hits, 1)
  assert.equal(result.score, 1)
})

test('the same release proposed twice is one hit', () => {
  const result = backtest(
    [proposed(), proposed({ artist: 'ulcerate' })],
    week([known(), known({ artistTitle: 'ulcerate|b' })]),
  )

  assert.equal(result.hits, 1)
})

test('an empty shortlist scores zero rather than dividing by it', () => {
  const result = backtest([], week([known()]))

  assert.equal(result.hits, 0)
  assert.equal(result.score, 0)
})

// ── Choosing the weeks ───────────────────────────────────────────────────────

const weekOf = (weekEnding: string, k = 1): KnownWeek => ({
  weekEnding,
  k,
  releases: Array.from({ length: k }, (_none, index) =>
    known({ artistTitle: `artist|title-${index}` }),
  ),
})

test('the weeks are the earliest ones, in date order', () => {
  const picked = weeksToHarvest([weekOf('2026-03-06'), weekOf('2026-01-09'), weekOf('2026-02-13')], {
    count: 2,
    year: 2026,
  })

  assert.deepEqual(
    picked.map((week) => week.weekEnding),
    ['2026-01-09', '2026-02-13'],
  )
})

test('a week opening in the previous year is refused: the Sources are year pages', () => {
  // 2026-01-02 opens on 2025-12-27, and no 2025 calendar was captured
  // (carried-forward item 6).
  const picked = weeksToHarvest([weekOf('2026-01-02'), weekOf('2026-01-09')], {
    count: 12,
    year: 2026,
  })

  assert.deepEqual(
    picked.map((week) => week.weekEnding),
    ['2026-01-09'],
  )
})

test('a week of another year is not a candidate at all', () => {
  const picked = weeksToHarvest([weekOf('2025-11-07'), weekOf('2026-01-09')], {
    count: 12,
    year: 2026,
  })

  assert.deepEqual(
    picked.map((week) => week.weekEnding),
    ['2026-01-09'],
  )
})

test('a busy week is kept, because the above-cap regime needs one', () => {
  const picked = weeksToHarvest([weekOf('2026-02-06', 6)], { count: 12, year: 2026 })

  assert.equal(picked[0]?.k, 6)
})
