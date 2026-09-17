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

export const describeStatus = (status: number, body: string, attempts = 1): string => {
  const what = status === NO_ANSWER ? `no answer: ${body}` : `HTTP ${status}`

  return attempts > 1 ? `${what} after ${attempts} attempts` : what
}
