import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { z } from 'zod'

import { SEARCH_ENDPOINT, SOURCES } from '../config.ts'
import type { Candidate } from './domain/candidates.ts'
import type { HttpPort, ModelPort, Ports } from './ports.ts'
import { openStore } from './store/store.ts'
import type { ToolContext } from './tools.ts'
import { dispatch, toolDefinitions, tools, validateAction } from './tools.ts'

const call = (name: string, argumentsJson: string) => ({ id: 'call-1', name, argumentsJson })

/** Sources are read with GET and searches sent with POST; each fake refuses the other. */
const notSearched = async (): Promise<never> => {
  throw new Error('this test fetches a source; nothing should search')
}
const notFetched = async (): Promise<never> => {
  throw new Error('this test searches; nothing should fetch a source')
}

/**
 * A page, invented here rather than kept in `fixtures/`, which holds captures
 * only. The extraction call is faked in every test below, so what this body
 * says matters less than what it is: markup, an inline script, and text the
 * assertions can recognise on the other side of the stripper.
 */
const PAGE = `<!doctype html>
<html><head><title>Recent metal</title><style>.row { color: #000 }</style></head>
<body>
<script>window.__TRACKING__ = { ads: true };</script>
<ul>
  <li class="row">2026-09-12 — Ulcerate — Cutting the Throat of God (Debemur Morti Productions)</li>
  <li class="row">2026-09-11 — Chat Pile — Cool World (The Flenser)</li>
</ul>
</body></html>`

/**
 * A context with a real store behind it, because what `fetch_source` records is
 * half of what it does: a fake store would leave the evidence untested.
 */
const context = (over: { http?: HttpPort; model?: ModelPort } = {}) => {
  const store = openStore(':memory:')
  store.startRun({
    runId: 'run-1',
    startedAt: '2026-09-14T09:00:00.000Z',
    cliArgs: 'run',
    resolvedFrom: '2026-09-08',
    resolvedTo: '2026-09-14',
    promptVersion: 1,
    profileVersion: 1,
    actionSchemaVersion: 1,
    modelId: 'test-model',
  })

  const ports = {
    clock: { now: () => new Date(2026, 8, 14, 9, 0, 1) },
    http: over.http ?? { get: async () => ({ status: 200, headers: {}, body: PAGE }) },
    model: over.model ?? {
      complete: async () => ({
        content: JSON.stringify({
          candidates: [
            { artist: 'Ulcerate', title: 'Cutting the Throat of God', releaseDate: '2026-09-12' },
            { artist: 'Chat Pile', title: 'Cool World', releaseDate: '2026-09-11' },
          ],
        }),
        toolCalls: [],
        usage: { uncachedInputTokens: 800, cachedInputTokens: 0, outputTokens: 90 },
        cacheReported: true,
        raw: {},
      }),
    },
  } as Ports

  const toolContext: ToolContext = {
    ports,
    store,
    runId: 'run-1',
    window: { from: '2026-09-08', to: '2026-09-14' },
    searchApiKey: 'test-key',
    suppressed: new Set<string>(),
    candidates: [],
  }
  return { toolContext, store }
}

test('every declared action is offered to the model, schema and all', () => {
  assert.deepEqual(
    toolDefinitions.map((definition) => definition.name).sort(),
    ['fetch_source', 'finish', 'lookup_release', 'web_search'],
  )

  for (const definition of toolDefinitions) {
    assert.ok(definition.description.length > 0, `${definition.name} has no description`)
    // Derived from the declaration, not maintained separately.
    assert.deepEqual(
      definition.parameters,
      z.toJSONSchema(tools[definition.name as keyof typeof tools].schema),
      `${definition.name}'s JSON schema is not its declared schema`,
    )
  }
})


test('an unknown action is rejected', () => {
  const result = validateAction(call('write_to_notion', '{}'))
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.error, /unknown action/)
})

test('malformed JSON arguments are an ordinary failure', () => {
  const result = validateAction(call('web_search', '{"query": '))
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.error, /not valid JSON/)
})

test('well-formed JSON of the wrong shape is an ordinary failure', () => {
  const result = validateAction(call('web_search', '{"q": "ulcerate"}'))
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.error, /query/)
})

test('a query longer than the provider accepts is rejected before it is sent', () => {
  // Tavily documents a 400-character ceiling. A model that writes a paragraph
  // into the query is caught here rather than spending the step to find out.
  const long = 'a'.repeat(401)
  const result = validateAction(call('web_search', JSON.stringify({ query: long })))
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.error, /query/)

  assert.equal(validateAction(call('web_search', JSON.stringify({ query: 'a'.repeat(400) }))).ok, true)
})

test('an unconfigured source is rejected before anything is fetched', () => {
  // Album of the Year, dropped in ADR-0031, and Metal Archives, never a source.
  assert.equal(validateAction(call('fetch_source', '{"source_id": "metal-archives"}')).ok, false)
  const result = validateAction(call('fetch_source', '{"source_id": "aoty"}'))
  assert.equal(result.ok, false)
})

test('fetching a source returns its candidates and prices its own model call', async () => {
  const result = validateAction(call('fetch_source', '{"source_id": "loudwire"}'))
  assert.ok(result.ok)

  const { toolContext } = context()
  const dispatched = await dispatch(result.name, result.input, toolContext)

  assert.equal(dispatched.done, false)
  assert.ok(!dispatched.done && dispatched.result.includes('Cutting the Throat of God'))
  assert.deepEqual(!dispatched.done && dispatched.usage, {
    uncachedInputTokens: 800,
    cachedInputTokens: 0,
    outputTokens: 90,
  })
  assert.deepEqual(
    toolContext.candidates.map((candidate) => candidate.artist),
    ['Ulcerate', 'Chat Pile'],
  )
})

test('fetching a source records the page it read against the run', async () => {
  const result = validateAction(call('fetch_source', '{"source_id": "loudwire"}'))
  assert.ok(result.ok)

  const { toolContext, store } = context()
  await dispatch(result.name, result.input, toolContext)

  const row = store.database.prepare('SELECT * FROM source_texts WHERE run_id = ?').get('run-1')
  assert.equal(row?.['source_id'], 'loudwire')
  assert.equal(row?.['url'], SOURCES.loudwire)
  assert.equal(row?.['status'], 200)
  assert.equal(row?.['candidate_count'], 2)
  assert.equal(row?.['raw_body'], PAGE, 'the body is stored exactly as served')
})

test('a source that yields nothing is recorded, warned about, and does not throw', async () => {
  const result = validateAction(call('fetch_source', '{"source_id": "loudwire"}'))
  assert.ok(result.ok)

  const { toolContext, store } = context({
    http: { get: async () => ({ status: 500, headers: {}, body: 'server error' }), post: notSearched },
  })
  const dispatched = await dispatch(result.name, result.input, toolContext)

  assert.ok(!dispatched.done && dispatched.warning?.includes('500'))
  assert.deepEqual(toolContext.candidates, [])
  const row = store.database.prepare('SELECT * FROM source_texts WHERE source_id = ?').get('loudwire')
  assert.equal(row?.['status'], 500)
  assert.ok(String(row?.['warning']).includes('500'))
})

test('the same release from two sources stays one candidate with both URLs', async () => {
  const result = validateAction(call('fetch_source', '{"source_id": "loudwire"}'))
  assert.ok(result.ok)
  const second = validateAction(call('fetch_source', '{"source_id": "wikipedia"}'))
  assert.ok(second.ok)

  const { toolContext } = context()
  await dispatch(result.name, result.input, toolContext)
  await dispatch(second.name, second.input, toolContext)

  assert.equal(toolContext.candidates.length, 2)
  assert.deepEqual(toolContext.candidates[0]?.sourceUrls, [SOURCES.loudwire, SOURCES.wikipedia])
})

test('finish hands its items back to the loop rather than judging them', async () => {
  const result = validateAction(call('finish', '{"shortlist": [{"artist": "Ulcerate"}]}'))
  assert.ok(result.ok)

  const { toolContext } = context()
  const dispatched = await dispatch(result.name, result.input, toolContext)
  assert.ok(dispatched.done)
  assert.deepEqual(dispatched.shortlist, [{ artist: 'Ulcerate' }])
})

// ── MusicBrainz (ticket 04) ──────────────────────────────────────────────────

const mbFixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
const MB_GROUP = mbFixture('musicbrainz-release-group.json')
const MB_NOT_FOUND = mbFixture('musicbrainz-not-found.json')

const discovered = (over: Partial<Candidate> = {}): Candidate => ({
  artist: 'Ulcerate',
  title: 'Cutting the Throat of God',
  releaseDates: ['2026-09-12'],
  sourceUrls: [SOURCES.loudwire],
  ...over,
})

const lookingUp = (body: string, status = 200): HttpPort => ({
  get: async () => ({ status, headers: {}, body }),
  post: notSearched,
})

test('a lookup records what MusicBrainz knew on the candidate itself', async () => {
  const result = validateAction(call('lookup_release', '{"artist": "Ulcerate", "title": "Cutting the Throat of God"}'))
  assert.ok(result.ok)

  const { toolContext } = context({ http: lookingUp(MB_GROUP) })
  toolContext.candidates = [discovered()]
  const dispatched = await dispatch(result.name, result.input, toolContext)

  assert.equal(dispatched.done, false)
  const enriched = toolContext.candidates[0]!
  assert.equal(enriched.lookup?.found, true)
  assert.ok(enriched.lookup?.found === true && enriched.lookup.releaseGroupId === 'c302ec77-589f-462f-b6b3-d63508886978')
  assert.ok(!dispatched.done && dispatched.result.includes('c302ec77'))
})

test('a lookup adds no candidate, whatever it finds', async () => {
  const result = validateAction(call('lookup_release', '{"artist": "Ulcerate", "title": "Cutting the Throat of God"}'))
  assert.ok(result.ok)

  const { toolContext } = context({ http: lookingUp(MB_GROUP) })
  toolContext.candidates = [discovered()]
  await dispatch(result.name, result.input, toolContext)

  assert.equal(toolContext.candidates.length, 1, 'identity is not discovery')
})

test('a release MusicBrainz does not know is marked unverified and kept', async () => {
  const result = validateAction(call('lookup_release', '{"artist": "Ulcerate", "title": "Cutting the Throat of God"}'))
  assert.ok(result.ok)

  const { toolContext } = context({ http: lookingUp(MB_NOT_FOUND) })
  toolContext.candidates = [discovered()]
  const dispatched = await dispatch(result.name, result.input, toolContext)

  assert.deepEqual(toolContext.candidates[0]?.lookup, { found: false })
  assert.ok(!dispatched.done && dispatched.warning === undefined, 'absence is not a disappointment')
})

test('a lookup that failed is not a lookup: the candidate stays un-looked-up', async () => {
  // A service that was briefly down has not told us this release is unknown to
  // it. Recording `found: false` here would let a live album through on the
  // source's word, because an Unverified release falls back to that word.
  const result = validateAction(call('lookup_release', '{"artist": "Ulcerate", "title": "Cutting the Throat of God"}'))
  assert.ok(result.ok)

  const { toolContext } = context({ http: lookingUp('service unavailable', 503) })
  toolContext.candidates = [discovered()]
  const dispatched = await dispatch(result.name, result.input, toolContext)

  assert.equal(toolContext.candidates[0]?.lookup, undefined)
  assert.ok(!dispatched.done && /503/.test(String(dispatched.warning)))
})

test('a lookup for a release no source listed enriches nothing', async () => {
  const result = validateAction(call('lookup_release', '{"artist": "Vaultwraith", "title": "Crimson Nadir"}'))
  assert.ok(result.ok)

  const { toolContext } = context({ http: lookingUp(MB_GROUP) })
  toolContext.candidates = [discovered()]
  await dispatch(result.name, result.input, toolContext)

  assert.equal(toolContext.candidates[0]?.lookup, undefined, 'a lookup cannot invent a candidate to enrich')
})

test('a lookup collapses two spellings of one release into one candidate', async () => {
  const result = validateAction(call('lookup_release', '{"artist": "Ulcerate", "title": "Cutting the Throat of God"}'))
  assert.ok(result.ok)

  // The same record from two sources, punctuated differently, so nothing merged
  // them at discovery. Both resolve to the one release group.
  const { toolContext } = context({ http: lookingUp(MB_GROUP) })
  toolContext.candidates = [
    discovered(),
    discovered({ title: 'Cutting The Throat Of God', sourceUrls: [SOURCES.wikipedia] }),
  ]

  const second = validateAction(call('lookup_release', '{"artist": "Ulcerate", "title": "Cutting The Throat Of God"}'))
  assert.ok(second.ok)
  await dispatch(result.name, result.input, toolContext)
  await dispatch(second.name, second.input, toolContext)

  assert.equal(toolContext.candidates.length, 1)
  assert.deepEqual(toolContext.candidates[0]?.sourceUrls, [SOURCES.loudwire, SOURCES.wikipedia])
})

// ── Web search (ticket 03) ───────────────────────────────────────────────────

const SEARCH_BODY = JSON.stringify({
  query: 'ulcerate new zealand',
  results: [
    {
      title: 'Ulcerate (band) - Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Ulcerate',
      content: 'A New Zealand technical death metal band formed in 2000.',
      score: 0.91,
    },
  ],
})

test('a search returns what it found, and adds nothing to the run', async () => {
  const result = validateAction(call('web_search', '{"query": "ulcerate new zealand"}'))
  assert.ok(result.ok)

  const { toolContext } = context({
    http: { get: notFetched, post: async () => ({ status: 200, headers: {}, body: SEARCH_BODY }) },
  })
  // A run mid-flight: the search must leave these exactly as it found them.
  toolContext.candidates = [
    { artist: 'Ulcerate', title: 'Cutting the Throat of God', releaseDates: ['2026-09-12'], sourceUrls: [SOURCES.loudwire] },
  ]
  const dispatched = await dispatch(result.name, result.input, toolContext)

  assert.equal(dispatched.done, false)
  assert.ok(!dispatched.done && dispatched.result.includes('en.wikipedia.org/wiki/Ulcerate'))
  assert.ok(!dispatched.done && dispatched.result.includes('technical death metal'))
  assert.deepEqual(
    toolContext.candidates.map((candidate) => candidate.title),
    ['Cutting the Throat of God'],
    'a search is not a way to discover a release',
  )
})

test('a search sends the key in a header and the query in the body', async () => {
  const result = validateAction(call('web_search', '{"query": "ulcerate"}'))
  assert.ok(result.ok)

  const seen: { url: string; body: string; headers?: Record<string, string> }[] = []
  const { toolContext } = context({
    http: {
      get: notFetched,
      post: async (url, body, headers) => {
        seen.push({ url, body, ...(headers === undefined ? {} : { headers }) })
        return { status: 200, headers: {}, body: SEARCH_BODY }
      },
    },
  })
  await dispatch(result.name, result.input, toolContext)

  assert.equal(seen[0]?.url, SEARCH_ENDPOINT)
  assert.equal(JSON.parse(seen[0]?.body ?? '{}').query, 'ulcerate')
  assert.equal(seen[0]?.headers?.['authorization'], 'Bearer test-key')
})

test('a search that fails is an ordinary step result with a warning', async () => {
  const result = validateAction(call('web_search', '{"query": "ulcerate"}'))
  assert.ok(result.ok)

  const { toolContext } = context({
    http: { get: notFetched, post: async () => ({ status: 429, headers: {}, body: 'slow down' }) },
  })
  const dispatched = await dispatch(result.name, result.input, toolContext)

  assert.equal(dispatched.done, false)
  assert.ok(!dispatched.done && dispatched.warning?.includes('429'))
  assert.ok(!dispatched.done && dispatched.result.length > 0, 'the model is told, not left waiting')
})
