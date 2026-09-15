/**
 * MusicBrainz, for identity and enrichment.
 *
 * A lookup answers one question — is this the release the sources meant, and
 * what does MusicBrainz know about it — and never introduces a release of its
 * own. A release MusicBrainz has never heard of comes back `{ found: false }`
 * and the run carries on with it: absence is missing evidence, not invalidity
 * (CONTEXT.md), so it is not even a warning.
 *
 * Everything that disappoints *is* a warning rather than a throw, as a
 * disappointing source already is (ADR-0030). MusicBrainz has one failure mode
 * worth naming: under load it answers HTTP 200 with `{"error": "…busy…"}`, so a
 * 2xx is not by itself a result and the body has to be read to know.
 *
 * The one-request-per-second limit lives here rather than in the callers, so
 * that no future caller can forget it (ADR-0034).
 */

import { z } from 'zod'

import {
  MUSICBRAINZ_ENDPOINT,
  MUSICBRAINZ_MAX_ATTEMPTS,
  MUSICBRAINZ_MIN_INTERVAL_MS,
  MUSICBRAINZ_MIN_SCORE,
} from '../../config.ts'
import type { MusicbrainzLookup } from '../domain/candidates.ts'
import type { Ports } from '../ports.ts'

export interface LookupFetch {
  readonly artist: string
  readonly title: string
  /** The last URL requested, for the trace. */
  readonly url: string
  readonly status: number
  readonly lookup: MusicbrainzLookup
  /** Present when MusicBrainz disappointed. Not set merely by finding nothing. */
  readonly warning?: string
}

/**
 * How long a caller owes the rate limit, given when the last request went out.
 *
 * Pure so the limit can be proved without spending a second per assertion; the
 * gate below is the one line that actually waits.
 */
export const nextRequestDelayMs = (lastRequestAt: number, now: number): number => {
  if (lastRequestAt === 0) return 0

  // A clock that has gone backwards owes nothing. Waiting out the difference
  // would stall the client for however far back it jumped — a few seconds after
  // an NTP correction, and a full day in a test that restarts its clock.
  if (now < lastRequestAt) return 0

  return Math.max(0, lastRequestAt + MUSICBRAINZ_MIN_INTERVAL_MS - now)
}

/**
 * Module-level on purpose: the limit is per client, not per call site, and
 * MusicBrainz counts requests from this process however they were prompted.
 *
 * It holds for *sequential* callers, which is what the loop is: one action at a
 * time, one lookup at a time. Two concurrent lookups would both read this
 * before either wrote it and fire together. Nothing concurrent exists to call
 * it, and a queue would be machinery for a caller this project does not have.
 */
let lastRequestAt = 0

const once = async (ports: Ports, url: string) => {
  const delay = nextRequestDelayMs(lastRequestAt, ports.clock.now().getTime())
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))

  lastRequestAt = ports.clock.now().getTime()
  return ports.http.get(url, { accept: 'application/json' })
}

/** A refusal this service makes when it is busy, and will likely not repeat. */
const isTransient = (status: number, body: string): boolean =>
  status === 503 || status === 429 || (status === 200 && body.includes('"error"'))

/**
 * Up to `MUSICBRAINZ_MAX_ATTEMPTS`, spaced by the same one-second gate.
 *
 * Only the transient refusals are retried: a 404 says the same thing however
 * many times it is asked, and repeating it spends seconds the run cannot get
 * back for a certainty it already has.
 */
const rateLimited = async (ports: Ports, url: string) => {
  let response = await once(ports, url)

  for (let attempt = 2; attempt <= MUSICBRAINZ_MAX_ATTEMPTS; attempt += 1) {
    if (!isTransient(response.status, response.body)) return response

    // Backing off further each time. A service shedding load is asking to be
    // left alone for longer than one that is merely busy, and retrying at a
    // fixed second is how a client becomes the problem.
    //
    // Expressed by owing the gate more time rather than by sleeping again, so
    // that there is exactly one sleep in this file and it is the one the clock
    // drives. A test whose clock does not advance pays none of it.
    lastRequestAt += MUSICBRAINZ_MIN_INTERVAL_MS * (attempt - 1)
    response = await once(ports, url)
  }

  return response
}

/** Every enriched field is optional: MusicBrainz's coverage is uneven by design. */
const groupSchema = z.object({
  id: z.string(),
  title: z.string(),
  score: z.number().optional(),
  'primary-type': z.string().optional(),
  'secondary-types': z.array(z.string()).optional(),
  'first-release-date': z.string().optional(),
  'artist-credit': z.array(z.object({ name: z.string() })).optional(),
})

const searchSchema = z.object({ 'release-groups': z.array(groupSchema).optional() })

const releasesSchema = z.object({
  releases: z
    .array(
      z.object({
        media: z
          .array(
            z.object({
              'track-count': z.number().optional(),
              tracks: z.array(z.object({ length: z.number().nullable().optional() })).optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
})

/** Comparable enough to match a calendar's spelling against MusicBrainz's. */
const key = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim()

/**
 * One body, either parsed or explained.
 *
 * MusicBrainz's busy response is the reason this reads the body before
 * trusting the status: it is a 200 whose payload is an apology.
 */
const bodyOf = (what: string, status: number, body: string): { data: unknown } | { warning: string } => {
  if (status < 200 || status >= 300) return { warning: `${what} returned HTTP ${status}` }

  let data: unknown
  try {
    data = JSON.parse(body)
  } catch (error) {
    return { warning: `${what}: body was not valid JSON: ${(error as Error).message}` }
  }

  const apology = (data as { error?: unknown }).error
  if (typeof apology === 'string') return { warning: `${what}: MusicBrainz said "${apology}"` }

  return { data }
}

const searchUrl = (artist: string, title: string): string => {
  const query = `artist:"${artist.replaceAll('"', '')}" AND releasegroup:"${title.replaceAll('"', '')}"`
  return `${MUSICBRAINZ_ENDPOINT}/release-group?query=${encodeURIComponent(query)}&fmt=json&limit=5`
}

const recordingsUrl = (releaseGroupId: string): string =>
  `${MUSICBRAINZ_ENDPOINT}/release?release-group=${releaseGroupId}&inc=recordings&fmt=json&limit=1`

/** The tracks and total running time of the first release in a group. */
const tracksOf = (data: unknown): { trackCount?: number; durationMs?: number } => {
  const parsed = releasesSchema.safeParse(data)
  const media = parsed.success ? (parsed.data.releases?.[0]?.media ?? []) : []
  if (media.length === 0) return {}

  const trackCount = media.reduce((total, disc) => total + (disc['track-count'] ?? 0), 0)
  const lengths = media.flatMap((disc) => (disc.tracks ?? []).map((track) => track.length))

  // A single untimed track makes the total an undercount, and an EP is refused
  // on a total that is short. Better no duration than one that excludes wrongly.
  const timed =
    lengths.length > 0 && lengths.every((length): length is number => typeof length === 'number')
  const durationMs = timed ? lengths.reduce((total, length) => total + length, 0) : undefined

  return {
    ...(trackCount > 0 ? { trackCount } : {}),
    ...(durationMs === undefined ? {} : { durationMs }),
  }
}

export const lookupRelease = async (
  ports: Ports,
  artist: string,
  title: string,
): Promise<LookupFetch> => {
  const url = searchUrl(artist, title)
  const what = `lookup of ${artist} — ${title}`
  const response = await rateLimited(ports, url)

  const base = { artist, title, url, status: response.status } as const
  const read = bodyOf(what, response.status, response.body)
  if ('warning' in read) return { ...base, lookup: { found: false }, warning: read.warning }

  const parsed = searchSchema.safeParse(read.data)
  if (!parsed.success) {
    return {
      ...base,
      lookup: { found: false },
      warning: `${what}: body had the wrong shape: ${z.prettifyError(parsed.error)}`,
    }
  }

  const match = (parsed.data['release-groups'] ?? []).find(
    (group) =>
      (group.score ?? 0) >= MUSICBRAINZ_MIN_SCORE &&
      key(group.title) === key(title) &&
      (group['artist-credit'] ?? []).some((credit) => key(credit.name) === key(artist)),
  )

  // Nothing matched is a legitimate answer, not a disappointment: the release is
  // Unverified and the run keeps it.
  if (match === undefined) return { ...base, lookup: { found: false } }

  const found = {
    found: true as const,
    releaseGroupId: match.id,
    secondaryTypes: match['secondary-types'] ?? [],
    artistCount: (match['artist-credit'] ?? []).length,
    ...(match['primary-type'] === undefined ? {} : { primaryType: match['primary-type'] }),
    ...(match['first-release-date'] === undefined
      ? {}
      : { firstReleaseDate: match['first-release-date'] }),
  }

  // Only an EP needs its tracks counted, and only an EP pays the second second.
  if (found.primaryType !== 'EP') return { ...base, lookup: found }

  const tracksAt = recordingsUrl(match.id)
  const second = await rateLimited(ports, tracksAt)
  const tracks = bodyOf(`${what}: its tracks`, second.status, second.body)

  // A failed follow-up costs the EP its thresholds, not its identity.
  if ('warning' in tracks) {
    return { ...base, url: tracksAt, status: second.status, lookup: found, warning: tracks.warning }
  }

  return { ...base, url: tracksAt, status: second.status, lookup: { ...found, ...tracksOf(tracks.data) } }
}
