import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { TASTE_PROFILE_PATH } from '../../config.ts'
import { tasteProfileSchema } from './taste-profile.ts'

const minimal = {
  version: 1,
  artists: { always: [], watch: [], exclude: [] },
  labels: { include: [], exclude: [] },
  genres: { include: [], exclude: [] },
  personnel: { include: [], exclude: [] },
  vibe_notes: { include: [], exclude: [] },
}

test('a well-formed profile parses, keeping its version', () => {
  const profile = tasteProfileSchema.parse({ ...minimal, version: 4 })
  assert.equal(profile.version, 4)
  assert.deepEqual(profile.artists.always, [])
})

test('artist tiers are read as written', () => {
  const profile = tasteProfileSchema.parse({
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
  assert.throws(() => tasteProfileSchema.parse(withoutArtists), /artists/)
})

test('a profile without a version is refused', () => {
  const { version, ...withoutVersion } = minimal
  assert.throws(() => tasteProfileSchema.parse(withoutVersion), /version/)
})

test('a non-integer version is refused', () => {
  assert.throws(() => tasteProfileSchema.parse({ ...minimal, version: 1.5 }))
})

test('the checked-in profile is valid and is what a run would stamp', () => {
  const profile = tasteProfileSchema.parse(JSON.parse(readFileSync(TASTE_PROFILE_PATH, 'utf8')))
  assert.ok(Number.isInteger(profile.version))
})
