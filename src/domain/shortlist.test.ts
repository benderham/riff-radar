import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { ShortlistItem } from './shortlist.ts'
import { releaseIdentity, validateShortlist } from './shortlist.ts'

const window = { from: '2026-09-08', to: '2026-09-14' }

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

const errorsOf = (items: readonly ShortlistItem[]) => {
  const result = validateShortlist(items, window)
  return result.ok ? [] : result.errors
}

test('a single well-formed item is valid', () => {
  assert.deepEqual(validateShortlist([item()], window), { ok: true })
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
  assert.deepEqual(validateShortlist(five, window), { ok: true })
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
  assert.deepEqual(validateShortlist([item({ releaseDate: '2026-09-08' })], window), { ok: true })
  assert.deepEqual(validateShortlist([item({ releaseDate: '2026-09-14' })], window), { ok: true })
})

test('a missing source URL invalidates an item', () => {
  assert.match(errorsOf([item({ sourceUrls: [] })]).join('\n'), /no source URL/)
  assert.match(errorsOf([item({ sourceUrls: undefined })]).join('\n'), /no source URL/)
})

test('a missing MusicBrainz id does not invalidate an item that declares itself unverified', () => {
  assert.deepEqual(
    validateShortlist([item({ musicbrainzId: undefined, unverified: true })], window),
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
