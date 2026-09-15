/**
 * Candidates, and what makes two of them the same release.
 *
 * A candidate is a release a source listed and nothing has yet judged. The
 * model extracts them from cleaned page text (ADR-0003); everything after that
 * — tidying the strings, refusing an unusable row, merging the same release
 * across sources — is arithmetic, and lives here as pure functions so it can be
 * proved without a network or a model.
 *
 * Identity is artist and title at this stage. MusicBrainz release-group ids are
 * the reliable identity (CONTEXT.md) but no lookup has happened yet in ticket
 * 02, so this is deliberately the weaker half of the rule and ticket 04
 * strengthens it.
 */

import { z } from 'zod'

import type { DateWindow } from './window.ts'

/** What the extraction call is asked to return. Every field is untrusted text. */
export const extractionSchema = z.object({
  candidates: z.array(
    z.object({
      artist: z.string(),
      title: z.string(),
      /** `YYYY-MM-DD` as the source stated it. Anything else is refused below. */
      releaseDate: z.string(),
      label: z.string().optional(),
      /** What the source called it: `full-length`, `EP`, `live album`. */
      format: z.string().optional(),
    }),
  ),
})

export type ExtractedCandidate = z.infer<typeof extractionSchema>['candidates'][number]

/**
 * What a MusicBrainz lookup found, or that it found nothing.
 *
 * Three states, one field: absent means nobody has looked yet, `found: false`
 * means MusicBrainz has never heard of this release, and the rest is what it
 * knew. The distinction matters because they are not the same evidence — an
 * unlooked-up release is a step the run did not take, and an Unverified one is
 * a fact about MusicBrainz (CONTEXT.md).
 *
 * Every enriched field is optional because MusicBrainz's coverage is uneven,
 * and partial data enriches what it can rather than being refused whole.
 */
export type MusicbrainzLookup =
  | { readonly found: false }
  | {
      readonly found: true
      /** The Release Identity: a release-group id, not a release id. */
      readonly releaseGroupId: string
      /** `Album`, `EP`, `Single`, `Broadcast`, `Other`. */
      readonly primaryType?: string
      /** `Live`, `Compilation`, `Remix`, `Demo`, `Soundtrack`, … Usually empty. */
      readonly secondaryTypes: readonly string[]
      /** The release group's earliest official date, which a reissue does not move. */
      readonly firstReleaseDate?: string
      /** From a second lookup, made only for an EP. */
      readonly trackCount?: number
      readonly durationMs?: number
      /** More than one credited artist is how a split looks. */
      readonly artistCount: number
    }

export interface Candidate {
  readonly artist: string
  readonly title: string
  /** Every distinct date any source gave, ascending. More than one is a disagreement. */
  readonly releaseDates: readonly string[]
  readonly sourceUrls: readonly string[]
  readonly label?: string
  readonly format?: string
  /** Absent until `lookup_release` has been spent on this candidate. */
  readonly lookup?: MusicbrainzLookup
}

const tidy = (value: string): string => value.replaceAll(/\s+/g, ' ').trim()

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar date, not merely a string shaped like one: `2026-13-01` is not. */
const isCalendarDate = (value: string): boolean => {
  if (!ISO_DATE.test(value)) return false
  const at = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(at.getTime()) && at.toISOString().startsWith(value)
}

/**
 * One extracted row as a candidate, or nothing.
 *
 * A row without an artist, a title or a usable date is refused rather than
 * repaired: a run covers an absolute window, so a release whose date cannot be
 * read cannot be placed in or out of it, and guessing at `September 12, 2026`
 * would put an invention into the trace. The caller counts what it dropped.
 */
export const normaliseCandidate = (
  raw: ExtractedCandidate,
  sourceUrl: string,
): Candidate | undefined => {
  const artist = tidy(raw.artist)
  const title = tidy(raw.title)
  const releaseDate = tidy(raw.releaseDate)
  if (artist === '' || title === '' || !isCalendarDate(releaseDate)) return undefined

  const label = tidy(raw.label ?? '')
  const format = tidy(raw.format ?? '')

  return {
    artist,
    title,
    releaseDates: [releaseDate],
    sourceUrls: [sourceUrl],
    ...(label === '' ? {} : { label }),
    ...(format === '' ? {} : { format }),
  }
}

/** Release identity before MusicBrainz: artist and title, case- and space-insensitive. */
export const artistTitleIdentity = (artist: string, title: string): string =>
  `${artist.trim().toLowerCase()}|${title.trim().toLowerCase()}`

export const candidateIdentity = (candidate: Candidate): string =>
  artistTitleIdentity(candidate.artist, candidate.title)

/**
 * A candidate belongs to a run when *any* source places it inside the window.
 *
 * Any, not all: sources disagree by a day or two routinely, and a release one
 * of them dates a day early is still the release the run is asking about. The
 * disagreement is already recorded; this is not the place to resolve it.
 *
 * A run is backward-looking and a release calendar covers a year, so filtering
 * here is what keeps a fetch from handing the loop twelve months of releases.
 */
export const withinWindow = (candidate: Candidate, window: DateWindow): boolean =>
  candidate.releaseDates.some((date) => date >= window.from && date <= window.to)

/**
 * The same release listed by several sources is one candidate carrying all of
 * them. Disagreements are kept, never resolved: a release the Wikipedia page
 * dates a day earlier than Loudwire stays one candidate with both dates, and
 * whoever reads the trace can see that the sources differed. More than one date
 * is what a disagreement is; nothing else records it.
 */
export const mergeCandidates = (
  existing: readonly Candidate[],
  incoming: readonly Candidate[],
): Candidate[] => {
  const byIdentity = new Map<string, Candidate>()

  for (const candidate of [...existing, ...incoming]) {
    const identity = candidateIdentity(candidate)
    const held = byIdentity.get(identity)

    byIdentity.set(
      identity,
      held === undefined
        ? candidate
        : {
            // Spread order is the gap-filling rule: the first source to state a
            // label or a format keeps it, and a later one fills only what is
            // absent, because `normaliseCandidate` omits an absent optional
            // rather than setting it undefined.
            ...candidate,
            ...held,
            releaseDates: [...new Set([...held.releaseDates, ...candidate.releaseDates])].sort(),
            sourceUrls: [...new Set([...held.sourceUrls, ...candidate.sourceUrls])],
          },
    )
  }

  return [...byIdentity.values()]
}
