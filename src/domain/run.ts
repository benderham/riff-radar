/**
 * What a run is, and why it stopped.
 *
 * Exactly one termination reason is recorded per run. Two of the nine permit a
 * Notion write; the other seven deliberately do not, and that mapping lives here as
 * data rather than being restated at each call site.
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
const WRITE_PERMITTED: ReadonlySet<TerminationReason> = new Set<TerminationReason>([
  'completed',
  'completed_short',
])

export const permitsNotionWrite = (reason: TerminationReason): boolean =>
  WRITE_PERMITTED.has(reason)

/** Token counts, kept apart because cached input is ~30x cheaper (ADR-0020). */
export interface TokenUsage {
  readonly uncachedInputTokens: number
  readonly cachedInputTokens: number
  readonly outputTokens: number
}

export const NO_TOKENS: TokenUsage = {
  uncachedInputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
}
