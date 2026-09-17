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
 * It also owns trying again (ADR-0049). Retry belongs here and nowhere else:
 * a helper each client wrapped its own call in would be four call sites and
 * four chances to forget one, with the forgotten one invisible until a Friday.
 * Three attempts, only for the two categories worth asking again about, and
 * every response says how many requests it cost.
 *
 * `fetchImpl` is injected for the adapter's own tests only. Everything else
 * reaches HTTP through the port. The clock is not a test seam: backoff is time
 * passing, and the project has one place where that happens (ADR-0018).
 */

import {
  HTTP_BACKOFF_BASE_MS,
  HTTP_MAX_ATTEMPTS,
  HTTP_RETRY_AFTER_CAP_MS,
  HTTP_TIMEOUT_MS,
  USER_AGENT,
} from '../../config.ts'
import { categoriseFailure, isRetryable } from '../domain/failure.ts'
import { NO_ANSWER } from '../domain/http-outcome.ts'
import type { ClockPort, HttpResponse, HttpPort } from '../ports.ts'

const read = async (response: Response) => ({
  status: response.status,
  headers: Object.fromEntries(response.headers),
  body: await response.text(),
})

/**
 * How long to leave a provider alone before attempt `attempt + 1`.
 *
 * Roughly a second, then two, then four — doubling because a service shedding
 * load is asking for longer than one that is merely busy — and jittered by a
 * quarter either way so that several calls failing at the same moment do not
 * all come back at the same moment.
 *
 * Pure, and exported, so the shape is asserted without a suite spending seven
 * seconds a case. The randomness is a parameter for the same reason.
 */
export const backoffMs = (attempt: number, jitter: number = Math.random()): number =>
  Math.round(HTTP_BACKOFF_BASE_MS * 2 ** (attempt - 1) * (0.75 + jitter * 0.5))

/**
 * What a provider asked us to wait, when it said — in seconds or as a date —
 * and nothing when it did not, or said something that is not a delay.
 *
 * Clamped, because the header is a number a stranger chose: `Retry-After: 3600`
 * is a provider asking for the entire run, and honouring it is how one bad
 * response becomes an hour of nothing happening. A non-positive delay is not a
 * request to wait and falls back to the backoff, which at least increases.
 */
export const retryAfterMs = (header: string | undefined, now: number): number | undefined => {
  if (header === undefined) return undefined

  const seconds = Number(header.trim())
  const ms = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(header) - now

  if (!Number.isFinite(ms) || ms <= 0) return undefined

  return Math.min(ms, HTTP_RETRY_AFTER_CAP_MS)
}

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

const once = async (request: () => Promise<Omit<HttpResponse, 'attempts'>>) => {
  try {
    return await request()
  } catch (error) {
    return { status: NO_ANSWER, headers: {}, body: because(error) }
  }
}

/**
 * Up to three attempts, and then whatever the third one said.
 *
 * Only `transient` and `rate_limited` come back here; every other category is
 * an answer, and asking a 404 three times gets the same answer three times for
 * three times the seconds. The judgement is the shared one rather than a list
 * of statuses kept here (ADR-0048), so a client added later is retried without
 * anyone remembering to ask for it.
 */
const attempted = async (
  clock: ClockPort,
  request: () => Promise<Omit<HttpResponse, 'attempts'>>,
): Promise<HttpResponse> => {
  for (let attempt = 1; ; attempt += 1) {
    const response = { ...(await once(request)), attempts: attempt }
    const category = categoriseFailure(response.status, response.body)

    if (attempt >= HTTP_MAX_ATTEMPTS || category === undefined || !isRetryable(category)) {
      return response
    }

    await clock.sleep(retryAfterMs(response.headers['retry-after'], clock.now().getTime()) ?? backoffMs(attempt))
  }
}

export const httpAdapter = (clock: ClockPort, fetchImpl: typeof fetch = globalThis.fetch): HttpPort => ({
  async get(url, headers = {}, options = {}) {
    return attempted(clock, async () => {
      // The project's own identification leads, and a caller's headers follow,
      // because a search API's key is an addition to who we are and not a
      // disguise: nothing here ever claims to be a browser (ADR-0031).
      const response = await fetchImpl(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml', ...headers },
        ...(options.followRedirects === false ? { redirect: 'manual' as const } : {}),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      })

      return read(response)
    })
  },

  async post(url, body, headers = {}) {
    return withBody(clock, fetchImpl, 'POST', url, body, headers)
  },

  async patch(url, body, headers = {}) {
    return withBody(clock, fetchImpl, 'PATCH', url, body, headers)
  },
})

/** POST and PATCH differ in one word, so they are one function. */
const withBody = async (
  clock: ClockPort,
  fetchImpl: typeof fetch,
  method: 'POST' | 'PATCH',
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<HttpResponse> =>
  attempted(clock, async () => {
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
