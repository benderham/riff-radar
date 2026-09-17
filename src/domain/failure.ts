/**
 * What broke outside the process, in one of six words.
 *
 * A Failure Category and a Termination Reason answer different questions
 * (CONTEXT.md): a reason says why the *run* stopped, a category says what kind
 * of thing failed *outside* it. The run has nine reasons; the outside world has
 * six categories, and they are deliberately few because the set is a CHECK
 * constraint and splitting one later costs a schema change (ADR-0048).
 *
 * The prose in a warning stays where it is. The category sits beside it as the
 * countable thing, so a failure report is a GROUP BY rather than a parser.
 */

import { NO_ANSWER } from './http-outcome.ts'

/**
 * The six, in one list so that the schema's CHECK constraint and the type are
 * the same fact stated twice rather than two lists to keep in step.
 *
 * - `transient`: no answer at all, or a server having trouble. Worth asking again.
 * - `rate_limited`: told to slow down. Separate only because Retry-After changes the backoff.
 * - `refused`: credentials, or a bot wall. Asking again asks the same thing.
 * - `not_found`: a 404, which is an answer about what is there rather than a failed call.
 * - `malformed`: a 2xx whose body failed its schema. Raised by the client that read it.
 * - `unavailable`: a provider this run has already given up on. Set by a decision, never derived.
 */
export const FAILURE_CATEGORIES = [
  'transient',
  'rate_limited',
  'refused',
  'not_found',
  'malformed',
  'unavailable',
] as const

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number]

/**
 * The category a response states for itself, or nothing when it succeeded.
 *
 * `malformed` and `unavailable` are never returned here and cannot be: one is
 * known only after a parse the caller performs, the other only from a decision
 * the run has made. This covers what a status and a body can say on their own.
 */
export const categoriseFailure = (status: number, body: string): FailureCategory | undefined => {
  if (status === NO_ANSWER || status >= 500) return 'transient'
  if (status === 429) return 'rate_limited'

  // A gate refusing inside a 200 — MusicBrainz apologises this way rather than
  // with a 429 — is the same fact as a 429 and is retried the same way. Only a
  // client whose provider states failures in an otherwise fine body passes one
  // here; everywhere else this is reached on a status that already failed.
  if (status < 400) return status < 300 && /"error"\s*:/.test(body) ? 'rate_limited' : undefined

  if (status === 404) return 'not_found'

  // 401 and 403 are the cases that happen; everything else in the 4xx range is
  // still the server declining, and inventing a seventh name for a 410 would
  // buy a schema change and no answer anyone is asking.
  return 'refused'
}

/**
 * A category as a property to spread, or nothing at all.
 *
 * Clients carry the category beside a warning that already exists, and a
 * property that is present and undefined is not the same as an absent one under
 * `exactOptionalPropertyTypes`. This is the one place that spelling lives.
 */
export const optionalCategory = (
  failureCategory: FailureCategory | undefined,
): { failureCategory?: FailureCategory } => (failureCategory === undefined ? {} : { failureCategory })

/** The same, for a caller holding a response rather than a category. */
export const categorised = (status: number, body: string): { failureCategory?: FailureCategory } =>
  optionalCategory(categoriseFailure(status, body))

export const isRetryable = (category: FailureCategory): boolean =>
  category === 'transient' || category === 'rate_limited'

/**
 * A category on a thrown failure.
 *
 * Most failures are returned rather than thrown (ADR-0043), but the two that
 * end a run — a model call and a Notion write — throw, and the step recording
 * them needs the category as much as any other step does. It travels on the
 * error so the catch site does not have to re-derive it from a message.
 *
 * An undefined category leaves the error exactly as it was, so a caller that
 * has one and a caller that does not are the same line of code.
 */
export const withCategory = <E extends Error>(error: E, category: FailureCategory | undefined): E =>
  category === undefined ? error : Object.assign(error, { failureCategory: category })

export const categoryOf = (error: unknown): FailureCategory | undefined =>
  (error as { failureCategory?: FailureCategory } | null)?.failureCategory
