/**
 * The Known Set: Ben's hand-entered Notion rows, curated and bucketed by week.
 *
 * This is the reference set the Back-test measures coverage against (ADR-0062),
 * and the rule that defines it is ADR-0063's: a row belongs if its `Run ID` is
 * empty — hand-entered, so uncontaminated by the agent's own writes since 16
 * September — and its `Rating` is anything other than `Nope`. `OK` counts: it
 * means Ben listened and it was fine, which is a release the agent was right to
 * surface. A row left unrated is excluded and counted, because an unrated row
 * cannot be told apart from a `Nope`.
 *
 * `Rotate` and `AOTY` are deliberately not the membership bar. They survive as
 * a secondary number, and it is computed by the Back-test rather than here,
 * because it means nothing except where a week holds more than five.
 *
 * Every release carries both identities rather than one, for the same reason
 * `notion.ts` returns both: the intersection is on the MusicBrainz id where
 * both sides have one, and on artist and title where they do not, and Ben's
 * hand-entered rows mostly do not.
 *
 * Nothing here reads a `Store` or an HTTP port. The curation is arithmetic over
 * rows, so the script that fetches them is wiring and this is what the suite
 * tests (ADR-0064).
 */

import { z } from 'zod'

import { artistTitleIdentity } from './candidates.ts'

/** Ben's column, in his order. The agent writes none of them (ADR-0061). */
export const RATINGS = ['Nope', 'OK', 'Rotate', 'AOTY'] as const

export type Rating = (typeof RATINGS)[number]

/**
 * A `Rating` as Notion gives it, or `undefined` for anything else.
 *
 * Matched here rather than parsed by `z.enum`: a fifth option Ben adds to his
 * own column must make a row unrated, not abort the command reading it.
 */
export const ratingNamed = (name: string | undefined): Rating | undefined =>
  RATINGS.find((option) => option === name)

/** One Notion row, as much of it as curation reads. */
export interface CuratedRow {
  readonly artist: string
  readonly title: string
  readonly musicbrainzId?: string
  /** `YYYY-MM-DD`, or absent: a row with no Release Date cannot be bucketed. */
  readonly releaseDate?: string
  readonly rating?: Rating
  /** Empty for a hand-entered row, and the run's id for one the agent wrote. */
  readonly runId: string
}

/** A member of the Known Set, keeping both identities and its rating. */
export interface KnownRelease {
  readonly artistTitle: string
  readonly musicbrainzId?: string
  readonly rating: Rating
}

export interface KnownWeek {
  /** The Friday the week's seven-day window ends on. */
  readonly weekEnding: string
  /** `k`: what the Back-test normalises against, as `hits / min(k, 5)`. */
  readonly k: number
  readonly releases: readonly KnownRelease[]
}

/** Why the rows that are not members are not members. Reported, never folded in. */
export interface Exclusions {
  readonly agentWritten: number
  readonly unrated: number
  readonly nope: number
  readonly undated: number
  readonly unidentifiable: number
}

export interface KnownSet {
  readonly rows: number
  readonly members: number
  readonly weeks: readonly KnownWeek[]
  readonly excluded: Exclusions
}

/** What `known-set.json` has to carry for a Back-test to be computable from it. */
const frozenSchema = z.object({
  weeks: z.array(
    z.object({
      weekEnding: z.string(),
      releases: z.array(
        z.object({
          artistTitle: z.string(),
          musicbrainzId: z.string().optional(),
          rating: z.enum(RATINGS),
        }),
      ),
    }),
  ),
})

const FRIDAY = 5

/**
 * The Friday on or after a release date.
 *
 * A run is started with `--last-days 7` and `resolveWindow` reads that as the
 * seven dates ending today, so a Friday-morning run covers Saturday through
 * Friday and holds exactly one release Friday. Bucketing on the closing Friday
 * is therefore the same partition a weekly Golden Case will ask for, and the
 * bucket's name is the `now` that case is run at.
 */
export const weekEnding = (releaseDate: string): string => {
  // UTC throughout: these are calendar dates and the arithmetic must not depend
  // on the timezone the curation happened to be run in.
  const at = new Date(`${releaseDate}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + ((FRIDAY - at.getUTCDay() + 7) % 7))

  return at.toISOString().slice(0, 10)
}

/** A date this can bucket. Anything else is a row reported as undated. */
const DATED = /^\d{4}-\d{2}-\d{2}$/

/** ADR-0063's bar for the secondary number. Membership is `not Nope`; this is narrower. */
export const isPreferred = (release: KnownRelease): boolean =>
  release.rating === 'Rotate' || release.rating === 'AOTY'

/**
 * How many of a week's releases Ben rated `Rotate` or `AOTY`.
 *
 * ADR-0063's secondary number, and it means something only where `k > 5`: when
 * the five-item cap forced a choice, this is whether it chose well. Reported
 * for every week in the curation record, because that table is the record
 * rather than the measure, and read by the Back-test only above the cap.
 */
export const preferredCount = (week: KnownWeek): number => week.releases.filter(isPreferred).length

/**
 * The Known Set, and an account of everything left out of it.
 *
 * Weeks are returned in date order and hold at least one release each, which is
 * the pool ticket 05 picks its twelve from. A duplicate identity inside a week
 * counts once, so a row entered twice does not inflate `k` and depress the
 * measure it is the denominator of.
 */
export const curate = (rows: readonly CuratedRow[]): KnownSet => {
  const excluded = { agentWritten: 0, unrated: 0, nope: 0, undated: 0, unidentifiable: 0 }
  const byWeek = new Map<string, Map<string, KnownRelease>>()

  for (const row of rows) {
    if (row.runId.trim() !== '') {
      excluded.agentWritten += 1
      continue
    }
    if (row.rating === undefined) {
      excluded.unrated += 1
      continue
    }
    if (row.rating === 'Nope') {
      excluded.nope += 1
      continue
    }
    // A missing date and an unreadable one are the same thing to a week
    // bucket, and neither may take the whole freeze down with it.
    if (row.releaseDate === undefined || !DATED.test(row.releaseDate)) {
      excluded.undated += 1
      continue
    }

    const artist = row.artist.trim()
    const title = row.title.trim()
    if (artist === '' || title === '') {
      // Neither identity can be formed, so nothing could ever match it.
      excluded.unidentifiable += 1
      continue
    }

    const artistTitle = artistTitleIdentity(artist, title)
    const musicbrainzId = row.musicbrainzId?.trim() ?? ''
    const week = weekEnding(row.releaseDate)
    const releases = byWeek.get(week) ?? new Map<string, KnownRelease>()

    // Keyed on artist and title rather than on the MusicBrainz id, because
    // most of Ben's hand-entered rows carry no id: keying on the id where it
    // exists would count a release entered twice, once with an id and once
    // without, as two — inflating the `k` the Back-test divides by.
    releases.set(artistTitle, {
      artistTitle,
      rating: row.rating,
      ...(musicbrainzId === '' ? {} : { musicbrainzId }),
    })
    byWeek.set(week, releases)
  }

  const weeks = [...byWeek.entries()]
    .sort(([one], [other]) => one.localeCompare(other))
    .map(([week, releases]) => ({
      weekEnding: week,
      k: releases.size,
      releases: [...releases.values()],
    }))

  return {
    rows: rows.length,
    members: weeks.reduce((total, week) => total + week.k, 0),
    weeks,
    excluded,
  }
}

/**
 * A frozen set as read back from `known-set.json`, keyed by week.
 *
 * The parse is deliberately narrow: only what the Back-test divides by, so a
 * file written by an older freeze still resolves rather than failing the pass
 * that reads it. Keyed by the closing Friday, which is what a case's resolved
 * window ends on — that is how a case finds its week without carrying a field
 * naming one (ADR-0066).
 */
export const knownSetWeeks = (frozen: unknown): Map<string, KnownWeek> =>
  new Map(
    frozenSchema.parse(frozen).weeks.map((week) => [
      week.weekEnding,
      {
        weekEnding: week.weekEnding,
        k: week.releases.length,
        // Rebuilt field by field rather than spread: an absent id and an
        // `undefined` one are different things under the strict optional
        // types, and zod's `.optional()` produces the second.
        releases: week.releases.map((release) => ({
          artistTitle: release.artistTitle,
          rating: release.rating,
          ...(release.musicbrainzId === undefined ? {} : { musicbrainzId: release.musicbrainzId }),
        })),
      },
    ]),
  )
