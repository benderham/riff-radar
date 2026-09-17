/**
 * What a request came back as, in words.
 *
 * A request that is answered has a status. A request that is never answered has
 * none, and the `http` adapter reports it as status zero with the reason in the
 * body (ADR-0043) — so the two are described in one place, and every client's
 * warning says which of the two happened rather than "HTTP 0".
 *
 * How many attempts it took is said here too, when it took more than one. It
 * belongs in the same sentence because it answers the question the sentence
 * raises: a step that took twenty seconds is explained rather than wondered
 * about, and the explanation reaches the trace by the route the warning already
 * takes (ADR-0049).
 */

/** Not a status: the request never reached a server, or never got an answer back. */
export const NO_ANSWER = 0

/**
 * Structural rather than `HttpResponse`, because the domain imports nothing
 * from the layers above it — and because the three fields always travel
 * together, which is what makes passing them one at a time a clump.
 */
interface Answered {
  readonly status: number
  readonly body: string
  readonly attempts: number
}

export const describeStatus = ({ status, body, attempts }: Answered): string => {
  const what = status === NO_ANSWER ? `no answer: ${body}` : `HTTP ${status}`

  return attempts > 1 ? `${what} after ${attempts} attempts` : what
}

/**
 * What a call that only succeeded by being tried again has to say, or nothing.
 *
 * A failure explains its own attempts through `describeStatus`, inside a
 * warning it was going to write anyway. A *success* after two refusals writes
 * no warning at all and is the lumpy step nobody can account for — it is the
 * case `attempts` exists for (ADR-0049), so it says so here instead.
 */
export const retriedNote = (what: string, attempts: number): string | undefined =>
  attempts > 1 ? `${what} answered after ${attempts} attempts` : undefined

/**
 * A warning built from everything worth saying, or no warning at all.
 *
 * A step can have two things to report at once — that a call was retried, and
 * that it then yielded nothing — and a result that overwrote one with the other
 * would lose whichever was written second. Spread like `optionalCategory`,
 * because an absent property and an undefined one are different things under
 * `exactOptionalPropertyTypes`.
 */
export const warned = (...notes: readonly (string | undefined)[]): { warning?: string } => {
  const said = notes.filter((note) => note !== undefined && note !== '').join('; ')

  return said === '' ? {} : { warning: said }
}
