import { test } from 'node:test'
import assert from 'node:assert/strict'

import { RANKING_WEIGHTS } from '../../config.ts'
import type { Candidate, MusicbrainzLookup } from './candidates.ts'
import { citedVibes, rankShortlist, scoreRelease } from './ranking.ts'
import type { ShortlistItem } from './shortlist.ts'
import type { TasteProfile } from './taste-profile.ts'

const NO_OPINIONS: TasteProfile = {
  version: 1,
  artists: { always: [], watch: [], exclude: [] },
  labels: { include: [], exclude: [] },
  genres: { include: [], exclude: [] },
  personnel: { include: [], exclude: [] },
  vibe_notes: { include: [], exclude: [] },
}

const profile = (over: Partial<TasteProfile>): TasteProfile => ({ ...NO_OPINIONS, ...over })

const found = (over: Partial<Extract<MusicbrainzLookup, { found: true }>> = {}): MusicbrainzLookup => ({
  found: true,
  releaseGroupId: 'rg-1',
  primaryType: 'Album',
  secondaryTypes: [],
  firstReleaseDate: '2026-09-12',
  artists: ['Ulcerate'],
  label: 'Debemur Morti Productions',
  genres: ['dissonant death metal', 'technical death metal'],
  members: ['Jamie Saint Merat', 'Paul Kelland'],
  ...over,
})

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  artist: 'Ulcerate',
  title: 'Cutting the Throat of God',
  releaseDates: ['2026-09-12'],
  sourceUrls: ['https://loudwire.test/calendar'],
  lookup: found(),
  ...over,
})

// ── The base score ───────────────────────────────────────────────────────────

test('a release matching nothing in the profile scores zero', () => {
  const score = scoreRelease(candidate(), NO_OPINIONS)
  assert.equal(score.total, 0)
  assert.equal(score.guaranteed, false)
  assert.deepEqual(score.signals, [])
})

test('an artist on the always list is guaranteed a slot rather than scored', () => {
  const score = scoreRelease(candidate(), profile({ artists: { always: ['Ulcerate'], watch: [], exclude: [] } }))
  assert.equal(score.guaranteed, true)
  assert.equal(score.total, 0)
})

test('an artist on the watch list scores once, however it is spelled', () => {
  const score = scoreRelease(candidate(), profile({ artists: { always: [], watch: ['  ulcerate '], exclude: [] } }))
  assert.equal(score.total, RANKING_WEIGHTS.artistWatch)
})

test('a credited artist MusicBrainz knows about counts, not only the one a source printed', () => {
  const split = candidate({ artist: 'Ulcerate', lookup: found({ artists: ['Ulcerate', 'Portal'] }) })
  const score = scoreRelease(split, profile({ artists: { always: [], watch: ['Portal'], exclude: [] } }))
  assert.equal(score.total, RANKING_WEIGHTS.artistWatch)
})

test('an included label scores, and a source-stated label counts when MusicBrainz is silent', () => {
  const unverified = candidate({ label: 'Century Media', lookup: { found: false } })
  const score = scoreRelease(unverified, profile({ labels: { include: ['Century Media'], exclude: [] } }))
  assert.equal(score.total, RANKING_WEIGHTS.labelInclude)
})

test('a profile term matches inside a longer value, so "death metal" finds "dissonant death metal"', () => {
  const score = scoreRelease(candidate(), profile({ genres: { include: ['death metal'], exclude: [] } }))
  // Both of the release's genres contain the term; the term scores once.
  assert.equal(score.total, RANKING_WEIGHTS.genreInclude)
})

test('each matching profile term scores separately', () => {
  const score = scoreRelease(
    candidate(),
    profile({ genres: { include: ['dissonant', 'technical'], exclude: [] } }),
  )
  assert.equal(score.total, RANKING_WEIGHTS.genreInclude * 2)
})

test('personnel are scored from the band members MusicBrainz reported', () => {
  const score = scoreRelease(
    candidate(),
    profile({ personnel: { include: ['Jamie Saint Merat'], exclude: [] } }),
  )
  assert.equal(score.total, RANKING_WEIGHTS.personnelInclude)
})

// ── Negative weight, not a filter (ADR-0007) ─────────────────────────────────

test('an excluded genre weighs the release down without removing it', () => {
  const score = scoreRelease(candidate(), profile({ genres: { include: [], exclude: ['technical'] } }))
  assert.equal(score.total, RANKING_WEIGHTS.genreExclude)
  assert.ok(score.total < 0, 'an excluded genre is negative weight')
})

test('an excluded label weighs more heavily than an included one lifts', () => {
  assert.ok(Math.abs(RANKING_WEIGHTS.labelExclude) > RANKING_WEIGHTS.labelInclude)
  assert.ok(Math.abs(RANKING_WEIGHTS.genreExclude) > RANKING_WEIGHTS.genreInclude)
})

test('a mistagged record still reaches the shortlist on its other signals', () => {
  const score = scoreRelease(
    candidate(),
    profile({
      artists: { always: [], watch: ['Ulcerate'], exclude: [] },
      labels: { include: ['Debemur Morti'], exclude: [] },
      genres: { include: [], exclude: ['technical'] },
    }),
  )
  assert.equal(
    score.total,
    RANKING_WEIGHTS.artistWatch + RANKING_WEIGHTS.labelInclude + RANKING_WEIGHTS.genreExclude,
  )
})

// ── A missing signal is dropped, and the release proceeds (ADR-0010) ─────────

test('a release nobody looked up is scored on what the sources said', () => {
  const { lookup: _unlooked, label: _unlabelled, ...bare } = candidate()
  const score = scoreRelease(
    bare,
    profile({
      artists: { always: [], watch: ['Ulcerate'], exclude: [] },
      genres: { include: ['death metal'], exclude: [] },
      personnel: { include: ['Jamie Saint Merat'], exclude: [] },
    }),
  )
  assert.equal(score.total, RANKING_WEIGHTS.artistWatch)
})

// ── The vibe note, which only counts when it is cited ────────────────────────

test('a cited vibe note scores against the profile', () => {
  const score = scoreRelease(candidate(), profile({ vibe_notes: { include: ['glacial'], exclude: [] } }), {
    claim: 'described as glacial and suffocating',
    quote: 'a glacial, suffocating record',
    cited: true,
  })
  assert.equal(score.total, RANKING_WEIGHTS.vibeInclude)
})

test('an uncited vibe note contributes nothing', () => {
  const score = scoreRelease(candidate(), profile({ vibe_notes: { include: ['glacial'], exclude: [] } }), {
    claim: 'described as glacial and suffocating',
    quote: 'a quote no source text contains',
    cited: false,
  })
  assert.equal(score.total, 0)
})

test('an excluded vibe note is negative weight when cited', () => {
  const score = scoreRelease(candidate(), profile({ vibe_notes: { include: [], exclude: ['symphonic'] } }), {
    claim: 'a symphonic turn for the band',
    quote: 'their symphonic turn',
    cited: true,
  })
  assert.equal(score.total, RANKING_WEIGHTS.vibeExclude)
})

// ── What the trace has to be able to show ────────────────────────────────────

test('every contribution is reported with the term that caused it', () => {
  const score = scoreRelease(
    candidate(),
    profile({ genres: { include: ['dissonant'], exclude: ['technical'] } }),
  )
  assert.deepEqual(score.signals, [
    { signal: 'genre', term: 'dissonant', points: RANKING_WEIGHTS.genreInclude },
    { signal: 'genre', term: 'technical', points: RANKING_WEIGHTS.genreExclude },
  ])
})

// ── Ordering the shortlist ───────────────────────────────────────────────────

const item = (artist: string, rank: number): ShortlistItem => ({
  artist,
  title: `${artist} album`,
  releaseDate: '2026-09-12',
  sourceUrls: ['https://loudwire.test/calendar'],
  rank,
  rationale: 'because',
  musicbrainzId: `rg-${artist}`,
})

const namedCandidate = (artist: string, over: Partial<Candidate> = {}): Candidate =>
  candidate({ artist, title: `${artist} album`, lookup: found({ artists: [artist] }), ...over })

test('the profile, not the model, decides the order', () => {
  const items = [item('Cattle', 1), item('Hen', 2), item('Duck', 3)]
  const candidates = [namedCandidate('Cattle'), namedCandidate('Hen'), namedCandidate('Duck')]

  const ranked = rankShortlist(items, candidates, profile({ artists: { always: [], watch: ['Duck'], exclude: [] } }))

  assert.deepEqual(ranked.map((each) => each.item.artist), ['Duck', 'Cattle', 'Hen'])
  assert.deepEqual(ranked.map((each) => each.item.rank), [1, 2, 3])
})

test('an always artist takes the top slot whatever anything else scores', () => {
  const items = [item('Cattle', 1), item('Hen', 2)]
  const candidates = [namedCandidate('Cattle'), namedCandidate('Hen')]

  const ranked = rankShortlist(
    items,
    candidates,
    profile({
      artists: { always: ['Hen'], watch: ['Cattle'], exclude: [] },
      labels: { include: ['Debemur Morti'], exclude: [] },
    }),
  )

  assert.deepEqual(ranked.map((each) => each.item.artist), ['Hen', 'Cattle'])
})

test('where the profile is indifferent the model keeps its order', () => {
  const items = [item('Cattle', 3), item('Hen', 1), item('Duck', 2)]
  const candidates = [namedCandidate('Cattle'), namedCandidate('Hen'), namedCandidate('Duck')]

  const ranked = rankShortlist(items, candidates, NO_OPINIONS)

  assert.deepEqual(ranked.map((each) => each.item.artist), ['Hen', 'Duck', 'Cattle'])
})

test('an item naming a release the run never discovered keeps its place and scores nothing', () => {
  const ranked = rankShortlist([item('Ghost', 1)], [], NO_OPINIONS)
  assert.equal(ranked[0]?.score.total, 0)
  assert.equal(ranked[0]?.item.rank, 1)
})

// ── Checking a citation against the page it claims to come from ──────────────

const page = (body: string) => [{ url: 'https://loudwire.test/calendar', rawBody: `<p>${body}</p>` }]

test('a quote found in the page the item names is cited', () => {
  const withVibe = { ...item('Cattle', 1), sourceUrls: ['https://loudwire.test/calendar'], vibe: { claim: 'glacial', quote: 'a glacial, suffocating record' } }
  const cited = citedVibes([withVibe], page('Reviewers called it a glacial, suffocating record.'))
  assert.equal([...cited.values()][0]?.cited, true)
})

test('whitespace and markup are forgiven; the words are not', () => {
  const withVibe = { ...item('Cattle', 1), sourceUrls: ['https://loudwire.test/calendar'], vibe: { claim: 'glacial', quote: 'a  GLACIAL,\n suffocating record' } }
  const cited = citedVibes([withVibe], page('Reviewers called it a glacial, suffocating record.'))
  assert.equal([...cited.values()][0]?.cited, true)
})

test('a quote no stored page contains is not cited', () => {
  const withVibe = { ...item('Cattle', 1), sourceUrls: ['https://loudwire.test/calendar'], vibe: { claim: 'glacial', quote: 'the best record of the year' } }
  const cited = citedVibes([withVibe], page('Reviewers called it a glacial, suffocating record.'))
  assert.equal([...cited.values()][0]?.cited, false)
})

test('a quote from a page the item does not name is not cited', () => {
  const withVibe = { ...item('Cattle', 1), sourceUrls: ['https://wikipedia.test/2026'], vibe: { claim: 'glacial', quote: 'a glacial, suffocating record' } }
  const cited = citedVibes([withVibe], page('Reviewers called it a glacial, suffocating record.'))
  assert.equal([...cited.values()][0]?.cited, false)
})

test('an item with no vibe note is not in the citation map at all', () => {
  assert.equal(citedVibes([item('Cattle', 1)], page('anything')).size, 0)
})

// ── A name is matched whole; a description is matched inside ────────────────

test('a name is not a substring: Ulcerate does not match Ulcerate Fester', () => {
  const other = candidate({ artist: 'Ulcerate Fester', lookup: found({ artists: ['Ulcerate Fester'] }) })

  // The band MusicBrainz offers when asked about Ulcerate, and the reason the
  // match rule exists in the first place. A containment rule would hand it a
  // guaranteed slot on the strength of a shared word.
  assert.equal(
    scoreRelease(other, profile({ artists: { always: ['Ulcerate'], watch: [], exclude: [] } })).guaranteed,
    false,
  )
  assert.equal(
    scoreRelease(other, profile({ artists: { always: [], watch: ['Ulcerate'], exclude: [] } })).total,
    0,
  )
})

test('a personnel name is matched whole too', () => {
  const score = scoreRelease(candidate(), profile({ personnel: { include: ['Jamie'], exclude: [] } }))
  assert.equal(score.total, 0, 'half a name is not the person')
})

test('a label or genre term still matches inside a longer value', () => {
  const score = scoreRelease(
    candidate({ label: 'Century Media Records', lookup: found({ label: 'Century Media Records' }) }),
    profile({ labels: { include: ['Century Media'], exclude: [] }, genres: { include: ['death metal'], exclude: [] } }),
  )
  assert.equal(score.total, RANKING_WEIGHTS.labelInclude + RANKING_WEIGHTS.genreInclude)
})
