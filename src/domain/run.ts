/**
 * What a run is, and why it stopped.
 *
 * Exactly one termination reason is recorded per run. Only `completed` and
 * `completed_short` permit a Notion write; the other seven do not.
 */

export const TERMINATION_REASONS = [
  'completed',
  'completed_short',
  'no_candidates',
  'validation_failed',
  'invalid_action_limit',
  'max_steps_exceeded',
  'budget_exceeded',
  'tool_failure',
  'aborted',
] as const

export type TerminationReason = (typeof TERMINATION_REASONS)[number]

/** The only two reasons a shortlist may reach Notion. */
export const WRITE_PERMITTED: readonly string[] = ['completed', 'completed_short']

/**
 * A resume that cannot be honoured, refused before the run row.
 *
 * A refusal rather than a crash: nothing has been spent and nothing has been
 * written, which is the same contract the credential and schema checks keep, so
 * it is reported and exits the way they do. What it carries is either the
 * message `resumeRefusal` gave for the row, or the one the lookup gave for an
 * id matching no run or two.
 */
export class ResumeRefusal extends Error {
  override readonly name = 'ResumeRefusal'
}

/** The three versions a resume has to still agree with (ADR-0047). */
export interface RunVersions {
  readonly promptVersion: number
  readonly profileVersion: number
  readonly actionSchemaVersion: number
}

/**
 * Why this run cannot be continued, or nothing.
 *
 * Three of the four refusals; the fourth — a run id that matches no run, or
 * two — belongs to the lookup rather than to the row, and is raised where the
 * lookup happens. Each says what to do instead, because the answer to all three
 * is the same operation under a different name: a Re-run.
 *
 * Pure, and given the step count rather than the steps: what it needs to know
 * is whether the parent got anywhere, and counting is the caller's business.
 */
export const resumeRefusal = (
  parent: {
    readonly runId: string
    readonly terminationReason: TerminationReason | null
  } & RunVersions,
  stepCount: number,
  current: RunVersions,
): string | undefined => {
  // First, and alone: a run that ended is over whatever else is true of it, and
  // listing its other disagreements would describe a run nobody is resuming.
  if (parent.terminationReason !== null) {
    return `run ${parent.runId} already ended: ${parent.terminationReason}. Start a re-run instead`
  }

  if (stepCount === 0) {
    return `run ${parent.runId} recorded no steps, so there is nothing to continue. Start a re-run instead`
  }

  const moved = [
    ['prompt version', parent.promptVersion, current.promptVersion],
    ['profile version', parent.profileVersion, current.profileVersion],
    ['action-schema version', parent.actionSchemaVersion, current.actionSchemaVersion],
  ].filter(([, was, now]) => was !== now)

  // Every one that moved, at once: fixing them one at a time would mean three
  // refusals to learn one fact, and none of them is fixable anyway — the answer
  // is a re-run under the current versions.
  return moved.length === 0
    ? undefined
    : `run ${parent.runId} ran under a different ${moved
        .map(([what, was, now]) => `${what} (${was}, now ${now})`)
        .join(', a different ')}. Start a re-run instead`
}
