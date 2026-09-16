/**
 * HTTP, over built-in `fetch`.
 *
 * The only code in the project that performs a request. It reports what came
 * back and judges none of it: a 403 from a site that has decided it dislikes us
 * is a fact the client above needs to see and record, not an exception thrown
 * from the bottom of the stack.
 *
 * It does not throw either, and that is the whole of its contract: a request
 * that is never answered — a dead name, a reset connection, a timeout — comes
 * back as status zero with the reason in the body (ADR-0043), so a client's
 * existing "did this answer?" branch handles a dropped packet the same way it
 * handles a refusal. A run is not worth losing to one unlucky socket.
 *
 * `fetchImpl` is injected for the adapter's own tests only. Everything else
 * reaches HTTP through the port.
 */

import { HTTP_TIMEOUT_MS, USER_AGENT } from '../../config.ts'
import { NO_ANSWER } from '../domain/http-outcome.ts'
import type { HttpResponse, HttpPort } from '../ports.ts'

const read = async (response: Response) => ({
  status: response.status,
  headers: Object.fromEntries(response.headers),
  body: await response.text(),
})

/**
 * Why a request got no answer, in one line.
 *
 * `fetch` says "fetch failed" and puts everything that identifies the problem
 * — `ENOTFOUND`, `ECONNRESET`, the timeout — in `cause`, so the trace is worth
 * nothing without it: "fetch failed" was the message that sent a human to the
 * database to find out which host had gone away.
 *
 * Three things a first version missed, each of which produced `fetch failed:`
 * and nothing after it. An `AggregateError` carries its real reasons in
 * `errors` and has no message of its own — and that is the *interesting* case,
 * because it means every address was tried and every address failed, which is
 * what a host that resolves to both an IPv6 and an IPv4 address looks like when
 * only one of the two works. A `code` like `ENOTFOUND` hangs off the error
 * rather than sitting in its message. And an error with no message at all still
 * has a name worth printing.
 */
const because = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error)

  const code = (error as { code?: unknown }).code
  const self = [error.message || error.name, typeof code === 'string' ? `(${code})` : '']
    .filter(Boolean)
    .join(' ')

  const inner =
    error instanceof AggregateError && error.errors.length > 0
      ? `[${error.errors.map(because).join(', ')}]`
      : error.cause === undefined
        ? ''
        : because(error.cause)

  return [self, inner].filter(Boolean).join(': ')
}

const attempted = async (request: () => Promise<HttpResponse>): Promise<HttpResponse> => {
  try {
    return await request()
  } catch (error) {
    return { status: NO_ANSWER, headers: {}, body: because(error) }
  }
}

export const httpAdapter = (fetchImpl: typeof fetch = globalThis.fetch): HttpPort => ({
  async get(url, headers = {}) {
    return attempted(async () => {
      // The project's own identification leads, and a caller's headers follow,
      // because a search API's key is an addition to who we are and not a
      // disguise: nothing here ever claims to be a browser (ADR-0031).
      const response = await fetchImpl(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml', ...headers },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      })

      return read(response)
    })
  },

  async post(url, body, headers = {}) {
    return withBody(fetchImpl, 'POST', url, body, headers)
  },

  async patch(url, body, headers = {}) {
    return withBody(fetchImpl, 'PATCH', url, body, headers)
  },
})

/** POST and PATCH differ in one word, so they are one function. */
const withBody = async (
  fetchImpl: typeof fetch,
  method: 'POST' | 'PATCH',
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<HttpResponse> =>
  attempted(async () => {
    const response = await fetchImpl(url, {
      method,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'application/json',
        'content-type': 'application/json',
        ...headers,
      },
      body,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })

    return read(response)
  })
