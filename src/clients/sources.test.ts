import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { MAX_SOURCE_TEXT_CHARS, SOURCES } from '../../config.ts'
import type { HttpPort, ModelPort, ModelResponse, Ports } from '../ports.ts'
import { fetchSource } from './sources.ts'

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8')

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

const USAGE = { uncachedInputTokens: 900, cachedInputTokens: 0, outputTokens: 120 }

const refusePost = async (url: string): Promise<never> => {
  throw new Error(`unexpected post to ${url}`)
}

/** Serves one body for any URL, and records what was asked for. */
const servingFixture = (body: string, status = 200, attempts = 1) => {
  const gets: string[] = []
  const http: HttpPort = {
    patch: async () => { throw new Error('unexpected patch') },
    get: async (url) => {
      gets.push(url)
      return { status, attempts, headers: { 'content-type': 'text/html' }, body }
    },
    // A source is a page, read with GET. Nothing here should ever post.
    post: refusePost,
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

/** The window every test in this file runs in, unless it says otherwise. */
const WINDOW = { from: '2026-09-08', to: '2026-09-14' }

const portsFor = (http: HttpPort, model: ModelPort): Ports => ({
  http,
  model,
  clock: { now: () => new Date(2026, 8, 14), sleep: async () => {} },
})

test('the configured URL is fetched, and the cleaned page reaches the extraction call', async () => {
  const { http, gets } = servingFixture(PAGE)
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

  const result = await fetchSource(portsFor(http, model), 'loudwire', WINDOW)

  assert.deepEqual(gets, [SOURCES.loudwire])
  assert.equal(result.url, SOURCES.loudwire)
  assert.equal(result.status, 200)
  // The model sees the text, not the markup.
  assert.ok(prompts[0]?.includes('Cutting the Throat of God'))
  assert.ok(!prompts[0]?.includes('<div'))
  assert.ok(!prompts[0]?.includes('__TRACKING__'), 'inline script must not reach the model')
  assert.deepEqual(result.candidates, [
    {
      artist: 'Ulcerate',
      title: 'Cutting the Throat of God',
      releaseDates: ['2026-09-12'],
      sourceUrls: [SOURCES.loudwire],
      label: 'Debemur Morti Productions',
      format: 'LP',
    },
  ])
})

test('the raw body is kept whole even when the text handed on was cut', async () => {
  const body = fixture('wikipedia.html')
  const { http } = servingFixture(body)
  const { model } = extracting(extracted([]))

  const result = await fetchSource(portsFor(http, model), 'wikipedia', WINDOW)

  // 1.5 MB of page, stored exactly as served, so an extraction that looks wrong
  // can be re-examined against what was actually read.
  assert.equal(result.rawBody, body)
  assert.equal(result.rawBody.length > result.cleanedText.length * 10, true)

  // The real page is larger than the cap: cut, marked, and still carrying the
  // release tables, which sit long before the references.
  assert.equal(result.truncated, true)
  assert.ok(result.cleanedText.endsWith('[truncated: the page is longer than this]'))
  assert.ok(result.cleanedText.includes('Archgoat'))
})

test('the extraction call is priced into the run', async () => {
  const { http } = servingFixture(fixture('loudwire.html'))
  const { model } = extracting(extracted([]))

  const result = await fetchSource(portsFor(http, model), 'loudwire', WINDOW)
  assert.deepEqual(result.usage, USAGE)
  assert.equal(result.cacheReported, true)
})

test('an oversized page is cut, the cut is marked, and the raw body is still whole', async () => {
  const body = `<p>${'Gatecreeper — Dark Superstition. '.repeat(4000)}</p>`
  assert.ok(body.length > MAX_SOURCE_TEXT_CHARS)

  const { http } = servingFixture(body)
  const { model, prompts } = extracting(extracted([]))

  const result = await fetchSource(portsFor(http, model), 'loudwire', WINDOW)

  assert.equal(result.truncated, true)
  assert.equal(result.rawBody, body)
  assert.ok(result.cleanedText.length <= MAX_SOURCE_TEXT_CHARS)
  assert.ok(prompts[0]?.includes('truncated'))
})

test('a source that yields no candidates records a warning rather than passing quietly', async () => {
  const { http } = servingFixture(PAGE)
  const { model } = extracting(extracted([]))

  const result = await fetchSource(portsFor(http, model), 'loudwire', WINDOW)

  assert.deepEqual(result.candidates, [])
  assert.match(result.warning ?? '', /no candidates/i)
  assert.ok(result.warning?.includes(SOURCES.loudwire))
})

test('a non-2xx response is a warning naming the status, not an empty page', async () => {
  const { http } = servingFixture('go away', 403)
  const { model, prompts } = extracting(extracted([]))

  const result = await fetchSource(portsFor(http, model), 'loudwire', WINDOW)

  assert.equal(result.status, 403)
  assert.deepEqual(result.candidates, [])
  assert.match(result.warning ?? '', /403/)
  assert.deepEqual(prompts, [], 'a page that did not arrive is never handed to the model')
})

test('extraction returning something other than JSON is a readable warning', async () => {
  const { http } = servingFixture(PAGE)
  const { model } = extracting('I could not read that page, sorry.')

  const result = await fetchSource(portsFor(http, model), 'loudwire', WINDOW)

  assert.deepEqual(result.candidates, [])
  assert.match(result.warning ?? '', /not valid JSON/i)
})

test('extraction returning JSON of the wrong shape is a readable warning', async () => {
  const { http } = servingFixture(PAGE)
  const { model } = extracting(JSON.stringify({ albums: ['Cool World'] }))

  const result = await fetchSource(portsFor(http, model), 'loudwire', WINDOW)

  assert.deepEqual(result.candidates, [])
  assert.match(result.warning ?? '', /candidates/)
})

test('a fenced JSON block is read rather than refused', async () => {
  const { http } = servingFixture(fixture('loudwire.html'))
  const { model } = extracting(
    `\`\`\`json\n${extracted([{ artist: 'Sumac', title: 'The Healer', releaseDate: '2026-09-13' }])}\n\`\`\``,
  )

  const result = await fetchSource(portsFor(http, model), 'loudwire', WINDOW)
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

  const result = await fetchSource(portsFor(http, model), 'wikipedia', WINDOW)

  assert.equal(result.candidates.length, 1)
  assert.equal(result.droppedRows, 1)
})

test('releases outside the run\'s window are dropped and counted', async () => {
  const { http } = servingFixture(fixture('loudwire.html'))
  const { model, prompts } = extracting(
    extracted([
      { artist: 'Ulcerate', title: 'Cutting the Throat of God', releaseDate: '2026-09-12' },
      { artist: 'Amon Amarth', title: 'The Allfather Awakens', releaseDate: '2026-10-02' },
    ]),
  )

  const result = await fetchSource(portsFor(http, model), 'loudwire', WINDOW)

  // Asked of the model, and then enforced here: a year-long calendar would
  // otherwise reach the loop whole.
  assert.ok(prompts[0]?.includes('2026-09-08 to 2026-09-14'))
  assert.deepEqual(result.candidates.map((each) => each.artist), ['Ulcerate'])
  assert.equal(result.outsideWindow, 1)
  assert.equal(result.droppedRows, 0)
})

test('a page that listed releases, none of them this week, says so', async () => {
  const { http } = servingFixture(fixture('loudwire.html'))
  const { model } = extracting(
    extracted([{ artist: 'Amon Amarth', title: 'The Allfather Awakens', releaseDate: '2026-10-02' }]),
  )

  const result = await fetchSource(portsFor(http, model), 'loudwire', WINDOW)

  assert.deepEqual(result.candidates, [])
  assert.match(result.warning ?? '', /none inside 2026-09-08\.\.2026-09-14/)
})

// ── Failure categories (ticket 01) ───────────────────────────────────────────

test('a page that refused us is refused, and one that was never answered is transient', async () => {
  const { model } = extracting('')

  const forbidden = await fetchSource(portsFor(servingFixture('go away', 403).http, model), 'loudwire', WINDOW)
  assert.equal(forbidden.failureCategory, 'refused')

  const dead = await fetchSource(portsFor(servingFixture('fetch failed: ENOTFOUND', 0).http, model), 'loudwire', WINDOW)
  assert.equal(dead.failureCategory, 'transient')
})

test('a page that answered and an extraction that did not parse is malformed', async () => {
  const { http } = servingFixture(PAGE)
  const { model } = extracting('I could not read that page.')

  const result = await fetchSource(portsFor(http, model), 'loudwire', WINDOW)

  assert.equal(result.status, 200, 'the page itself was fine')
  assert.equal(result.failureCategory, 'malformed')
})

test('a page that yielded nothing has a warning and no category: nothing failed', async () => {
  const { http } = servingFixture(PAGE)
  const { model } = extracting(extracted([]))

  const result = await fetchSource(portsFor(http, model), 'loudwire', WINDOW)

  assert.match(String(result.warning), /may have changed shape/)
  assert.equal(result.failureCategory, undefined)
})

test('a page that only answered on the second ask says so, though nothing failed', async () => {
  // The case `attempts` exists for: the page answered, the candidates are real,
  // and the only thing odd about the step is the seconds it took.
  const { http } = servingFixture(PAGE, 200, 2)
  const { model } = extracting(
    extracted([
      {
        artist: 'Ulcerate',
        title: 'Cutting the Throat of God',
        releaseDate: '2026-09-12',
        format: 'LP',
      },
    ]),
  )

  const read = await fetchSource(portsFor(http, model), 'wikipedia', WINDOW)

  assert.equal(read.candidates.length, 1, 'a retry that worked is still a result')
  assert.match(String(read.warning), /answered after 2 attempts/)
  assert.equal(read.failureCategory, undefined, 'a slow success is not a failure')
})
