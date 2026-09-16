/**
 * What a request came back as, in words.
 *
 * A request that is answered has a status. A request that is never answered has
 * none, and the `http` adapter reports it as status zero with the reason in the
 * body (ADR-0043) — so the two are described in one place, and every client's
 * warning says which of the two happened rather than "HTTP 0".
 */

/** Not a status: the request never reached a server, or never got an answer back. */
export const NO_ANSWER = 0

export const describeStatus = (status: number, body: string): string =>
  status === NO_ANSWER ? `no answer: ${body}` : `HTTP ${status}`
