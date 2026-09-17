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
 * it is reported and exits the way they do. Ticket 04 adds its siblings.
 */
export class ResumeRefusal extends Error {
  override readonly name = 'ResumeRefusal'
}
