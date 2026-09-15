/**
 * Ranking: arithmetic Ben can reason about.
 *
 * The taste profile scores the attributes of a release — artist tier, label,
 * genre, personnel — and the sum decides the order of the shortlist (ADR-0006).
 * The model chooses *which* releases are worth proposing and writes the
 * rationale; where it has an opinion about order, it is overruled here, because
 * an ordering nobody can recompute is an ordering nobody can argue with.
 *
 * Three rules shape the arithmetic:
 *
 * - `artists.always` is a guaranteed slot rather than a large number, so no
 *   combination of other signals can outbid it (ADR-0007).
 * - `labels.exclude` and `genres.exclude` are negative weight rather than
 *   filters: a mistagged record can still reach the shortlist on other signals.
 * - A signal the data does not carry is dropped and the release proceeds, which
 *   is the opposite of the eligibility rule and deliberately so (ADR-0010).
 *
 * `vibe_notes` is the one place the model's judgement enters, and it only
 * counts when the claim is cited: `cited` is settled before it gets here, by
 * checking the quote against the Source Text this run actually stored.
 */

import { RANKING_WEIGHTS } from '../../config.ts'
import type { Candidate } from './candidates.ts'
import { artistTitleIdentity, candidateIdentity } from './candidates.ts'
import type { ShortlistItem } from './shortlist.ts'
import type { TasteProfile } from './taste-profile.ts'

/** One profile term that matched, and what it was worth. For the trace. */
export interface RankingSignal {
  readonly signal: 'artist' | 'label' | 'genre' | 'personnel' | 'vibe'
  readonly term: string
  readonly points: number
}

export interface Score {
  readonly total: number
  /** An `artists.always` match: a slot, not a score. */
  readonly guaranteed: boolean
  readonly signals: readonly RankingSignal[]
}

/** The model's resemblance judgement, with the Source Text it rests on. */
export interface CitedVibe {
  readonly claim: string
  readonly quote: string
  /** Whether the quote was found in this run's stored source text. */
  readonly cited: boolean
}

const normalise = (value: string): string => value.toLowerCase().replaceAll(/\s+/g, ' ').trim()

/**
 * A profile term matches a value it appears inside, so `death metal` finds
 * `dissonant death metal` and `Century Media` finds `Century Media Records`.
 * A term that matches several values scores once: the profile is what is being
 * counted, not how many ways the data says the same thing.
 */
const matching = (terms: readonly string[], values: readonly string[]): string[] => {
  const haystack = values.map(normalise).filter((value) => value !== '')
  return terms.filter((term) => {
    const needle = normalise(term)
    return needle !== '' && haystack.some((value) => value.includes(needle))
  })
}

const score = (
  signal: RankingSignal['signal'],
  terms: readonly string[],
  values: readonly string[],
  points: number,
): RankingSignal[] => matching(terms, values).map((term) => ({ signal, term, points }))

/**
 * Every artist this release is credited to: MusicBrainz's list where there is
 * one, and the name a source printed where there is not. The same rule
 * eligibility uses, for the same reason — a release is judged on who made it.
 */
const creditedArtists = (candidate: Candidate): readonly string[] =>
  candidate.lookup?.found === true && candidate.lookup.artists.length > 0
    ? candidate.lookup.artists
    : [candidate.artist]

export const scoreRelease = (
  candidate: Candidate,
  profile: TasteProfile,
  vibe?: CitedVibe,
): Score => {
  const looked = candidate.lookup?.found === true ? candidate.lookup : undefined
  const artists = creditedArtists(candidate)

  // MusicBrainz's label where there is one, and the source's where there is
  // not. Absent from both is a signal this release does not have.
  const labels = [looked?.label, candidate.label].filter((value) => value !== undefined)

  const signals: RankingSignal[] = [
    ...score('artist', profile.artists.watch, artists, RANKING_WEIGHTS.artistWatch),
    ...score('label', profile.labels.include, labels, RANKING_WEIGHTS.labelInclude),
    ...score('label', profile.labels.exclude, labels, RANKING_WEIGHTS.labelExclude),
    ...score('genre', profile.genres.include, looked?.genres ?? [], RANKING_WEIGHTS.genreInclude),
    ...score('genre', profile.genres.exclude, looked?.genres ?? [], RANKING_WEIGHTS.genreExclude),
    ...score('personnel', profile.personnel.include, looked?.members ?? [], RANKING_WEIGHTS.personnelInclude),
    ...score('personnel', profile.personnel.exclude, looked?.members ?? [], RANKING_WEIGHTS.personnelExclude),
    // An uncited judgement is not a judgement. It is dropped rather than
    // refused: the release keeps its place and is ranked on its data alone.
    ...(vibe?.cited === true
      ? [
          ...score('vibe', profile.vibe_notes.include, [vibe.claim], RANKING_WEIGHTS.vibeInclude),
          ...score('vibe', profile.vibe_notes.exclude, [vibe.claim], RANKING_WEIGHTS.vibeExclude),
        ]
      : []),
  ]

  return {
    total: signals.reduce((sum, each) => sum + each.points, 0),
    guaranteed: matching(profile.artists.always, artists).length > 0,
    signals,
  }
}

export interface RankedItem {
  /** The item as it will be written, with `rank` rewritten to its new position. */
  readonly item: ShortlistItem
  readonly score: Score
}

/**
 * The shortlist in the order the profile puts it, ranks renumbered from one.
 *
 * Guaranteed slots first, then score, and the model's own order last. That
 * final tie-break is the one place its judgement survives: where the profile
 * has nothing to say about two releases, the reason it preferred one is a
 * better answer than the order they happened to be discovered in.
 *
 * An item naming a release the run never discovered is scored as zero rather
 * than refused — `validateShortlist` is what refuses it, and ranking runs first
 * so the trace records what was proposed before it was judged.
 */
export const rankShortlist = (
  items: readonly ShortlistItem[],
  candidates: readonly Candidate[],
  profile: TasteProfile,
  vibes: ReadonlyMap<string, CitedVibe> = new Map(),
): RankedItem[] => {
  const discovered = new Map(candidates.map((candidate) => [candidateIdentity(candidate), candidate]))

  const scored = items.map((item, index) => {
    const identity = artistTitleIdentity(item.artist ?? '', item.title ?? '')
    const candidate = discovered.get(identity)
    return {
      item,
      index,
      score:
        candidate === undefined
          ? { total: 0, guaranteed: false, signals: [] }
          : scoreRelease(candidate, profile, vibes.get(identity)),
    }
  })

  return scored
    .sort(
      (one, other) =>
        Number(other.score.guaranteed) - Number(one.score.guaranteed) ||
        other.score.total - one.score.total ||
        (one.item.rank ?? one.index) - (other.item.rank ?? other.index) ||
        one.index - other.index,
    )
    .map(({ item, score: itemScore }, position) => ({
      item: { ...item, rank: position + 1 },
      score: itemScore,
    }))
}
