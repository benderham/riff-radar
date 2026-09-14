import { test } from 'node:test'
import assert from 'node:assert/strict'

import { SEARCH_ENDPOINT } from '../../config.ts'
import type { HttpPort, Ports } from '../ports.ts'
import { searchWeb } from './search.ts'

/**
 * A Brave response, invented here rather than kept in `fixtures/`, which holds
 * captures only. It is the documented shape of the API rather than a capture of
 * it, because capturing one needs a key this repository does not have; the
 * `npm run smoke:search` script is what checks the shape against reality, and a
 * capture replaces this the first time it disagrees.
 */
const BODY = JSON.stringify({
  query: { original: 'ulcerate cutting the throat of god' },
  web: {
    results: [
      {
        title: 'Ulcerate — Cutting the Throat of God',
        url: 'https://www.metal-archives.com/albums/Ulcerate/1',
        description: 'The seventh full-length from the New Zealand death metal trio.',
        extra: 'ignored',
      },
      {
        title: 'Ulcerate (band) - Wikipedia',
        url: 'https://en.wikipedia.org/wiki/Ulcerate',
        description: 'Ulcerate are a New Zealand technical death metal band.',
      },
    ],
  },
})

const respondWith = (body: string, status = 200) => {
  const calls: { url: string; headers?: Record<string, string> }[] = []
  const http: HttpPort = {
    get: async (url, headers) => {
      calls.push({ url, ...(headers === undefined ? {} : { headers }) })
      return { status, headers: { 'content-type': 'application/json' }, body }
    },
  }
  return { calls, ports: { http } as Ports }
}

test('a search returns the results the provider listed', async () => {
  const { calls, ports } = respondWith(BODY)
  const search = await searchWeb(ports, 'ulcerate cutting the throat of god', 'test-key')

  assert.equal(search.warning, undefined)
  assert.deepEqual(search.results, [
    {
      title: 'Ulcerate — Cutting the Throat of God',
      url: 'https://www.metal-archives.com/albums/Ulcerate/1',
      description: 'The seventh full-length from the New Zealand death metal trio.',
    },
    {
      title: 'Ulcerate (band) - Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Ulcerate',
      description: 'Ulcerate are a New Zealand technical death metal band.',
    },
  ])

  const [call] = calls
  assert.ok(call?.url.startsWith(SEARCH_ENDPOINT))
  assert.match(call?.url ?? '', /q=ulcerate%20cutting/)
  assert.equal(call?.headers?.['x-subscription-token'], 'test-key')
  assert.equal(call?.headers?.['accept'], 'application/json')
})

test('a provider that refuses is a warning, not a failure', async () => {
  const { ports } = respondWith('rate limited', 429)
  const search = await searchWeb(ports, 'ulcerate', 'test-key')

  assert.deepEqual(search.results, [])
  assert.match(String(search.warning), /429/)
})

test('a search that finds nothing is a warning, not a failure', async () => {
  const { ports } = respondWith(JSON.stringify({ web: { results: [] } }))
  const search = await searchWeb(ports, 'a band nobody has written about', 'test-key')

  assert.deepEqual(search.results, [])
  assert.match(String(search.warning), /no results/)
})

test('a body that is not the documented shape is a warning, not a crash', async () => {
  const { ports } = respondWith('<html>bot check</html>')
  const search = await searchWeb(ports, 'ulcerate', 'test-key')

  assert.deepEqual(search.results, [])
  assert.match(String(search.warning), /not valid JSON/)
})

test('a body of the wrong shape is a warning too', async () => {
  const { ports } = respondWith(JSON.stringify({ web: { results: [{ url: 42 }] } }))
  const search = await searchWeb(ports, 'ulcerate', 'test-key')

  assert.deepEqual(search.results, [])
  assert.match(String(search.warning), /wrong shape/)
})
