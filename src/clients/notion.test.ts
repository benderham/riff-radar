import { test } from 'node:test'
import assert from 'node:assert/strict'

import { NOTION_VERSION } from '../../config.ts'
import type { ClockPort, HttpPort, Ports } from '../ports.ts'
import type { ShortlistItem } from '../domain/shortlist.ts'
import {
  NotionWriteFailed,
  SchemaMismatch,
  SuppressionUnavailable,
  preflightSchema,
  proposeShortlist,
  suppressedReleases,
} from './notion.ts'

/** Notion's client never waits; the adapter's backoff is the adapter's test. */
const clock: ClockPort = { now: () => new Date(), sleep: async () => {} }

/**
 * Notion's bodies are declared inline rather than captured, deliberately.
 * `api.notion.com` is denied to this sandbox, and the only database available
 * to capture from is Ben's own — which holds his listening queue, and is the
 * sort of thing AGENTS.md says not to commit. `npm run smoke:notion` is what
 * checks these shapes against the real service.
 */
const page = (over: Record<string, unknown>) => ({
  properties: {
    Album: { title: [{ plain_text: 'Cutting the Throat of God' }] },
    Artist: { rich_text: [{ plain_text: 'Ulcerate' }] },
    'MusicBrainz ID': { rich_text: [{ plain_text: 'rg-1' }] },
    ...over,
  },
})

const serving = (...bodies: readonly (string | { body: string; status: number })[]) => {
  const posts: { url: string; body: string; headers?: Record<string, string> }[] = []
  let call = 0

  const http: HttpPort = {
    patch: async () => { throw new Error('unexpected patch') },
    get: async (url) => {
      throw new Error(`unexpected get to ${url}`)
    },
    post: async (url, body, headers) => {
      posts.push({ url, body, ...(headers === undefined ? {} : { headers }) })
      const next = bodies[Math.min(call++, bodies.length - 1)]!
      const answer = typeof next === 'string' ? { body: next, status: 200 } : next
      return { ...answer, attempts: 1, headers: { 'content-type': 'application/json' } }
    },
  }

  return { posts, ports: { http, clock } as Ports }
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

// ── The preflight and the write ──────────────────────────────────────────────

const SCHEMA = JSON.stringify({
  properties: {
    Album: { type: 'title' },
    Artist: { type: 'rich_text' },
    'Release Date': { type: 'date' },
    'Apple Music': { type: 'url' },
    Status: { type: 'select' },
    'MusicBrainz ID': { type: 'rich_text' },
    'Source URL': { type: 'url' },
    Rationale: { type: 'rich_text' },
    'Run ID': { type: 'rich_text' },
    // Ben's, and never written. Its presence is not the agent's business.
    Rating: { type: 'select' },
  },
})

/**
 * A Notion that answers the schema request with `schema`, every page creation
 * with an id, and every cover-art request with nothing — except where a test
 * says otherwise.
 */
const writing = (
  over: {
    schema?: string
    schemaStatus?: number
    createStatus?: readonly number[]
    archiveStatus?: number
    hasCover?: boolean
  } = {},
) => {
  const calls: { method: string; url: string; body?: string }[] = []
  let created = 0

  const http: HttpPort = {
    get: async (url) => {
      calls.push({ method: 'get', url })
      // The archive answers "there is art" with a redirect and "there is none"
      // with a 404; neither carries an image.
      if (url.includes('coverartarchive')) {
        return { status: over.hasCover === true ? 307 : 404, attempts: 1, headers: {}, body: '' }
      }
      return { status: over.schemaStatus ?? 200, attempts: 1, headers: {}, body: over.schema ?? SCHEMA }
    },
    post: async (url, body) => {
      calls.push({ method: 'post', url, body })
      const status = over.createStatus?.[created] ?? 200
      created += 1
      return { status, attempts: 1, headers: {}, body: JSON.stringify({ id: `page-${created}` }) }
    },
    patch: async (url, body) => {
      calls.push({ method: 'patch', url, body })
      return { status: over.archiveStatus ?? 200, attempts: 1, headers: {}, body: '{}' }
    },
  }

  return { calls, ports: { http, clock } as Ports }
}

const item = (over: Partial<ShortlistItem> = {}): ShortlistItem => ({
  artist: 'Ulcerate',
  title: 'Cutting the Throat of God',
  releaseDate: '2026-09-11',
  sourceUrls: ['https://loudwire.com/calendar'],
  rank: 1,
  rationale: 'Dissonant death metal.',
  musicbrainzId: 'rg-1',
  ...over,
})

test('a database carrying every property this writes passes the preflight', async () => {
  const { ports } = writing()
  await preflightSchema(ports, 'secret', 'db-1')
})

test('a missing property names itself and blocks the write', async () => {
  const { properties, ...rest } = JSON.parse(SCHEMA)
  delete properties['Run ID']
  const { ports } = writing({ schema: JSON.stringify({ ...rest, properties }) })

  await assert.rejects(preflightSchema(ports, 'secret', 'db-1'), (error: Error) => {
    assert.ok(error instanceof SchemaMismatch)
    assert.match(error.message, /Run ID \(rich_text\) is missing/)
    return true
  })
})

test('a property of the wrong type blocks the write, and says which type it found', async () => {
  const properties = { ...JSON.parse(SCHEMA).properties, 'Source URL': { type: 'rich_text' } }
  const { ports } = writing({ schema: JSON.stringify({ properties }) })

  await assert.rejects(
    preflightSchema(ports, 'secret', 'db-1'),
    /Source URL is rich_text, expected url/,
  )
})

test('a database that cannot be described at all is a mismatch, not a crash', async () => {
  for (const over of [{ schemaStatus: 404 }, { schema: 'not json' }]) {
    const { ports } = writing(over)
    await assert.rejects(preflightSchema(ports, 'secret', 'db-1'), SchemaMismatch)
  }
})

test('the shortlist is written one page per item, each carrying the run', async () => {
  const { ports, calls } = writing()
  const written = await proposeShortlist(ports, {
    token: 'secret',
    databaseId: 'db-1',
    runId: 'run-1',
    shortlist: [item(), item({ artist: 'Blood Incantation', musicbrainzId: 'rg-2' })],
  })

  assert.equal(written, 2)
  const pages = calls.filter((call) => call.url.endsWith('/pages'))
  assert.equal(pages.length, 2)
  assert.match(pages[0]!.body!, /"Proposed"/)
  assert.match(pages[0]!.body!, /run-1/)
})

test('cover art is fetched per release and becomes the page cover; its absence is silent', async () => {
  const { ports, calls } = writing({ hasCover: true })
  await proposeShortlist(ports, {
    token: 'secret',
    databaseId: 'db-1',
    runId: 'run-1',
    shortlist: [item()],
  })

  assert.ok(calls.some((call) => call.url === 'https://coverartarchive.org/release-group/rg-1/front'))
  assert.match(
    calls.find((call) => call.url.endsWith('/pages'))!.body!,
    /coverartarchive\.org\/release-group\/rg-1\/front/,
  )
})

test('an unverified release is not asked about at the cover art archive', async () => {
  const { ports, calls } = writing()
  await proposeShortlist(ports, {
    token: 'secret',
    databaseId: 'db-1',
    runId: 'run-1',
    shortlist: [item({ musicbrainzId: undefined, unverified: true })],
  })

  assert.ok(!calls.some((call) => call.url.includes('coverartarchive')))
})

test('a write that fails part way through leaves no rows behind', async () => {
  const { ports, calls } = writing({ createStatus: [200, 200, 400] })

  await assert.rejects(
    proposeShortlist(ports, {
      token: 'secret',
      databaseId: 'db-1',
      runId: 'run-1',
      shortlist: [item(), item({ musicbrainzId: 'rg-2' }), item({ musicbrainzId: 'rg-3' })],
    }),
    (error: Error) => {
      assert.ok(error instanceof NotionWriteFailed)
      assert.match(error.message, /2 page\(s\) written and rolled back/)
      return true
    },
  )

  const archived = calls.filter((call) => call.method === 'patch')
  assert.deepEqual(
    archived.map((call) => call.url),
    ['https://api.notion.com/v1/pages/page-1', 'https://api.notion.com/v1/pages/page-2'],
  )
  assert.ok(archived.every((call) => call.body === JSON.stringify({ archived: true })))
})

test('a rollback that itself fails says so rather than reporting a clean failure', async () => {
  const { ports } = writing({ createStatus: [200, 400], archiveStatus: 500 })

  await assert.rejects(
    proposeShortlist(ports, {
      token: 'secret',
      databaseId: 'db-1',
      runId: 'run-1',
      shortlist: [item(), item({ musicbrainzId: 'rg-2' })],
    }),
    /except: HTTP 500 archiving page-1/,
  )
})
