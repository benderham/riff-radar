import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { SEARCH_ENDPOINT } from '../../config.ts'
import type { HttpPort, Ports } from '../ports.ts'
import { searchWeb } from './search.ts'

/**
 * A real Tavily response, captured on 15 September 2026 and kept whole in
 * `fixtures/`. It replaced an invented body of Brave's documented shape the
 * moment a key existed to capture one with (ADR-0033), so this client is now
 * exercised against something a provider actually served. `npm run smoke:search`
 * is what checks it against reality; when the two disagree, the real body wins.
 */
const BODY = readFileSync('fixtures/tavily-search.json', 'utf8')

const respondWith = (body: string, status = 200) => {
  const calls: { url: string; body: string; headers?: Record<string, string> }[] = []
  const http: HttpPort = {
    patch: async () => { throw new Error('unexpected patch') },
    get: async () => {
      throw new Error('a search is a POST; nothing here should GET')
    },
    post: async (url, requestBody, headers) => {
      calls.push({ url, body: requestBody, ...(headers === undefined ? {} : { headers }) })
      return { status, attempts: 1, headers: { 'content-type': 'application/json' }, body }
    },
  }
  return { calls, ports: { http } as Ports }
}

test('a search returns the results the provider listed', async () => {
  const { ports } = respondWith(BODY)
  const search = await searchWeb(ports, 'ulcerate cutting the throat of god', 'test-key')

  assert.equal(search.warning, undefined)
  assert.equal(search.results.length, 5)
  assert.deepEqual(search.results[0], {
    title: 'Cutting the Throat of God',
    url: 'https://en.wikipedia.org/wiki/Cutting_the_Throat_of_God',
    description:
      'Cutting the Throat of God is the seventh studio album by New Zealand technical death metal band Ulcerate. It was released on 14 June 2024 through Debemur',
  })
})

test('the query travels in the body and the key in a header', async () => {
  const { calls, ports } = respondWith(BODY)
  await searchWeb(ports, 'ulcerate cutting the throat of god', 'test-key')

  const [call] = calls
  assert.equal(call?.url, SEARCH_ENDPOINT)
  assert.deepEqual(JSON.parse(call?.body ?? '{}'), {
    query: 'ulcerate cutting the throat of god',
    max_results: 5,
  })
  assert.equal(call?.headers?.['authorization'], 'Bearer test-key')
})

test('a provider that refuses is a warning, not a failure', async () => {
  const { ports } = respondWith('rate limited', 429)
  const search = await searchWeb(ports, 'ulcerate', 'test-key')

  assert.deepEqual(search.results, [])
  assert.match(String(search.warning), /429/)
})

test('a search that finds nothing is a warning, not a failure', async () => {
  const { ports } = respondWith(JSON.stringify({ query: 'x', results: [] }))
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
  const { ports } = respondWith(JSON.stringify({ results: [{ url: 42 }] }))
  const search = await searchWeb(ports, 'ulcerate', 'test-key')

  assert.deepEqual(search.results, [])
  assert.match(String(search.warning), /wrong shape/)
})

test('a search that was refused, and one whose body was unreadable, are told apart', async () => {
  const refused = await searchWeb(respondWith('no', 401).ports, 'ulcerate', 'test-key')
  assert.equal(refused.failureCategory, 'refused')

  const limited = await searchWeb(respondWith('slow down', 429).ports, 'ulcerate', 'test-key')
  assert.equal(limited.failureCategory, 'rate_limited')

  const unreadable = await searchWeb(respondWith('<html>').ports, 'ulcerate', 'test-key')
  assert.equal(unreadable.failureCategory, 'malformed')
})

test('a search that found nothing has a warning and no category', async () => {
  const empty = await searchWeb(respondWith(JSON.stringify({ results: [] })).ports, 'ulcerate', 'test-key')

  assert.match(String(empty.warning), /no results/)
  assert.equal(empty.failureCategory, undefined)
})
