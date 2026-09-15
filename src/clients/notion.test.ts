import { test } from 'node:test'
import assert from 'node:assert/strict'

import { NOTION_VERSION } from '../../config.ts'
import type { HttpPort, Ports } from '../ports.ts'
import { SuppressionUnavailable, suppressedReleases } from './notion.ts'

/**
 * Notion's bodies are declared inline rather than captured, deliberately.
 * `api.notion.com` is denied to this sandbox, and the only database available
 * to capture from is Ben's own — which holds his listening queue, and is the
 * sort of thing AGENTS.md says not to commit. `npm run smoke:notion` is what
 * checks these shapes against the real service.
 */
const page = (over: Record<string, unknown>) => ({
  properties: {
    Title: { title: [{ plain_text: 'Cutting the Throat of God' }] },
    Artist: { rich_text: [{ plain_text: 'Ulcerate' }] },
    'MusicBrainz ID': { rich_text: [{ plain_text: 'rg-1' }] },
    ...over,
  },
})

const serving = (...bodies: readonly (string | { body: string; status: number })[]) => {
  const posts: { url: string; body: string; headers?: Record<string, string> }[] = []
  let call = 0

  const http: HttpPort = {
    get: async (url) => {
      throw new Error(`unexpected get to ${url}`)
    },
    post: async (url, body, headers) => {
      posts.push({ url, body, ...(headers === undefined ? {} : { headers }) })
      const next = bodies[Math.min(call++, bodies.length - 1)]!
      const answer = typeof next === 'string' ? { body: next, status: 200 } : next
      return { ...answer, headers: { 'content-type': 'application/json' } }
    },
  }

  return { posts, ports: { http, clock: { now: () => new Date() } } as Ports }
}

const query = (results: unknown[], over: Record<string, unknown> = {}) =>
  JSON.stringify({ results, has_more: false, next_cursor: null, ...over })

test('a release already in Notion comes back under both of its identities', async () => {
  const { ports } = serving(query([page({})]))
  const suppressed = await suppressedReleases(ports, 'secret', 'db-1')

  // The release-group id for a candidate that has been looked up, and artist
  // and title for one that has not yet been.
  assert.deepEqual([...suppressed].sort(), ['rg-1', 'ulcerate|cutting the throat of god'])
})

test('a record with no MusicBrainz id is still suppressed on artist and title', async () => {
  const { ports } = serving(query([page({ 'MusicBrainz ID': { rich_text: [] } })]))
  const suppressed = await suppressedReleases(ports, 'secret', 'db-1')

  assert.deepEqual([...suppressed], ['ulcerate|cutting the throat of god'])
})

test('a record naming nothing suppresses nothing, rather than suppressing everything', async () => {
  const { ports } = serving(query([{ properties: {} }]))
  assert.equal((await suppressedReleases(ports, 'secret', 'db-1')).size, 0)
})

test('Status is not consulted: a rejected release is still suppressed (ADR-0009)', async () => {
  const rejected = page({ Status: { select: { name: 'Rejected' } } })
  const { ports } = serving(query([rejected]))

  assert.ok((await suppressedReleases(ports, 'secret', 'db-1')).has('rg-1'))
})

test('every page of the database is read, not only the first', async () => {
  const { ports, posts } = serving(
    query([page({})], { has_more: true, next_cursor: 'cursor-2' }),
    query([page({ 'MusicBrainz ID': { rich_text: [{ plain_text: 'rg-2' }] } })]),
  )
  const suppressed = await suppressedReleases(ports, 'secret', 'db-1')

  assert.ok(suppressed.has('rg-1') && suppressed.has('rg-2'))
  assert.equal(posts.length, 2)
  assert.equal(JSON.parse(posts[0]?.body ?? '{}').start_cursor, undefined)
  assert.equal(JSON.parse(posts[1]?.body ?? '{}').start_cursor, 'cursor-2')
})

test('the request authenticates and pins the API version', async () => {
  const { ports, posts } = serving(query([]))
  await suppressedReleases(ports, 'secret', 'db-1')

  const [call] = posts
  assert.match(call?.url ?? '', /\/databases\/db-1\/query$/)
  assert.equal(call?.headers?.['authorization'], 'Bearer secret')
  assert.equal(call?.headers?.['notion-version'], NOTION_VERSION)
})

test('a refusal stops the run rather than leaving it unsuppressed', async () => {
  const { ports } = serving({ body: '{"message": "unauthorized"}', status: 401 })

  await assert.rejects(
    () => suppressedReleases(ports, 'secret', 'db-1'),
    (error: Error) => error instanceof SuppressionUnavailable && /HTTP 401/.test(error.message),
  )
})

test('the failure never repeats the request, which carries the token', async () => {
  const { ports } = serving({ body: '{"message": "unauthorized"}', status: 401 })
  const thrown = await suppressedReleases(ports, 'secret', 'db-1').then(
    () => assert.fail('the refusal should have thrown'),
    (error: Error) => error,
  )

  assert.doesNotMatch(thrown.message, /secret/)
})

test('an answer of the wrong shape stops the run too', async () => {
  const { ports } = serving('{"results": "not a list"}')

  await assert.rejects(
    () => suppressedReleases(ports, 'secret', 'db-1'),
    (error: Error) => error instanceof SuppressionUnavailable,
  )
})
