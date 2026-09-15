import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { MUSICBRAINZ_MAX_ATTEMPTS, MUSICBRAINZ_MIN_INTERVAL_MS, USER_AGENT } from '../../config.ts'
import type { ClockPort, HttpPort, Ports } from '../ports.ts'
import { lookupRelease, nextRequestDelayMs } from './musicbrainz.ts'

const fixture = (name: string) => readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8')

const GROUP = fixture('musicbrainz-release-group.json')
const NOT_FOUND = fixture('musicbrainz-not-found.json')
const PARTIAL = fixture('musicbrainz-partial.json')
const EP_RECORDINGS = fixture('musicbrainz-ep-recordings.json')

/** A second between every `now()`, so the client's own gate never has to wait. */
const tickingClock = (): ClockPort => {
  let at = new Date('2026-09-15T00:00:00Z').getTime()
  return { now: () => new Date((at += MUSICBRAINZ_MIN_INTERVAL_MS)) }
}

const serving = (bodies: readonly (string | { body: string; status: number })[]) => {
  const gets: { url: string; headers?: Record<string, string> }[] = []
  let call = 0
  const http: HttpPort = {
    get: async (url, headers) => {
      gets.push({ url, ...(headers === undefined ? {} : { headers }) })
      const next = bodies[Math.min(call++, bodies.length - 1)]!
      const { body, status } = typeof next === 'string' ? { body: next, status: 200 } : next
      return { status, headers: { 'content-type': 'application/json' }, body }
    },
    post: async (url) => {
      throw new Error(`unexpected post to ${url}`)
    },
  }
  return { gets, ports: { http, clock: tickingClock() } as Ports }
}

// ── The rate limit, as arithmetic ────────────────────────────────────────────

test('the gate waits out the remainder of a second and no longer', () => {
  assert.equal(nextRequestDelayMs(1_000, 1_000), MUSICBRAINZ_MIN_INTERVAL_MS)
  assert.equal(nextRequestDelayMs(1_000, 1_400), 600)
  assert.equal(nextRequestDelayMs(1_000, 2_000), 0)
  assert.equal(nextRequestDelayMs(1_000, 9_999), 0, 'a long gap never owes time')
  assert.equal(nextRequestDelayMs(0, 0), 0, 'the first request of a run does not wait')
  assert.equal(nextRequestDelayMs(9_000, 1_000), 0, 'a clock that went backwards owes nothing')
})

// ── Finding a release ────────────────────────────────────────────────────────

test('a release MusicBrainz knows carries its release-group id and its facts', async () => {
  const { gets, ports } = serving([GROUP])
  const found = await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  assert.equal(found.warning, undefined)
  assert.equal(found.lookup.found, true)
  assert.ok(found.lookup.found === true)
  assert.equal(found.lookup.releaseGroupId, 'c302ec77-589f-462f-b6b3-d63508886978')
  assert.equal(found.lookup.primaryType, 'Album')
  assert.equal(found.lookup.firstReleaseDate, '2024-06-14')
  assert.equal(found.lookup.artistCount, 1)
  assert.deepEqual(found.lookup.secondaryTypes, [])

  const [call] = gets
  assert.match(call?.url ?? '', /release-group\?query=/)
  assert.match(call?.url ?? '', /fmt=json/)
  assert.equal(call?.headers?.['accept'], 'application/json')
  // The agent itself is attached by the adapter and asserted there; what matters
  // here is that MusicBrainz's terms are met by the one this project sends.
  assert.match(USER_AGENT, /https?:\/\//, 'MusicBrainz asks for a contactable user agent')
})

test('an album costs one request: only an EP needs its tracks counted', async () => {
  const { gets, ports } = serving([GROUP])
  await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  assert.equal(gets.length, 1)
})

test('a release MusicBrainz has never heard of is unverified, not an error', async () => {
  const { ports } = serving([NOT_FOUND])
  const missing = await lookupRelease(ports, 'Vaultwraith Of Nowhere', 'Crimson Nadir Unreleased')

  assert.deepEqual(missing.lookup, { found: false })
  assert.equal(missing.warning, undefined, 'absence is evidence, not a disappointment')
})

test('a hit for a different release is not a match', async () => {
  // The search is fuzzy and scores what it finds; binding the wrong release
  // group would make every downstream fact wrong about a different record.
  const { ports } = serving([GROUP])
  const wrong = await lookupRelease(ports, 'Ulcerate', 'Stare Into Death and Be Still')

  assert.deepEqual(wrong.lookup, { found: false })
})

test('a near-miss on the artist is not a match either', async () => {
  // Real: MusicBrainz holds an EP called "Unceasing Life" by *Ulcerate Fester*,
  // a different band from Ulcerate, and a fuzzy search offers it up. Binding
  // one to the other would give a New Zealand band a 1991 EP from someone else.
  const { ports } = serving([GROUP])
  const other = await lookupRelease(ports, 'Ulcerate Fester', 'Cutting the Throat of God')

  assert.deepEqual(other.lookup, { found: false })
})

// ── Partial data ─────────────────────────────────────────────────────────────

test('partial data enriches what it can and leaves the rest absent', async () => {
  // A real release group that states a type and no first-release-date at all.
  const { ports } = serving([PARTIAL])
  const partial = await lookupRelease(ports, 'John Cameron', 'Country Ways')

  assert.ok(partial.lookup.found === true)
  assert.equal(partial.lookup.releaseGroupId, 'ab8c6807-364c-4518-bd0b-8908c2ffdf20')
  assert.equal(partial.lookup.primaryType, 'Other')
  assert.equal(partial.lookup.firstReleaseDate, undefined, 'absent, not invented')
})

// ── The EP's second request ──────────────────────────────────────────────────

test('an EP is followed up for its track count and duration', async () => {
  const asEp = GROUP.replace(/"primary-type":"Album"/g, '"primary-type":"EP"')
  const { gets, ports } = serving([asEp, EP_RECORDINGS])
  const ep = await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  assert.equal(gets.length, 2, 'the release group, then its recordings')
  assert.match(gets[1]?.url ?? '', /inc=recordings/)
  assert.ok(ep.lookup.found === true)
  assert.equal(ep.lookup.trackCount, 4)
  assert.equal(ep.lookup.durationMs, 1_610_000)
})

test('an EP whose tracks are listed but untimed reports no duration at all', async () => {
  // A duration summed from an incomplete tracklist is an undercount, and an
  // undercount excludes an EP that should qualify. Better absent than wrong.
  const asEp = GROUP.replace(/"primary-type":"Album"/g, '"primary-type":"EP"')
  const untimed = JSON.stringify({ releases: [{ media: [{ 'track-count': 5, tracks: [{ length: 60_000 }, { length: null }] }] }] })
  const { ports } = serving([asEp, untimed])
  const ep = await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  assert.ok(ep.lookup.found === true)
  assert.equal(ep.lookup.trackCount, 5)
  assert.equal(ep.lookup.durationMs, undefined)
})

test('an EP whose second request fails keeps the identity it already has', async () => {
  const asEp = GROUP.replace(/"primary-type":"Album"/g, '"primary-type":"EP"')
  const { ports } = serving([asEp, { body: 'gateway timeout', status: 504 }])
  const ep = await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  assert.ok(ep.lookup.found === true)
  assert.equal(ep.lookup.releaseGroupId, 'c302ec77-589f-462f-b6b3-d63508886978')
  assert.equal(ep.lookup.trackCount, undefined)
  assert.match(String(ep.warning), /504/)
})

// ── What disappointment looks like ───────────────────────────────────────────

test('MusicBrainz answering 200 with an error body is a warning, not a result', async () => {
  // Observed repeatedly against the live service: it serves HTTP 200 and
  // `{"error": "The MusicBrainz web server is currently busy..."}`.
  const busy = JSON.stringify({ error: 'The MusicBrainz web server is currently busy. Please try again later.' })
  const { ports } = serving([busy])
  const refused = await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  assert.deepEqual(refused.lookup, { found: false })
  assert.match(String(refused.warning), /busy/)
})

test('a 503 is retried, because MusicBrainz sheds load rather than queueing', async () => {
  const { gets, ports } = serving([
    { body: 'service unavailable', status: 503 },
    { body: 'service unavailable', status: 503 },
    GROUP,
  ])
  const found = await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  assert.equal(gets.length, 3, 'two refusals, then the answer')
  assert.ok(found.lookup.found === true)
  assert.equal(found.warning, undefined, 'a retry that succeeded is not a disappointment')
})

test('the busy body is retried too: it is a refusal wearing a 200', async () => {
  const busy = JSON.stringify({ error: 'The MusicBrainz web server is currently busy. Please try again later.' })
  const { gets, ports } = serving([busy, GROUP])
  const found = await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  assert.equal(gets.length, 2)
  assert.ok(found.lookup.found === true)
})

test('retries are bounded, and a service that stays down is a warning', async () => {
  const { gets, ports } = serving([{ body: 'service unavailable', status: 503 }])
  const refused = await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  assert.equal(gets.length, MUSICBRAINZ_MAX_ATTEMPTS)
  assert.match(String(refused.warning), /503/)
})

test('a 404 is not retried: it will say the same thing three times', async () => {
  const { gets, ports } = serving([{ body: 'not found', status: 404 }])
  await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  assert.equal(gets.length, 1)
})

test('a refused request is a warning, not a failure', async () => {
  const { ports } = serving([{ body: 'service unavailable', status: 503 }])
  const refused = await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  assert.deepEqual(refused.lookup, { found: false })
  assert.match(String(refused.warning), /503/)
})

test('a body that is not JSON is a warning, not a crash', async () => {
  const { ports } = serving(['<html>bad gateway</html>'])
  const broken = await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  assert.deepEqual(broken.lookup, { found: false })
  assert.match(String(broken.warning), /not valid JSON/)
})
