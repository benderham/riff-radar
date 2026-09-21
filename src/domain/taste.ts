/**
 * The three subjective numbers: Acceptance Rate, Taste Yield, Shortlist Fill
 * Rate (ADR-0060).
 *
 * These measure whether the recommendations are worth having, which is a
 * different question from whether the machinery works — the Golden Dataset
 * answers the second and never the first. None of them gates anything.
 *
 * All three are reported per `profile_version` with `n` stated, because a
 * profile edit invalidates comparison across the boundary: two readings either
 * side of one are readings of two different agents.
 *
 * This is arithmetic over rows. The Notion read is wiring and lives in
 * `scripts/taste.ts` (ADR-0064); nothing here touches a port or a `Store`.
 */

import type { Rating } from './known-set.ts'
import { WRITE_PERMITTED } from './run.ts'

/** The Status Ben sets when the release did not belong on the list. */
const REJECTED = 'Rejected'

/** The Status the agent writes, and the one that means Ben has not judged yet. */
const PROPOSED = 'Proposed'

/** One Notion row, as much of it as these three numbers read. */
export interface ProposalRow {
  /** Empty for a row Ben entered by hand, and the run's id for a proposal. */
  readonly runId: string
  /** Absent where the column is empty or renamed: an unjudged row, not an error. */
  readonly status?: string
  readonly rating?: Rating
}

/** What the local store knows about a run, as much of it as these numbers read. */
export interface RunProfile {
  readonly runId: string
  readonly profileVersion: number
  /**
   * How the run stopped, or `null` for one still open.
   *
   * Read only to decide the Fill Rate denominator: a run killed before it
   * proposed anything never reached a shortlist to leave short.
   */
  readonly terminationReason?: string | null
}

export interface TasteReading {
  /** Proposals written under this version of the Taste Profile. */
  readonly proposals: number
  /** Proposals whose Status is not `Rejected` — the Acceptance Rate numerator. */
  readonly accepted: number
  /** Of those, the ones Ben has not judged at all. Reported beside the rate. */
  readonly unjudged: number
  /** Proposals rated at all: the Taste Yield denominator, never `proposals`. */
  readonly rated: number
  /** Rated `Rotate` or `AOTY`. */
  readonly preferred: number
  /** Runs that reached a shortlist decision: the Fill Rate denominator. */
  readonly runs: number
  /** Of those, the ones that proposed a full shortlist. */
  readonly full: number
}

/**
 * A profile version, or `unknown` for proposals whose run left no record of
 * one — Notion is shared and the store is local, so a row written by a run
 * whose database was deleted has no version to join on.
 *
 * It is a bucket of its own rather than a number folded into a real version:
 * guessing would put proposals under a profile that did not produce them, and
 * dropping them would silently shrink every n. Its three numbers are readable;
 * only the comparison across profiles is not.
 */
export type ProfileVersion = number | 'unknown'

export interface TasteMetrics {
  /** By `profile_version`, ascending, with `unknown` last. */
  readonly byProfileVersion: readonly (TasteReading & { readonly profileVersion: ProfileVersion })[]
  /** Rows with no `Run ID`: Ben's own entries, which are not proposals at all. */
  readonly handEntered: number
}

/** A share, or `undefined` where the denominator is zero and no share exists. */
export const share = (numerator: number, denominator: number): number | undefined =>
  denominator === 0 ? undefined : numerator / denominator

interface Bucket {
  proposals: number
  accepted: number
  unjudged: number
  rated: number
  preferred: number
  /** How many proposals each run of this version wrote. */
  readonly perRun: Map<string, number>
}

const empty = (): Bucket => ({
  proposals: 0,
  accepted: 0,
  unjudged: 0,
  rated: 0,
  preferred: 0,
  perRun: new Map(),
})

/**
 * The Termination Reasons that mean the run chose what to propose.
 *
 * The two that permit a write, plus `no_candidates` — which is a shortlist of
 * nothing rather than a run that never got that far, and is the extreme of
 * the caution Fill Rate exists to expose. The remaining six stopped before
 * there was a shortlist to fill.
 */
const DECIDED: readonly string[] = [...WRITE_PERMITTED, 'no_candidates']

/**
 * Whether a run belongs in the Fill Rate denominator.
 *
 * A run that was killed or ran out of steps counts only if it had already
 * written something: it never reached a decision, and scoring it as a short
 * shortlist would blame the agent for a laptop lid.
 */
const decided = (run: RunProfile, proposals: number): boolean =>
  DECIDED.includes(run.terminationReason ?? '') || proposals > 0

/**
 * The three numbers, bucketed by the profile version each proposal ran under.
 *
 * `shortlistSize` is the cap a full shortlist means — passed rather than
 * imported so the arithmetic stays a function of its inputs.
 */
export const measure = (
  rows: readonly ProposalRow[],
  runs: readonly RunProfile[],
  shortlistSize: number,
): TasteMetrics => {
  const versionOf = new Map(runs.map((run) => [run.runId, run.profileVersion]))
  const buckets = new Map<ProfileVersion, Bucket>()
  let handEntered = 0

  const bucketFor = (version: ProfileVersion): Bucket => {
    const bucket = buckets.get(version) ?? empty()
    buckets.set(version, bucket)

    return bucket
  }

  for (const row of rows) {
    const runId = row.runId.trim()
    if (runId === '') {
      handEntered += 1
      continue
    }

    const bucket = bucketFor(versionOf.get(runId) ?? 'unknown')
    bucket.proposals += 1
    // Not-rejected rather than accepted: an unjudged row counts, which is what
    // makes this number move without Ben listening to anything (ADR-0060). The
    // unjudged are counted too, so the rate cannot be read as a verdict when
    // nobody has given one.
    if (row.status !== REJECTED) bucket.accepted += 1
    if (row.status === undefined || row.status === PROPOSED) bucket.unjudged += 1
    if (row.rating !== undefined) {
      bucket.rated += 1
      if (row.rating === 'Rotate' || row.rating === 'AOTY') bucket.preferred += 1
    }

    bucket.perRun.set(runId, (bucket.perRun.get(runId) ?? 0) + 1)
  }

  // Runs are counted from the runs, not from the proposals: a run that wrote
  // nothing to Notion is exactly the run Fill Rate exists to notice, and
  // deriving the denominator from Notion rows alone would make it invisible.
  const denominator = new Map<ProfileVersion, Set<string>>()
  const count = (version: ProfileVersion, runId: string): void => {
    denominator.set(version, (denominator.get(version) ?? new Set()).add(runId))
    bucketFor(version)
  }

  for (const run of runs) {
    const proposals = buckets.get(run.profileVersion)?.perRun.get(run.runId) ?? 0
    if (decided(run, proposals)) count(run.profileVersion, run.runId)
  }

  // A proposal whose run nothing records still came from a run, and that run
  // filled its shortlist or did not. Counted from the rows, which is the only
  // evidence of it left.
  for (const runId of buckets.get('unknown')?.perRun.keys() ?? []) count('unknown', runId)

  return {
    byProfileVersion: [...buckets.entries()]
      // `unknown` sorts last, whatever versions exist beside it.
      .sort(([one], [other]) => (one === 'unknown' ? 1 : other === 'unknown' ? -1 : one - other))
      .map(([profileVersion, bucket]) => {
        const counted = [...(denominator.get(profileVersion) ?? [])]

        return {
          profileVersion,
          proposals: bucket.proposals,
          accepted: bucket.accepted,
          unjudged: bucket.unjudged,
          rated: bucket.rated,
          preferred: bucket.preferred,
          runs: counted.length,
          full: counted.filter((runId) => (bucket.perRun.get(runId) ?? 0) >= shortlistSize).length,
        }
      }),
    handEntered,
  }
}
