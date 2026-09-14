import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { TASTE_PROFILE_PATH } from '../../config.ts'
import { describeTasteProfileError, parseTasteProfile } from './taste-profile.ts'

const minimal = {
  version: 1,
  artists: { always: [], watch: [], exclude: [] },
  labels: { include: [], exclude: [] },
  genres: { include: [], exclude: [] },
  personnel: { include: [], exclude: [] },
  vibe_notes: { include: [], exclude: [] },
}

test('a well-formed profile parses, keeping its version', () => {
  const profile = parseTasteProfile({ ...minimal, version: 4 })
  assert.equal(profile.version, 4)
  assert.deepEqual(profile.artists.always, [])
})

test('artist tiers are read as written', () => {
  const profile = parseTasteProfile({
    ...minimal,
    artists: { always: ['Blood Incantation'], watch: ['Chat Pile'], exclude: ['Nickelback'] },
  })
  assert.deepEqual(profile.artists, {
    always: ['Blood Incantation'],
    watch: ['Chat Pile'],
    exclude: ['Nickelback'],
  })
})

test('a missing section is refused rather than silently loaded as empty', () => {
  const { artists, ...withoutArtists } = minimal
  assert.throws(() => parseTasteProfile(withoutArtists), /artists/)
})

test('a profile without a version is refused', () => {
  const { version, ...withoutVersion } = minimal
  assert.throws(() => parseTasteProfile(withoutVersion), /version/)
})

test('a non-integer version is refused', () => {
  assert.throws(() => parseTasteProfile({ ...minimal, version: 1.5 }))
})

test('a parse failure describes each problem on its own line', () => {
  try {
    parseTasteProfile({ ...minimal, version: 'one' })
    assert.fail('expected a refusal')
  } catch (error) {
    const described = describeTasteProfileError(error)
    assert.match(described, /version: /)
    assert.doesNotMatch(described, /invalid_type/, 'should read as prose, not as a Zod dump')
  }
})

test('the checked-in profile is valid and is what a run would stamp', () => {
  const profile = parseTasteProfile(JSON.parse(readFileSync(TASTE_PROFILE_PATH, 'utf8')))
  assert.ok(Number.isInteger(profile.version))
})
