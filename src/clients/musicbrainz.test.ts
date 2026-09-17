import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { MUSICBRAINZ_MIN_INTERVAL_MS, USER_AGENT } from '../../config.ts'
import { NO_ANSWER } from '../domain/http-outcome.ts'
import { httpAdapter } from '../adapters/http.ts'
import type { ClockPort, HttpPort, Ports } from '../ports.ts'
import { lookupRelease, nextRequestDelayMs } from './musicbrainz.ts'

const fixture = (name: string) => readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8')

const GROUP = fixture('musicbrainz-release-group.json')
const NOT_FOUND = fixture('musicbrainz-not-found.json')
const PARTIAL = fixture('musicbrainz-partial.json')
const EP_GROUP = fixture('musicbrainz-ep-group.json')
const EP_RECORDINGS = fixture('musicbrainz-ep-recordings.json')
const RELEASE_LABELS = fixture('musicbrainz-release-labels.json')
const GENRES = fixture('musicbrainz-genres.json')
const ARTIST_RELS = fixture('musicbrainz-artist-rels.json')
const UNTYPED = fixture('musicbrainz-untyped-group.json')

/**
 * A clock that leaps an hour between readings, so the gate is never owed
 * anything and no test spends real seconds waiting one out.
 *
 * Nothing is lost by this: the gate's arithmetic is proved directly by the
 * `nextRequestDelayMs` assertions above.
 */
const tickingClock = (): ClockPort => {
  let at = new Date('2026-09-15T00:00:00Z').getTime()
  return { now: () => new Date((at += 60 * 60_000)), sleep: async () => {} }
}

const serving = (bodies: readonly (string | { body: string; status: number; attempts?: number })[]) => {
  const gets: { url: string; headers?: Record<string, string> }[] = []
  let call = 0
  const http: HttpPort = {
    patch: async () => { throw new Error('unexpected patch') },
    get: async (url, headers) => {
      gets.push({ url, ...(headers === undefined ? {} : { headers }) })
      const next = bodies[Math.min(call++, bodies.length - 1)]!
      const answer = typeof next === 'string' ? { body: next, status: 200 } : next
      return {
        status: answer.status,
        attempts: answer.attempts ?? 1,
        headers: { 'content-type': 'application/json' },
        body: answer.body,
      }
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
  assert.equal(nextRequestDelayMs(0, Date.now()), 0, 'the first request of a run does not wait')
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
  assert.deepEqual(found.lookup.artists, ['Ulcerate'])
  assert.deepEqual(found.lookup.secondaryTypes, [])

  const [call] = gets
  assert.match(call?.url ?? '', /release-group\?query=/)
  assert.match(call?.url ?? '', /fmt=json/)
  assert.equal(call?.headers?.['accept'], 'application/json')
  // The agent itself is attached by the adapter and asserted there; what matters
  // here is that MusicBrainz's terms are met by the one this project sends.
  assert.match(USER_AGENT, /https?:\/\//, 'MusicBrainz asks for a contactable user agent')
})

test('an identified release costs three more requests, one per adjacency signal', async () => {
  const { gets, ports } = serving([GROUP])
  await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  // Ticket 04 stopped at identity and an album cost one request. Label, genre
  // and personnel are each their own resource at MusicBrainz, so each is its
  // own request and its own second (ADR-0038).
  assert.equal(gets.length, 4)
  assert.match(gets[1]?.url ?? '', /release\?release-group=.*inc=recordings\+labels/)
  assert.match(gets[2]?.url ?? '', /release-group\/[^?]+\?inc=genres/)
  assert.match(gets[3]?.url ?? '', /artist\/[^?]+\?inc=artist-rels/)
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
  const { gets, ports } = serving([EP_GROUP, EP_RECORDINGS])
  const ep = await lookupRelease(ports, 'Ulcerate Fester', 'Unceasing Life')

  assert.equal(gets.length, 4, 'the release group, then its release, genres and people')
  assert.match(gets[1]?.url ?? '', /inc=recordings/)
  assert.ok(ep.lookup.found === true)
  assert.equal(ep.lookup.trackCount, 4)
  assert.equal(ep.lookup.durationMs, 1_610_000)
})

test('an EP whose tracks are listed but untimed reports no duration at all', async () => {
  // A duration summed from an incomplete tracklist is an undercount, and an
  // undercount excludes an EP that should qualify. Better absent than wrong.
  const untimed = JSON.stringify({ releases: [{ media: [{ 'track-count': 5, tracks: [{ length: 60_000 }, { length: null }] }] }] })
  const { ports } = serving([EP_GROUP, untimed])
  const ep = await lookupRelease(ports, 'Ulcerate Fester', 'Unceasing Life')

  assert.ok(ep.lookup.found === true)
  assert.equal(ep.lookup.trackCount, 5)
  assert.equal(ep.lookup.durationMs, undefined)
})

test('an EP whose second request fails keeps the identity it already has', async () => {
  const { ports } = serving([EP_GROUP, { body: 'gateway timeout', status: 504 }])
  const ep = await lookupRelease(ports, 'Ulcerate Fester', 'Unceasing Life')

  assert.ok(ep.lookup.found === true)
  assert.equal(ep.lookup.releaseGroupId, 'dd8a80d5-83d7-41b9-bc06-2efdfe80d5f4')
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

test('a 503 is asked once here: trying again is the adapter\'s job now (ADR-0049)', async () => {
  // This file used to prove three attempts. Retry moved to the one place that
  // performs a request, so what this client owes is the opposite assertion —
  // it asks once and reports what came back. The three attempts are proved in
  // the adapter's own tests, where every client inherits them.
  const { gets, ports } = serving([{ body: 'service unavailable', status: 503 }])
  const refused = await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  assert.equal(gets.length, 1)
  assert.match(String(refused.warning), /503/)
})

test('the busy body is a refusal wearing a 200, and is reported as one', async () => {
  const busy = JSON.stringify({ error: 'The MusicBrainz web server is currently busy. Please try again later.' })
  const { gets, ports } = serving([busy])
  const refused = await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  assert.equal(gets.length, 1)
  assert.match(String(refused.warning), /busy/)
})

test('a dead socket is warned about by name rather than as HTTP 0 (ADR-0043)', async () => {
  // What the adapter hands a client when the request never got an answer: not a
  // throw, and not a status. A run lost its whole shortlist to one of these.
  const dead = { body: 'fetch failed: getaddrinfo ENOTFOUND musicbrainz.org', status: NO_ANSWER }
  const { gets, ports } = serving([dead])
  const refused = await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  assert.equal(gets.length, 1)
  assert.match(String(refused.warning), /no answer: fetch failed: getaddrinfo ENOTFOUND/)
  assert.equal(refused.lookup.found, false, 'unverified, which is missing evidence, not invalidity')
})

test('a retried call says so in its warning, so the trace explains the seconds', async () => {
  const { ports } = serving([{ body: 'service unavailable', status: 503, attempts: 3 }])
  const refused = await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  assert.match(String(refused.warning), /HTTP 503 after 3 attempts/)
})

test('a lookup that succeeded only on the third ask accounts for its seconds too', async () => {
  // The case `attempts` exists for: nothing failed, so nothing would otherwise
  // be written down, and the step is inexplicably slow in the trace.
  const { ports } = serving([
    { body: GROUP, status: 200, attempts: 3 },
    { body: RELEASE_LABELS, status: 200 },
    { body: GENRES, status: 200 },
    { body: ARTIST_RELS, status: 200 },
  ])
  const found = await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  assert.ok(found.lookup.found === true, 'a retry that worked is still a result')
  assert.match(String(found.warning), /answered after 3 attempts/)
})

test('the gate and the adapter\'s retry compose without sleeping twice for one request', async () => {
  // The real adapter, so the backoff is the real backoff, over a clock that
  // records what it was asked to wait and leaps an hour between readings — so
  // the gate is never owed anything and every recorded wait is the backoff's.
  const waits: number[] = []
  let at = new Date('2026-09-15T00:00:00Z').getTime()
  const clock: ClockPort = {
    now: () => new Date((at += 60 * 60_000)),
    sleep: async (ms) => {
      waits.push(ms)
    },
  }

  const bodies = ['down', GROUP, RELEASE_LABELS, GENRES, ARTIST_RELS]
  let call = 0
  const fetchImpl = async () => {
    const body = bodies[Math.min(call++, bodies.length - 1)]!
    return new Response(body, { status: body === 'down' ? 503 : 200 })
  }

  const ports = { http: httpAdapter(clock, fetchImpl as typeof fetch), clock } as Ports
  const found = await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  assert.ok(found.lookup.found === true, 'the retry recovered the lookup')
  assert.equal(waits.length, 1, 'one refusal, one backoff — the gate charged nothing on top')
  assert.ok(waits[0]! > 0 && waits[0]! < 2_000, 'and it was the first backoff, not a second second')
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

// ── Adjacency: label, genre and the band's people (ADR-0038) ────────────────

test('an identified release carries its label, its genres and its band members', async () => {
  const { ports } = serving([GROUP, RELEASE_LABELS, GENRES, ARTIST_RELS])
  const found = await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  assert.ok(found.lookup.found === true)
  assert.equal(found.lookup.label, 'Debemur Morti Productions')
  assert.ok(found.lookup.genres?.includes('dissonant death metal'))
  assert.ok(found.lookup.genres?.includes('technical death metal'))
  // Current and past both: a drummer who has left is exactly the connection
  // that brings a new band to Ben's attention.
  assert.ok(found.lookup.members?.includes('Jamie Saint Merat'))
  assert.ok(found.lookup.members?.includes('Michael Rothwell'), 'a past member counts')
  assert.equal(
    new Set(found.lookup.members).size,
    found.lookup.members?.length,
    'a member credited twice is named once',
  )
  assert.equal(found.warning, undefined)
})

test('an adjacency request that fails costs the release that signal, not its identity', async () => {
  const { ports } = serving([
    GROUP,
    { body: 'not found', status: 404 },
    GENRES,
    { body: 'not found', status: 404 },
  ])
  const found = await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  assert.ok(found.lookup.found === true)
  assert.equal(found.lookup.releaseGroupId, 'c302ec77-589f-462f-b6b3-d63508886978')
  assert.equal(found.lookup.label, undefined)
  assert.equal(found.lookup.members, undefined)
  assert.ok(found.lookup.genres?.includes('death metal'), 'the signal that answered still arrives')
  assert.match(found.warning ?? '', /its release.*404/)
  assert.match(found.warning ?? '', /its band members.*404/)
})

test('a release group nobody is credited on asks nobody for members', async () => {
  const anonymous = JSON.stringify({
    'release-groups': [
      { id: 'rg-1', title: 'Unceasing Life', score: 100, 'primary-type': 'Album', 'artist-credit': [{ name: 'Ulcerate Fester' }] },
    ],
  })
  const { gets, ports } = serving([anonymous, RELEASE_LABELS, GENRES])
  const found = await lookupRelease(ports, 'Ulcerate Fester', 'Unceasing Life')

  assert.equal(gets.length, 3, 'no artist id, no fourth request')
  assert.ok(found.lookup.found === true)
  assert.equal(found.lookup.members, undefined)
})

test('"[no label]" is MusicBrainz saying there is none, not a label named that', async () => {
  const selfReleased = JSON.stringify({
    releases: [{ 'label-info': [{ label: { name: '[no label]' } }], media: [] }],
  })
  const { ports } = serving([GROUP, selfReleased, GENRES, ARTIST_RELS])
  const found = await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  assert.ok(found.lookup.found === true)
  assert.equal(found.lookup.label, undefined)
})

test('a release group MusicBrainz has not typed comes back without a type, not without a lookup', async () => {
  // Captured from the live service: *Mother of Millions — T*, which has an
  // identity, a date and an official release, and no primary type at all.
  const { ports } = serving([UNTYPED, RELEASE_LABELS, GENRES, ARTIST_RELS])
  const found = await lookupRelease(ports, 'Mother of Millions', 'T')

  assert.equal(found.warning, undefined)
  assert.ok(found.lookup.found === true)
  assert.equal(found.lookup.primaryType, undefined, 'absent, rather than invented')
  assert.equal(found.lookup.releaseGroupId, '8c8418df-b881-491e-bbdc-39454b80f78d')
  assert.equal(found.lookup.firstReleaseDate, '2026-09-11')
})

// ── Failure categories (ticket 01) ───────────────────────────────────────────

test('the busy body is a rate limit, which is what makes it worth asking again', async () => {
  const busy = JSON.stringify({ error: 'The MusicBrainz web server is currently busy. Please try again later.' })
  const { ports } = serving([busy])
  const refused = await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  assert.equal(refused.failureCategory, 'rate_limited')
})

test('a service that stayed down is transient, and a 404 is not', async () => {
  const down = await lookupRelease(serving([{ body: 'service unavailable', status: 503 }]).ports, 'Ulcerate', 'X')
  assert.equal(down.failureCategory, 'transient')

  const missing = await lookupRelease(serving([{ body: 'not found', status: 404 }]).ports, 'Ulcerate', 'X')
  assert.equal(missing.failureCategory, 'not_found')
})

test('a body that is not JSON is malformed, whatever the status said', async () => {
  const { ports } = serving(['<html>bad gateway</html>'])
  const broken = await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  assert.equal(broken.failureCategory, 'malformed')
})

test('a release nobody has heard of is not a failure and has no category', async () => {
  const { ports } = serving([JSON.stringify({ 'release-groups': [] })])
  const unknown = await lookupRelease(ports, 'Nobody', 'Nothing')

  assert.equal(unknown.lookup.found, false)
  assert.equal(unknown.failureCategory, undefined)
})

test('an adjacency failure is categorised by the call that produced the warning', async () => {
  // Not retried, so the sequence below is the sequence the client requests:
  // the release is missing, the genres and the members are not.
  const { ports } = serving([GROUP, { body: 'not found', status: 404 }, GENRES, ARTIST_RELS])
  const found = await lookupRelease(ports, 'Ulcerate', 'Cutting the Throat of God')

  assert.ok(found.lookup.found === true, 'the identity survives a failed adjacency')
  assert.match(String(found.warning), /its release/)
  assert.equal(found.failureCategory, 'not_found')
})
