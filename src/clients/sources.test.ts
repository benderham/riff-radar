import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { MAX_SOURCE_TEXT_CHARS, SOURCES } from '../../config.ts'
import type { HttpPort, ModelPort, ModelResponse, Ports } from '../ports.ts'
import { fetchSource } from './sources.ts'

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8')

const USAGE = { uncachedInputTokens: 900, cachedInputTokens: 0, outputTokens: 120 }

/** Serves one body for any URL, and records what was asked for. */
const servingFixture = (body: string, status = 200) => {
  const gets: string[] = []
  const http: HttpPort = {
    get: async (url) => {
      gets.push(url)
      return { status, headers: { 'content-type': 'text/html' }, body }
    },
  }
  return { http, gets }
}

/** Answers the extraction call with whatever the test says, and keeps the prompt. */
const extracting = (content: string) => {
  const prompts: string[] = []
  const model: ModelPort = {
    complete: async ({ messages, tools }) => {
      prompts.push(messages.map((message) => message.content).join('\n'))
      assert.deepEqual(tools, [], 'extraction asks for text back, never a tool call')
      return { content, toolCalls: [], usage: USAGE, cacheReported: true, raw: {} } as ModelResponse
    },
  }
  return { model, prompts }
}

const extracted = (candidates: readonly unknown[]) => JSON.stringify({ candidates })

const portsFor = (http: HttpPort, model: ModelPort): Ports => ({
  http,
  model,
  clock: { now: () => new Date(2026, 8, 14) },
})

test('the configured URL is fetched, and the cleaned page reaches the extraction call', async () => {
  const { http, gets } = servingFixture(fixture('aoty.html'))
  const { model, prompts } = extracting(
    extracted([
      {
        artist: 'Ulcerate',
        title: 'Cutting the Throat of God',
        releaseDate: '2026-09-12',
        label: 'Debemur Morti Productions',
        format: 'LP',
      },
    ]),
  )

  const result = await fetchSource(portsFor(http, model), 'aoty')

  assert.deepEqual(gets, [SOURCES.aoty])
  assert.equal(result.url, SOURCES.aoty)
  assert.equal(result.status, 200)
  // The model sees the text, not the markup.
  assert.ok(prompts[0]?.includes('Cutting the Throat of God'))
  assert.ok(!prompts[0]?.includes('<div'))
  assert.ok(!prompts[0]?.includes('__AOTY__'), 'inline script must not reach the model')
  assert.deepEqual(result.candidates, [
    {
      artist: 'Ulcerate',
      title: 'Cutting the Throat of God',
      releaseDates: ['2026-09-12'],
      sourceUrls: [SOURCES.aoty],
      label: 'Debemur Morti Productions',
      format: 'LP',
    },
  ])
})

test('the raw body is kept whole, alongside the cleaned text', async () => {
  const body = fixture('wikipedia.html')
  const { http } = servingFixture(body)
  const { model } = extracting(extracted([]))

  const result = await fetchSource(portsFor(http, model), 'wikipedia')

  assert.equal(result.rawBody, body)
  assert.ok(result.cleanedText.includes('Absolute Elsewhere'))
  assert.equal(result.truncated, false)
})

test('the extraction call is priced into the run', async () => {
  const { http } = servingFixture(fixture('loudwire.html'))
  const { model } = extracting(extracted([]))

  const result = await fetchSource(portsFor(http, model), 'loudwire')
  assert.deepEqual(result.usage, USAGE)
  assert.equal(result.cacheReported, true)
})

test('an oversized page is cut, the cut is marked, and the raw body is still whole', async () => {
  const body = `<p>${'Gatecreeper — Dark Superstition. '.repeat(4000)}</p>`
  assert.ok(body.length > MAX_SOURCE_TEXT_CHARS)

  const { http } = servingFixture(body)
  const { model, prompts } = extracting(extracted([]))

  const result = await fetchSource(portsFor(http, model), 'aoty')

  assert.equal(result.truncated, true)
  assert.equal(result.rawBody, body)
  assert.ok(result.cleanedText.length <= MAX_SOURCE_TEXT_CHARS)
  assert.ok(prompts[0]?.includes('truncated'))
})

test('a source that yields no candidates records a warning rather than passing quietly', async () => {
  const { http } = servingFixture(fixture('aoty.html'))
  const { model } = extracting(extracted([]))

  const result = await fetchSource(portsFor(http, model), 'aoty')

  assert.deepEqual(result.candidates, [])
  assert.match(result.warning ?? '', /no candidates/i)
  assert.ok(result.warning?.includes(SOURCES.aoty))
})

test('a non-2xx response is a warning naming the status, not an empty page', async () => {
  const { http } = servingFixture('go away', 403)
  const { model, prompts } = extracting(extracted([]))

  const result = await fetchSource(portsFor(http, model), 'aoty')

  assert.equal(result.status, 403)
  assert.deepEqual(result.candidates, [])
  assert.match(result.warning ?? '', /403/)
  assert.deepEqual(prompts, [], 'a page that did not arrive is never handed to the model')
})

test('extraction returning something other than JSON is a readable warning', async () => {
  const { http } = servingFixture(fixture('aoty.html'))
  const { model } = extracting('I could not read that page, sorry.')

  const result = await fetchSource(portsFor(http, model), 'aoty')

  assert.deepEqual(result.candidates, [])
  assert.match(result.warning ?? '', /not valid JSON/i)
})

test('extraction returning JSON of the wrong shape is a readable warning', async () => {
  const { http } = servingFixture(fixture('aoty.html'))
  const { model } = extracting(JSON.stringify({ albums: ['Cool World'] }))

  const result = await fetchSource(portsFor(http, model), 'aoty')

  assert.deepEqual(result.candidates, [])
  assert.match(result.warning ?? '', /candidates/)
})

test('a fenced JSON block is read rather than refused', async () => {
  const { http } = servingFixture(fixture('loudwire.html'))
  const { model } = extracting(
    `\`\`\`json\n${extracted([{ artist: 'Sumac', title: 'The Healer', releaseDate: '2026-09-13' }])}\n\`\`\``,
  )

  const result = await fetchSource(portsFor(http, model), 'loudwire')
  assert.equal(result.candidates.length, 1)
  assert.equal(result.warning, undefined)
})

test('rows the extraction could not date are dropped and counted', async () => {
  const { http } = servingFixture(fixture('wikipedia.html'))
  const { model } = extracting(
    extracted([
      { artist: 'Blood Incantation', title: 'Absolute Elsewhere', releaseDate: '2026-09-10' },
      { artist: 'Chat Pile', title: 'Cool World', releaseDate: 'September 11, 2026' },
    ]),
  )

  const result = await fetchSource(portsFor(http, model), 'wikipedia')

  assert.equal(result.candidates.length, 1)
  assert.equal(result.droppedRows, 1)
})
