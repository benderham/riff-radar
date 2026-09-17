import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  HTTP_BACKOFF_BASE_MS,
  HTTP_MAX_ATTEMPTS,
  HTTP_RETRY_AFTER_CAP_MS,
  HTTP_TIMEOUT_MS,
  USER_AGENT,
} from '../../config.ts'
import { NO_ANSWER } from '../domain/http-outcome.ts'
import type { ClockPort } from '../ports.ts'
import { httpAdapter } from './http.ts'

/**
 * A clock that records what it was asked to wait for and waits none of it, so
 * the backoff sequence is asserted rather than sat through: three attempts
 * against a dead provider is seven seconds the suite never spends.
 *
 * It stands still, which is what makes an HTTP-date `Retry-After` assertable.
 */
const NOW = new Date('2026-09-17T00:00:00Z')

const recordingClock = (): ClockPort & { readonly waits: number[] } => {
  const waits: number[] = []
  return {
    waits,
    now: () => NOW,
    sleep: async (ms) => {
      waits.push(ms)
    },
  }
}

/** Each entry answers one attempt; the last one answers every attempt after it. */
const serving = (answers: readonly [string, ResponseInit][]) => {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = async (url: string | URL | Request, requestInit: RequestInit = {}) => {
    calls.push({ url: String(url), init: requestInit })
    const [body, init] = answers[Math.min(calls.length - 1, answers.length - 1)]!
    return new Response(body, init)
  }
  const clock = recordingClock()
  return { calls, clock, http: httpAdapter(clock, fetchImpl as typeof fetch) }
}

test('status, headers and body all come back', async () => {
  const { http } = serving([
    ['<html>Ulcerate</html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }],
  ])

  const response = await http.get('https://example.test/metal')
  assert.equal(response.status, 200)
  assert.equal(response.headers['content-type'], 'text/html; charset=utf-8')
  assert.equal(response.body, '<html>Ulcerate</html>')
})

test('the request identifies the project and carries a timeout', async () => {
  const { calls, http } = serving([['ok', {}]])
  await http.get('https://example.test/metal')

  const [call] = calls
  assert.equal(call?.url, 'https://example.test/metal')
  assert.equal((call?.init.headers as Record<string, string>)['user-agent'], USER_AGENT)
  assert.ok(call?.init.signal instanceof AbortSignal)
  assert.ok(HTTP_TIMEOUT_MS > 0)
})

test('a non-2xx response is returned, not thrown: the caller decides', async () => {
  const { http } = serving([['go away', { status: 403 }]])

  const response = await http.get('https://example.test/metal')
  assert.equal(response.status, 403)
  assert.equal(response.body, 'go away')
})

// The contract this file used to assert — "a transport failure rejects" — was
// deliberately reversed by ADR-0043. What replaces it is two tests below: the
// failure comes back as a response nobody has to catch, carrying its cause.

test('a caller may add headers, and still identifies the project', async () => {
  const { calls, http } = serving([['{}', {}]])
  await http.get('https://example.test/search', { 'x-subscription-token': 'secret' })

  const headers = calls[0]?.init.headers as Record<string, string>
  assert.equal(headers['x-subscription-token'], 'secret')
  assert.equal(headers['user-agent'], USER_AGENT)
})

test('a post sends the body, the method and the content type', async () => {
  const { calls, http } = serving([['{"results":[]}', {}]])
  await http.post('https://example.test/search', '{"query":"ulcerate"}', {
    authorization: 'Bearer secret',
  })

  const [call] = calls
  assert.equal(call?.init.method, 'POST')
  assert.equal(call?.init.body, '{"query":"ulcerate"}')
  const headers = call?.init.headers as Record<string, string>
  assert.equal(headers['content-type'], 'application/json')
  assert.equal(headers['authorization'], 'Bearer secret')
  assert.equal(headers['user-agent'], USER_AGENT, 'a post identifies the project too')
  assert.ok(call?.init.signal instanceof AbortSignal)
})

test('a post returns a non-2xx rather than throwing, like a get', async () => {
  const { http } = serving([['unauthorized', { status: 401 }]])

  const response = await http.post('https://example.test/search', '{}')
  assert.equal(response.status, 401)
  assert.equal(response.body, 'unauthorized')
})

test('a request that is never answered comes back as no answer, not as a throw', async () => {
  const dead = async () => {
    throw new Error('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND musicbrainz.org') })
  }
  const http = httpAdapter(recordingClock(), dead as unknown as typeof fetch)

  for (const response of [
    await http.get('https://musicbrainz.org/ws/2/release-group'),
    await http.post('https://api.tavily.com/search', '{}'),
    await http.patch('https://api.notion.com/v1/pages/page-1', '{}'),
  ]) {
    assert.equal(response.status, NO_ANSWER)
    // The cause is the whole value of the message: "fetch failed" alone sent a
    // human to the database to find out which host had gone away.
    assert.equal(response.body, 'fetch failed: getaddrinfo ENOTFOUND musicbrainz.org')
  }
})

test('a rejection that is not an Error is still reported rather than thrown', async () => {
  const odd = async () => {
    throw 'no'
  }
  const response = await httpAdapter(recordingClock(), odd as unknown as typeof fetch).get(
    'https://example.com',
  )

  assert.equal(response.status, NO_ANSWER)
  assert.equal(response.body, 'no')
})

test('an unanswered request names every address that failed, not just "fetch failed"', async () => {
  // What a dual-stack host looks like when only one of its two addresses works:
  // an AggregateError with no message of its own, one entry per address tried.
  const both = new AggregateError(
    [
      Object.assign(new Error('connect ENETUNREACH 2620:0:861:ed1a::1:443'), { code: 'ENETUNREACH' }),
      Object.assign(new Error('connect ECONNREFUSED 185.15.59.224:443'), { code: 'ECONNREFUSED' }),
    ],
    '',
  )
  const dead = async () => {
    throw new Error('fetch failed', { cause: both })
  }

  const response = await httpAdapter(recordingClock(), dead as unknown as typeof fetch).get(
    'https://musicbrainz.org',
  )

  assert.equal(response.status, NO_ANSWER)
  assert.equal(
    response.body,
    'fetch failed: AggregateError: [connect ENETUNREACH 2620:0:861:ed1a::1:443 (ENETUNREACH), ' +
      'connect ECONNREFUSED 185.15.59.224:443 (ECONNREFUSED)]',
  )
})

// ── Trying again, bounded (ADR-0049) ─────────────────────────────────────────

test('a transient failure is retried, and the answer that arrives is the answer', async () => {
  const { calls, http } = serving([
    ['down', { status: 503 }],
    ['down', { status: 503 }],
    ['<html>Ulcerate</html>', { status: 200 }],
  ])

  const response = await http.get('https://example.test/metal')
  assert.equal(calls.length, 3)
  assert.equal(response.status, 200)
  assert.equal(response.attempts, 3, 'the count is what explains where the seconds went')
})

test('a provider that stays down is returned as-is after three attempts, never thrown', async () => {
  const { calls, http } = serving([['down', { status: 503 }]])

  const response = await http.get('https://example.test/metal')
  assert.equal(calls.length, HTTP_MAX_ATTEMPTS)
  assert.equal(response.status, 503)
  assert.equal(response.attempts, HTTP_MAX_ATTEMPTS)
})

test('a request that never gets an answer is retried like any other transient failure', async () => {
  let tries = 0
  const flaky = async () => {
    tries += 1
    if (tries < 3) throw new Error('fetch failed', { cause: new Error('ECONNRESET') })
    return new Response('ok')
  }
  const clock = recordingClock()
  const response = await httpAdapter(clock, flaky as unknown as typeof fetch).get('https://example.test')

  assert.equal(response.status, 200)
  assert.equal(response.attempts, 3)
})

test('a rate limit is retried: it is the other half of what asking again fixes', async () => {
  const { calls, http } = serving([
    ['slow down', { status: 429 }],
    ['ok', { status: 200 }],
  ])

  const response = await http.get('https://example.test/metal')
  assert.equal(calls.length, 2)
  assert.equal(response.attempts, 2)
})

test('an answer is an answer: refused, not found and malformed cost one attempt and no delay', async () => {
  for (const status of [401, 403, 404]) {
    const { calls, clock, http } = serving([['no', { status }]])

    const response = await http.get('https://example.test/metal')
    assert.equal(calls.length, 1, `HTTP ${status} is an answer, not a failure worth repeating`)
    assert.equal(response.attempts, 1)
    assert.deepEqual(clock.waits, [])
  }
})

test('a success costs one attempt and reports it, so every response carries a count', async () => {
  const { http } = serving([['ok', {}]])

  const response = await http.get('https://example.test/metal')
  assert.equal(response.attempts, 1)
})

test('post and patch retry too: they share the one path that tries again', async () => {
  for (const call of [
    (http: ReturnType<typeof serving>['http']) => http.post('https://example.test', '{}'),
    (http: ReturnType<typeof serving>['http']) => http.patch('https://example.test', '{}'),
  ]) {
    const { calls, http } = serving([['down', { status: 503 }]])

    const response = await call(http)
    assert.equal(calls.length, HTTP_MAX_ATTEMPTS)
    assert.equal(response.attempts, HTTP_MAX_ATTEMPTS)
  }
})

test('backoff grows, is jittered, and stays within a stated band of each step', async () => {
  const { clock, http } = serving([['down', { status: 503 }]])
  await http.get('https://example.test/metal')

  assert.equal(clock.waits.length, HTTP_MAX_ATTEMPTS - 1, 'three attempts means two waits')

  clock.waits.forEach((waited, index) => {
    const base = HTTP_BACKOFF_BASE_MS * 2 ** index
    assert.ok(waited >= base * 0.5 && waited <= base * 1.5, `${waited}ms is not roughly ${base}ms`)
  })

  assert.ok(clock.waits[1]! > clock.waits[0]!, 'a provider still down is left alone for longer')
})

test('backoff is actually jittered: repeated runs do not all wait the same', async () => {
  const waited = new Set<number>()
  for (let run = 0; run < 25; run += 1) {
    const { clock, http } = serving([['down', { status: 503 }]])
    await http.get('https://example.test/metal')
    waited.add(clock.waits[0]!)
  }

  assert.ok(waited.size > 1, 'a fixed delay makes several failing calls come back in step')
})

test('Retry-After in seconds is honoured over the backoff we would have chosen', async () => {
  const { clock, http } = serving([['slow down', { status: 429, headers: { 'retry-after': '5' } }]])
  await http.get('https://example.test/metal')

  assert.deepEqual(clock.waits, [5_000, 5_000])
})

test('Retry-After as an HTTP date is honoured too', async () => {
  const at = new Date(NOW.getTime() + 3_000).toUTCString()
  const { clock, http } = serving([['slow down', { status: 429, headers: { 'retry-after': at } }]])
  await http.get('https://example.test/metal')

  assert.deepEqual(clock.waits, [3_000, 3_000])
})

test('a hostile Retry-After is clamped, so a provider cannot stall a whole run', async () => {
  const { clock, http } = serving([['go away', { status: 429, headers: { 'retry-after': '3600' } }]])
  await http.get('https://example.test/metal')

  assert.deepEqual(clock.waits, [HTTP_RETRY_AFTER_CAP_MS, HTTP_RETRY_AFTER_CAP_MS])
})

test('a Retry-After that is not a delay is ignored rather than trusted', async () => {
  for (const header of ['soon', '-5', 'Thu, 01 Jan 1970 00:00:00 GMT']) {
    const { clock, http } = serving([['slow down', { status: 429, headers: { 'retry-after': header } }]])
    await http.get('https://example.test/metal')

    assert.equal(clock.waits.length, 2)
    clock.waits.forEach((waited) => assert.ok(waited > 0, `"${header}" should fall back to backoff`))
  }
})

test('the busy body MusicBrainz wears as a 200 is retried, because it is a refusal', async () => {
  const busy = JSON.stringify({ error: 'The MusicBrainz web server is currently busy.' })
  const { calls, http } = serving([
    [busy, { status: 200 }],
    ['{"release-groups":[]}', { status: 200 }],
  ])

  const response = await http.get('https://musicbrainz.org/ws/2/release-group')
  assert.equal(calls.length, 2)
  assert.equal(response.attempts, 2)
})
