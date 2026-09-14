import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { Candidate } from './candidates.ts'
import {
  candidateIdentity,
  extractionSchema,
  hasDateDisagreement,
  mergeCandidates,
  normaliseCandidate,
  withinWindow,
} from './candidates.ts'

const AOTY = 'https://www.albumoftheyear.org/genre/40-metal/recent/'
const WIKIPEDIA = 'https://en.wikipedia.org/wiki/2026_in_heavy_metal_music'
const LOUDWIRE = 'https://loudwire.com/2026-hard-rock-metal-album-release-calendar/'

const candidate = (from: string, over: Partial<Candidate> = {}): Candidate => ({
  artist: 'Ulcerate',
  title: 'Cutting the Throat of God',
  releaseDates: ['2026-09-12'],
  sourceUrls: [from],
  ...over,
})

test('normalisation trims and collapses the whitespace a page leaves behind', () => {
  const result = normaliseCandidate(
    { artist: '  Blood   Incantation\n', title: ' Absolute Elsewhere ', releaseDate: '2026-09-10' },
    AOTY,
  )
  assert.deepEqual(result, {
    artist: 'Blood Incantation',
    title: 'Absolute Elsewhere',
    releaseDates: ['2026-09-10'],
    sourceUrls: [AOTY],
  })
})

test('optional label and format are kept when present and absent when blank', () => {
  assert.deepEqual(
    normaliseCandidate(
      { artist: 'Gatecreeper', title: 'Dark Superstition', releaseDate: '2026-09-12', label: ' Nuclear Blast ', format: '   ' },
      AOTY,
    ),
    {
      artist: 'Gatecreeper',
      title: 'Dark Superstition',
      releaseDates: ['2026-09-12'],
      sourceUrls: [AOTY],
      label: 'Nuclear Blast',
    },
  )
})

test('a date that is not YYYY-MM-DD is rejected rather than guessed', () => {
  for (const releaseDate of ['September 12, 2026', '12/09/2026', '2026-09', '2026-13-01', '']) {
    assert.equal(
      normaliseCandidate({ artist: 'Ulcerate', title: 'Stare Into Death', releaseDate }, AOTY),
      undefined,
      `expected ${releaseDate} to be rejected`,
    )
  }
})

test('a candidate missing an artist or a title is rejected', () => {
  assert.equal(normaliseCandidate({ artist: ' ', title: 'Cool World', releaseDate: '2026-09-11' }, AOTY), undefined)
  assert.equal(normaliseCandidate({ artist: 'Chat Pile', title: '', releaseDate: '2026-09-11' }, AOTY), undefined)
})

test('identity is stable under case and surrounding whitespace', () => {
  assert.equal(
    candidateIdentity(candidate(AOTY, { artist: ' ULCERATE ', title: 'Cutting The Throat Of God' })),
    candidateIdentity(candidate(WIKIPEDIA)),
  )
})

test('two different releases by one artist keep separate identities', () => {
  assert.notEqual(
    candidateIdentity(candidate(AOTY)),
    candidateIdentity(candidate(AOTY, { title: 'Stare Into Death and Be Still' })),
  )
})

test('the same release on two sources becomes one candidate carrying both URLs', () => {
  const merged = mergeCandidates([candidate(AOTY)], [candidate(WIKIPEDIA)])

  assert.equal(merged.length, 1)
  assert.deepEqual(merged[0]?.sourceUrls, [AOTY, WIKIPEDIA])
  assert.deepEqual(merged[0]?.releaseDates, ['2026-09-12'])
  assert.equal(hasDateDisagreement(merged[0]!), false)
})

test('sources that disagree on a date keep every date, and the disagreement shows', () => {
  const merged = mergeCandidates(
    [candidate(AOTY, { releaseDates: ['2026-09-12'] })],
    [
      candidate(WIKIPEDIA, { releaseDates: ['2026-09-11'] }),
      candidate(LOUDWIRE, { releaseDates: ['2026-09-12'] }),
    ],
  )

  assert.equal(merged.length, 1)
  assert.deepEqual(merged[0]?.releaseDates, ['2026-09-11', '2026-09-12'])
  assert.deepEqual(merged[0]?.sourceUrls, [AOTY, WIKIPEDIA, LOUDWIRE])
  assert.equal(hasDateDisagreement(merged[0]!), true)
})

test('merging preserves first-seen order and appends genuinely new releases', () => {
  const merged = mergeCandidates(
    [candidate(AOTY), candidate(AOTY, { artist: 'Sumac', title: 'The Healer' })],
    [candidate(WIKIPEDIA, { artist: 'Chat Pile', title: 'Cool World' })],
  )

  assert.deepEqual(
    merged.map((each) => each.artist),
    ['Ulcerate', 'Sumac', 'Chat Pile'],
  )
})

test('one source listing a release twice contributes its URL once', () => {
  const merged = mergeCandidates([], [candidate(AOTY), candidate(AOTY)])

  assert.equal(merged.length, 1)
  assert.deepEqual(merged[0]?.sourceUrls, [AOTY])
})

test('a label or format learned from a later source fills a gap without overwriting', () => {
  const merged = mergeCandidates(
    [candidate(AOTY, { label: 'Debemur Morti' })],
    [candidate(WIKIPEDIA, { label: 'Debemur Morti Productions', format: 'full-length' })],
  )

  assert.equal(merged[0]?.label, 'Debemur Morti')
  assert.equal(merged[0]?.format, 'full-length')
})

test('the extraction schema rejects anything that is not a candidate array', () => {
  assert.equal(extractionSchema.safeParse({ candidates: [] }).success, true)
  assert.equal(extractionSchema.safeParse({}).success, false)
  assert.equal(extractionSchema.safeParse({ candidates: [{ artist: 'x' }] }).success, false)
  assert.equal(
    extractionSchema.safeParse({ candidates: [{ artist: 'x', title: 'y', releaseDate: 'z' }] }).success,
    true,
  )
})

test('a candidate is in the window when any source places it there', () => {
  const window = { from: '2026-09-08', to: '2026-09-14' }

  assert.equal(withinWindow(candidate(AOTY, { releaseDates: ['2026-09-12'] }), window), true)
  assert.equal(withinWindow(candidate(AOTY, { releaseDates: ['2026-09-08'] }), window), true, 'inclusive')
  assert.equal(withinWindow(candidate(AOTY, { releaseDates: ['2026-09-14'] }), window), true, 'inclusive')
  assert.equal(withinWindow(candidate(AOTY, { releaseDates: ['2026-10-02'] }), window), false)
  assert.equal(withinWindow(candidate(AOTY, { releaseDates: ['2026-09-07'] }), window), false)

  // Sources disagree by a day routinely; one of them putting it in the window
  // is enough, because the release is still the one the run is asking about.
  assert.equal(
    withinWindow(candidate(AOTY, { releaseDates: ['2026-09-07', '2026-09-08'] }), window),
    true,
  )
})
