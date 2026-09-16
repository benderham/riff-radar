import { test } from 'node:test'
import assert from 'node:assert/strict'

import { HTTP_TIMEOUT_MS, USER_AGENT } from '../../config.ts'
import { NO_ANSWER } from '../domain/http-outcome.ts'
import { httpAdapter } from './http.ts'

const respondWith = (body: string, init: ResponseInit = {}) => {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = async (url: string | URL | Request, requestInit: RequestInit = {}) => {
    calls.push({ url: String(url), init: requestInit })
    return new Response(body, init)
  }
  return { calls, http: httpAdapter(fetchImpl as typeof fetch) }
}

test('status, headers and body all come back', async () => {
  const { http } = respondWith('<html>Ulcerate</html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })

  const response = await http.get('https://example.test/metal')
  assert.equal(response.status, 200)
  assert.equal(response.headers['content-type'], 'text/html; charset=utf-8')
  assert.equal(response.body, '<html>Ulcerate</html>')
})

test('the request identifies the project and carries a timeout', async () => {
  const { calls, http } = respondWith('ok')
  await http.get('https://example.test/metal')

  const [call] = calls
  assert.equal(call?.url, 'https://example.test/metal')
  assert.equal((call?.init.headers as Record<string, string>)['user-agent'], USER_AGENT)
  assert.ok(call?.init.signal instanceof AbortSignal)
  assert.ok(HTTP_TIMEOUT_MS > 0)
})

test('a non-2xx response is returned, not thrown: the caller decides', async () => {
  const { http } = respondWith('go away', { status: 403 })

  const response = await http.get('https://example.test/metal')
  assert.equal(response.status, 403)
  assert.equal(response.body, 'go away')
})

// The contract this file used to assert — "a transport failure rejects" — was
// deliberately reversed by ADR-0043. What replaces it is two tests below: the
// failure comes back as a response nobody has to catch, carrying its cause.

test('a caller may add headers, and still identifies the project', async () => {
  const { calls, http } = respondWith('{}')
  await http.get('https://example.test/search', { 'x-subscription-token': 'secret' })

  const headers = calls[0]?.init.headers as Record<string, string>
  assert.equal(headers['x-subscription-token'], 'secret')
  assert.equal(headers['user-agent'], USER_AGENT)
})

test('a post sends the body, the method and the content type', async () => {
  const { calls, http } = respondWith('{"results":[]}')
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
  const { http } = respondWith('unauthorized', { status: 401 })

  const response = await http.post('https://example.test/search', '{}')
  assert.equal(response.status, 401)
  assert.equal(response.body, 'unauthorized')
})

test('a request that is never answered comes back as no answer, not as a throw', async () => {
  const dead = async () => {
    throw new Error('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND musicbrainz.org') })
  }
  const http = httpAdapter(dead as unknown as typeof fetch)

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
  const response = await httpAdapter(odd as unknown as typeof fetch).get('https://example.com')

  assert.equal(response.status, NO_ANSWER)
  assert.equal(response.body, 'no')
})
