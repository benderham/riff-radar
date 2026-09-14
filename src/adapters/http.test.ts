import { test } from 'node:test'
import assert from 'node:assert/strict'

import { HTTP_TIMEOUT_MS, USER_AGENT } from '../../config.ts'
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

test('a transport failure rejects', async () => {
  const http = httpAdapter((() => Promise.reject(new Error('getaddrinfo ENOTFOUND'))) as typeof fetch)

  await assert.rejects(() => http.get('https://example.test/metal'), /ENOTFOUND/)
})
