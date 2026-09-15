import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { Candidate } from './candidates.ts'
import type { TasteProfile } from './taste-profile.ts'
import type { ShortlistItem } from './shortlist.ts'
import { releaseIdentity, validateShortlist } from './shortlist.ts'

const window = { from: '2026-09-08', to: '2026-09-14' }

/** Excludes nobody: these tests are about the shortlist's own rules. */
const profile: TasteProfile = {
  version: 1,
  artists: { always: [], watch: [], exclude: [] },
  labels: { include: [], exclude: [] },
  genres: { include: [], exclude: [] },
  personnel: { include: [], exclude: [] },
  vibe_notes: { include: [], exclude: [] },
}

/**
 * The candidates a run discovered. Every test below grounds its shortlist in
 * the items themselves unless it is testing what happens when it cannot: a
 * release the shortlist names and no source listed.
 */
const discovered = (items: readonly ShortlistItem[]): Candidate[] =>
  items.map((item) => ({
    artist: item.artist ?? '',
    title: item.title ?? '',
    releaseDates: [item.releaseDate ?? ''],
    sourceUrls: item.sourceUrls ?? [],
    // Looked up and eligible, because that is the ordinary case and these tests
    // are about the other rules. The eligibility rules have their own file, and
    // the tests at the bottom of this one cover the guardrail itself.
    lookup: {
      found: true,
      releaseGroupId: item.musicbrainzId ?? 'rg-x',
      primaryType: 'Album',
      secondaryTypes: [],
      firstReleaseDate: item.releaseDate ?? '2026-09-10',
      artists: ['Blood Incantation'],
    },
  }))

const validate = (items: readonly ShortlistItem[], candidates = discovered(items)) =>
  validateShortlist(items, window, candidates, profile)

const item = (overrides: Partial<ShortlistItem> = {}): ShortlistItem => ({
  artist: 'Blood Incantation',
  title: 'Absolute Elsewhere',
  releaseDate: '2026-09-10',
  sourceUrls: ['https://albumoftheyear.org/album/1'],
  rank: 1,
  rationale: 'watch-list artist, death metal',
  musicbrainzId: 'mbid-1',
  ...overrides,
})

const errorsOf = (items: readonly ShortlistItem[], candidates?: Candidate[]) => {
  const result = validate(items, candidates ?? discovered(items))
  return result.ok ? [] : result.errors
}

test('a single well-formed item is valid', () => {
  assert.deepEqual(validate([item()]), { ok: true })
})

test('an empty shortlist is invalid', () => {
  assert.match(errorsOf([]).join('\n'), /empty/)
})

test('more than five items is invalid', () => {
  const six = Array.from({ length: 6 }, (_, index) =>
    item({ title: `Album ${index}`, musicbrainzId: `mbid-${index}`, rank: index + 1 }),
  )
  assert.match(errorsOf(six).join('\n'), /maximum is 5/)
})

test('five items is valid', () => {
  const five = Array.from({ length: 5 }, (_, index) =>
    item({ title: `Album ${index}`, musicbrainzId: `mbid-${index}`, rank: index + 1 }),
  )
  assert.deepEqual(validate(five), { ok: true })
})

test('two items sharing a release identity is invalid', () => {
  assert.match(errorsOf([item(), item({ rank: 2 })]).join('\n'), /duplicate release/)
})

test('identity falls back to artist and title when unverified', () => {
  const unverified = item({ musicbrainzId: undefined, unverified: true })
  assert.equal(releaseIdentity(unverified), 'blood incantation|absolute elsewhere')
  assert.match(errorsOf([unverified, { ...unverified, rank: 2 }]).join('\n'), /duplicate release/)
})

test('a release date outside the window is invalid', () => {
  assert.match(errorsOf([item({ releaseDate: '2026-09-07' })]).join('\n'), /outside/)
  assert.match(errorsOf([item({ releaseDate: '2026-09-15' })]).join('\n'), /outside/)
})

test('the window ends are inclusive', () => {
  assert.deepEqual(validate([item({ releaseDate: '2026-09-08' })]), { ok: true })
  assert.deepEqual(validate([item({ releaseDate: '2026-09-14' })]), { ok: true })
})

test('a missing source URL invalidates an item', () => {
  assert.match(errorsOf([item({ sourceUrls: [] })]).join('\n'), /no source URL/)
  assert.match(errorsOf([item({ sourceUrls: undefined })]).join('\n'), /no source URL/)
})

test('a missing MusicBrainz id does not invalidate an item that declares itself unverified', () => {
  assert.deepEqual(
    validate([item({ musicbrainzId: undefined, unverified: true })]),
    { ok: true },
  )
})

test('a missing MusicBrainz id without the unverified marker is invalid', () => {
  assert.match(errorsOf([item({ musicbrainzId: undefined })]).join('\n'), /unverified/)
})

test('artist, title, rank, rationale and date are each required', () => {
  const bare = { sourceUrls: ['https://example.com'], unverified: true }
  const errors = errorsOf([bare]).join('\n')

  assert.match(errors, /missing artist/)
  assert.match(errors, /missing album title/)
  assert.match(errors, /missing rationale/)
  assert.match(errors, /rank/)
  assert.match(errors, /missing release date/)
})

test('an item no source listed is invalid, however well formed it is', () => {
  const invented = item({ artist: 'Nonexistent', title: 'Invented Album' })
  assert.match(errorsOf([invented], discovered([item()])).join('\n'), /not among the candidates/)
})

test('grounding ignores case and surrounding space', () => {
  const shortlisted = item({ artist: '  blood incantation ', title: 'ABSOLUTE ELSEWHERE' })
  assert.deepEqual(validate([shortlisted], discovered([item()])), { ok: true })
})

// ── Eligibility, enforced rather than asked for (ticket 04) ──────────────────

const candidateFor = (over: Partial<Candidate>): Candidate[] => [{ ...discovered([item()])[0]!, ...over }]

test('a live album cannot be proposed, however good the rationale', () => {
  const live = candidateFor({
    lookup: {
      found: true,
      releaseGroupId: 'mbid-1',
      primaryType: 'Album',
      secondaryTypes: ['Live'],
      firstReleaseDate: '2026-09-10',
      artists: ['Blood Incantation'],
    },
  })
  assert.match(errorsOf([item()], live).join('\n'), /Live/)
})

test('a reissue cannot be proposed: its release group predates the window', () => {
  const reissue = candidateFor({
    lookup: {
      found: true,
      releaseGroupId: 'mbid-1',
      primaryType: 'Album',
      secondaryTypes: [],
      firstReleaseDate: '2019-04-05',
      artists: ['Blood Incantation'],
    },
  })
  assert.match(errorsOf([item()], reissue).join('\n'), /reissue or remaster/)
})

test('a release nobody looked up cannot be proposed', () => {
  const { lookup: _unused, ...unlooked } = discovered([item()])[0]!
  assert.match(errorsOf([item()], [unlooked]).join('\n'), /not looked up/)
})

test('the reason a release was refused names the release', () => {
  // The model is handed these errors and has to act on them, so an error that
  // does not say which item it means is an error it cannot use.
  const live = candidateFor({
    lookup: {
      found: true,
      releaseGroupId: 'mbid-1',
      primaryType: 'Album',
      secondaryTypes: ['Compilation'],
      firstReleaseDate: '2026-09-10',
      artists: ['Blood Incantation'],
    },
  })
  assert.match(errorsOf([item()], live).join('\n'), /Blood Incantation — Absolute Elsewhere/)
})

test('an unverified release the source called an album is still proposable', () => {
  const unverified = candidateFor({ lookup: { found: false }, format: 'full-length' })
  assert.deepEqual(validate([item({ musicbrainzId: undefined, unverified: true })], unverified), { ok: true })
})

test('an excluded artist cannot be proposed, even as half of a collaboration', () => {
  // The prompt has always claimed this rule; nothing enforced it until now.
  const collaboration = candidateFor({
    lookup: {
      found: true,
      releaseGroupId: 'mbid-1',
      primaryType: 'Album',
      secondaryTypes: [],
      firstReleaseDate: '2026-09-10',
      artists: ['Blood Incantation', 'Disturbed'],
    },
  })
  const opinionated = { ...profile, artists: { ...profile.artists, exclude: ['Disturbed'] } }
  const result = validateShortlist([item()], window, collaboration, opinionated)

  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.errors.join('\n'), /Disturbed is on the profile's excluded artists/)
})

test('a collaboration nobody excluded is proposable', () => {
  const collaboration = candidateFor({
    lookup: {
      found: true,
      releaseGroupId: 'mbid-1',
      primaryType: 'Album',
      secondaryTypes: [],
      firstReleaseDate: '2026-09-10',
      artists: ['Blood Incantation', 'Parkway Drive'],
    },
  })

  assert.deepEqual(validate([item()], collaboration), { ok: true })
})

