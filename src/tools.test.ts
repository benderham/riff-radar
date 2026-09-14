import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

import { readFileSync } from 'node:fs'

import { SOURCES } from '../config.ts'
import type { HttpPort, ModelPort, Ports } from './ports.ts'
import { openStore } from './store/store.ts'
import type { ToolContext } from './tools.ts'
import { dispatch, toolDefinitions, tools, validateAction } from './tools.ts'

const call = (name: string, argumentsJson: string) => ({ id: 'call-1', name, argumentsJson })

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')

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
    http: over.http ?? { get: async () => ({ status: 200, headers: {}, body: fixture('aoty.html') }) },
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

  const toolContext: ToolContext = { ports, store, runId: 'run-1', candidates: [] }
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

test('an unconfigured source is rejected before anything is fetched', () => {
  const result = validateAction(call('fetch_source', '{"source_id": "metal-archives"}'))
  assert.equal(result.ok, false)
})

test('fetching a source returns its candidates and prices its own model call', async () => {
  const result = validateAction(call('fetch_source', '{"source_id": "aoty"}'))
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
  const result = validateAction(call('fetch_source', '{"source_id": "aoty"}'))
  assert.ok(result.ok)

  const { toolContext, store } = context()
  await dispatch(result.name, result.input, toolContext)

  const row = store.database.prepare('SELECT * FROM source_texts WHERE run_id = ?').get('run-1')
  assert.equal(row?.['source_id'], 'aoty')
  assert.equal(row?.['url'], SOURCES.aoty)
  assert.equal(row?.['status'], 200)
  assert.equal(row?.['candidate_count'], 2)
  assert.ok(String(row?.['raw_body']).includes('<div class="albumBlock">'))
})

test('a source that yields nothing is recorded, warned about, and does not throw', async () => {
  const result = validateAction(call('fetch_source', '{"source_id": "loudwire"}'))
  assert.ok(result.ok)

  const { toolContext, store } = context({
    http: { get: async () => ({ status: 500, headers: {}, body: 'server error' }) },
  })
  const dispatched = await dispatch(result.name, result.input, toolContext)

  assert.ok(!dispatched.done && dispatched.warning?.includes('500'))
  assert.deepEqual(toolContext.candidates, [])
  const row = store.database.prepare('SELECT * FROM source_texts WHERE source_id = ?').get('loudwire')
  assert.equal(row?.['status'], 500)
  assert.ok(String(row?.['warning']).includes('500'))
})

test('the same release from two sources stays one candidate with both URLs', async () => {
  const result = validateAction(call('fetch_source', '{"source_id": "aoty"}'))
  assert.ok(result.ok)
  const second = validateAction(call('fetch_source', '{"source_id": "wikipedia"}'))
  assert.ok(second.ok)

  const { toolContext } = context()
  await dispatch(result.name, result.input, toolContext)
  await dispatch(second.name, second.input, toolContext)

  assert.equal(toolContext.candidates.length, 2)
  assert.deepEqual(toolContext.candidates[0]?.sourceUrls, [SOURCES.aoty, SOURCES.wikipedia])
})

test('finish hands its items back to the loop rather than judging them', async () => {
  const result = validateAction(call('finish', '{"shortlist": [{"artist": "Ulcerate"}]}'))
  assert.ok(result.ok)

  const { toolContext } = context()
  const dispatched = await dispatch(result.name, result.input, toolContext)
  assert.ok(dispatched.done)
  assert.deepEqual(dispatched.shortlist, [{ artist: 'Ulcerate' }])
})
