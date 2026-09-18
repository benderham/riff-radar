/**
 * The Back-test: how much of a week's Known Set a run's Shortlist found.
 *
 * One line of arithmetic, `hits / min(k, 5)`, and the `min` is the whole idea
 * (ADR-0062). Below the cap it reads as plain recall — five slots and three
 * known albums means three were there to find. Above it, the run could not have
 * proposed more than five however good it was, so the measure becomes precision
 * against the known pool rather than recall of a pool no shortlist could hold.
 * Busy weeks are therefore read rather than excluded: excluding them would
 * select exactly the quiet ones and bias the sample toward easy cases.
 *
 * A proposal matching nothing known is **not** counted against the run. The
 * Known Set is what Ben's taste drew from, not the whole of what he would have
 * wanted, and a release he had never heard of is ticket 08's review queue.
 *
 * Nothing here is a Defect. `missed` grades the same absence per release and is
 * a finding; this is the same fact normalised, and the two are read together.
 */

import { SHORTLIST_SIZE } from '../../config.ts'
import { artistTitleIdentity } from './candidates.ts'
import type { KnownRelease, KnownWeek } from './known-set.ts'
import type { ShortlistItem } from './shortlist.ts'

/** A Golden Case's window: seven days ending on the week's Friday. */
const WINDOW_DAYS = 7

export interface BacktestResult {
  readonly weekEnding: string
  /** The Known Set's size for the week: what the score is normalised against. */
  readonly k: number
  readonly hits: number
  /** `hits / min(k, SHORTLIST_SIZE)`, and zero where the week holds nothing. */
  readonly score: number
  /**
   * How many of the matches Ben rated `Rotate` or `AOTY`, present only where
   * `k > SHORTLIST_SIZE`. Below the cap no choice was forced and the number
   * would be noise (ADR-0063).
   */
  readonly preferred?: number
}

/**
 * Release Identity across the two sides, which do not carry the same
 * identifiers: the MusicBrainz id where **both** have one, and artist and title
 * otherwise. Most of Ben's hand-entered rows have no id, so the fallback is the
 * ordinary case rather than the exception — and two different ids are two
 * different releases whatever they are called, because an id is the stronger
 * claim and disagreeing ids are a disagreement rather than a near miss.
 */
const matches = (item: ShortlistItem, release: KnownRelease): boolean => {
  const proposedId = item.musicbrainzId?.trim() ?? ''
  const knownId = release.musicbrainzId ?? ''

  return proposedId !== '' && knownId !== ''
    ? proposedId === knownId
    : artistTitleIdentity(item.artist ?? '', item.title ?? '') === release.artistTitle
}

export const backtest = (
  shortlist: readonly ShortlistItem[],
  week: KnownWeek,
): BacktestResult => {
  // Counted over the known releases rather than over the shortlist, so the same
  // release proposed twice is one hit and `hits` can never exceed `k`.
  const found = week.releases.filter((release) => shortlist.some((item) => matches(item, release)))

  const available = Math.min(week.k, SHORTLIST_SIZE)

  return {
    weekEnding: week.weekEnding,
    k: week.k,
    hits: found.length,
    score: available === 0 ? 0 : found.length / available,
    ...(week.k > SHORTLIST_SIZE
      ? {
          preferred: found.filter(
            (release) => release.rating === 'Rotate' || release.rating === 'AOTY',
          ).length,
        }
      : {}),
  }
}

/**
 * Which weeks of the frozen Known Set become Golden Cases.
 *
 * A rule rather than a hand-picked list, because the twelve weeks are the
 * back-test's whole sample and choosing them by eye is how a benchmark ends up
 * measuring the easy cases (ADR-0062). The earliest qualifying weeks are taken:
 * `fixtures/wikipedia.html` loses 36% of itself to truncation concentrated in
 * the *later* months, so the start of the year is where the committed bytes are
 * closest to what a real run would have read (carried-forward item 1).
 *
 * A week is only a candidate if its **whole seven-day window** falls inside the
 * year the Source pages cover. Both Sources are year pages, so the week ending
 * 2026-01-02 opens on 2025-12-27 and six of its days are on a calendar nobody
 * captured — the case could only ever see part of its own window (carried-
 * forward item 6).
 *
 * Busy weeks are not excluded: a week holding more than five members is the
 * above-cap regime `score` exists to read, and the sample needs one.
 */
export const weeksToHarvest = (
  weeks: readonly KnownWeek[],
  { count, year }: { readonly count: number; readonly year: number },
): readonly KnownWeek[] =>
  [...weeks]
    .filter((week) => {
      const opens = new Date(`${week.weekEnding}T00:00:00Z`)
      opens.setUTCDate(opens.getUTCDate() - (WINDOW_DAYS - 1))
      return week.weekEnding.startsWith(`${year}-`) && opens.getUTCFullYear() === year
    })
    .sort((one, other) => one.weekEnding.localeCompare(other.weekEnding))
    .slice(0, count)
