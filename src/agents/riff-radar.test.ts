import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  ACTION_SCHEMA_VERSION,
  MAX_RUN_COST_USD,
  MODEL_ID,
  MUSICBRAINZ_ENDPOINT,
  NOTION_ENDPOINT,
  NOTION_PROPERTIES,
  PROMPT_VERSION,
  SOURCES,
} from '../../config.ts'
import { withCategory } from '../domain/failure.ts'
import type { ShortlistItem } from '../domain/shortlist.ts'
import type { TasteProfile } from '../domain/taste-profile.ts'
import { tasteProfileSchema } from '../domain/taste-profile.ts'
import type {
  ClockPort,
  HttpPort,
  ModelMessage,
  ModelPort,
  ModelResponse,
  ToolDefinition,
} from '../ports.ts'
import type { RecordedStep, Store, TracedStep } from '../store/store.ts'
import { openStore } from '../store/store.ts'
import { runRiffRadar } from './riff-radar.ts'

/** Only the Notion write patches anything; every other fake refuses. */
const notPatched = async (): Promise<never> => {
  throw new Error('unexpected patch')
}

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

/**
 * A MusicBrainz search response matching whatever the URL asked about, so that
 * a scripted `lookup_release` enriches its candidate the way a real one does.
 * The client sends `artist:"X" AND releasegroup:"Y"`; this reads them back out.
 */
const musicbrainzBody = (url: string): string => {
  const query = decodeURIComponent(new URL(url).searchParams.get('query') ?? '')
  const artist = /artist:"([^"]*)"/.exec(query)?.[1] ?? ''
  const title = /releasegroup:"([^"]*)"/.exec(query)?.[1] ?? ''

  return JSON.stringify({
    'release-groups': [
      {
        id: `rg-${title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`,
        title,
        score: 100,
        'primary-type': 'Album',
        'first-release-date': '2026-09-10',
        'artist-credit': [{ name: artist }],
      },
    ],
  })
}

const isMusicbrainz = (url: string): boolean => url.startsWith(MUSICBRAINZ_ENDPOINT)

/**
 * Answers MusicBrainz and delegates everything else, so a fake written to test
 * sources or search does not also have to know how a lookup works.
 */
const withMusicbrainz = (http: HttpPort): HttpPort => ({
  ...http,
  get: async (url, headers) =>
    isMusicbrainz(url)
      ? { status: 200, attempts: 1, headers: { 'content-type': 'application/json' }, body: musicbrainzBody(url) }
      : http.get(url, headers),
})

/** Looks every release up, then finishes: what an ordinary run does. */
const looksUpThenFinishes = (count: number) => [
  ...RELEASES.slice(0, count).map((release) =>
    proposes('lookup_release', JSON.stringify({ artist: release.artist, title: release.title })),
  ),
  finishes(items(count)),
]

/** For the fakes that read sources and nothing else: a POST from one is a bug in the test. */
const notSearched = async (): Promise<never> => {
  throw new Error('this test fetches sources only; nothing should search')
}

/** Every source serves the same page unless a test says otherwise. */
const fixtureHttp = (body = PAGE, status = 200): HttpPort => ({
  patch: notPatched,
  get: async (url) =>
    isMusicbrainz(url)
      ? { status: 200, attempts: 1, headers: { 'content-type': 'application/json' }, body: musicbrainzBody(url) }
      : { status, attempts: 1, headers: { 'content-type': 'text/html' }, body },
  post: async () => ({ status, attempts: 1, headers: { 'content-type': 'text/html' }, body }),
})

/**
 * Notion: the schema it describes, the records it holds, the pages it accepts.
 *
 * Every run reads it twice before it starts — once for the schema, once for the
 * memory — so every fake has to answer both, and a run without them does not
 * begin (ADR-0039, ticket 06). What was written and what was archived come back
 * beside the port, because the write is the thing under test.
 */
const NOTION_SCHEMA = JSON.stringify({
  properties: Object.fromEntries(
    Object.entries(NOTION_PROPERTIES).map(([name, type]) => [name, { type }]),
  ),
})

const withNotion = (
  http: HttpPort,
  rows: readonly { artist: string; title: string }[],
  over: { schema?: string; createStatus?: readonly number[] } = {},
) => {
  const written: { properties: Record<string, Record<string, unknown>> }[] = []
  const archived: string[] = []
  const json = { 'content-type': 'application/json' }

  const port: HttpPort = {
    ...http,
    get: async (url, headers) =>
      url.startsWith(NOTION_ENDPOINT)
        ? { status: 200, attempts: 1, headers: json, body: over.schema ?? NOTION_SCHEMA }
        : http.get(url, headers),

    post: async (url, body, headers) => {
      if (url === `${NOTION_ENDPOINT}/pages`) {
        written.push(JSON.parse(body))
        const status = over.createStatus?.[written.length - 1] ?? 200
        return { status, attempts: 1, headers: json, body: JSON.stringify({ id: `page-${written.length}` }) }
      }

      return url.startsWith(NOTION_ENDPOINT)
        ? {
            status: 200,
            attempts: 1,
            headers: json,
            body: JSON.stringify({
              results: rows.map((row) => ({
                properties: {
                  Album: { title: [{ plain_text: row.title }] },
                  Artist: { rich_text: [{ plain_text: row.artist }] },
                  Status: { select: { name: 'Rejected' } },
                },
              })),
              has_more: false,
              next_cursor: null,
            }),
          }
        : http.post(url, body, headers)
    },

    patch: async (url) => {
      archived.push(url)
      return { status: 200, attempts: 1, headers: json, body: '{}' }
    },
  }

  return { port, written, archived }
}

/** Every `now()` is a second after the last, so durations are observable. */
const tickingClock = (from = new Date(2026, 8, 14, 9, 0, 0)): ClockPort => {
  let tick = 0
  return { now: () => new Date(from.getTime() + tick++ * 1000), sleep: async () => {} }
}

const profile = tasteProfileSchema.parse({
  version: 3,
  artists: { always: [], watch: [], exclude: [] },
  labels: { include: [], exclude: [] },
  genres: { include: [], exclude: [] },
  personnel: { include: [], exclude: [] },
  vibe_notes: { include: [], exclude: [] },
})

type Scripted = Partial<ModelResponse> | Error

const DEFAULT_USAGE = { uncachedInputTokens: 100, cachedInputTokens: 20, outputTokens: 10 }

/** What the extraction call inside `fetch_source` costs in these tests. */
const EXTRACTION_USAGE = { uncachedInputTokens: 500, cachedInputTokens: 0, outputTokens: 50 }

/**
 * The releases every fetch in this file discovers, and the releases every
 * shortlist in it names. They are one list because a shortlist may only name a
 * release a source listed: a test that shortlists something else is testing the
 * guardrail rather than using it.
 */
const RELEASES = [
  { artist: 'Ulcerate', title: 'Cutting the Throat of God' },
  { artist: 'Chat Pile', title: 'Cool World' },
  { artist: 'Blood Incantation', title: 'Absolute Elsewhere' },
  { artist: 'Sumac', title: 'The Healer' },
  { artist: 'Couch Slut', title: 'You Could Do It Tonight' },
] as const

const EXTRACTED = JSON.stringify({
  candidates: RELEASES.map((release) => ({ ...release, releaseDate: '2026-09-12' })),
})

/**
 * A model that says exactly what the test tells it to. The last entry repeats,
 * so a loop that should run to a ceiling can be scripted in one line.
 */
const scriptedModel = (...script: readonly Scripted[]) => scriptedModelExtracting(EXTRACTED)(...script)

/** The same model, for the tests that care what an extraction came back as. */
const scriptedModelExtracting = (extracted: string) => (...script: readonly Scripted[]) => {
  const requests: { messages: readonly ModelMessage[]; tools: readonly ToolDefinition[] }[] = []
  let index = 0

  const port: ModelPort = {
    complete: async (request) => {
      // A call offering no tools is `fetch_source` extracting a page, not the
      // loop choosing an action. It is answered separately and left out of the
      // script and the record, so that a test's steps stay countable.
      if (request.tools.length === 0) {
        return {
          content: extracted,
          toolCalls: [],
          usage: EXTRACTION_USAGE,
          cacheReported: true,
          raw: { extraction: true },
        }
      }

      // Snapshotted: the loop appends to one array, so a stored reference would
      // make every request look like the last one.
      requests.push({ ...request, messages: [...request.messages] })
      const next = script[Math.min(index++, script.length - 1)] ?? {}
      if (next instanceof Error) throw next

      return {
        content: '',
        toolCalls: [],
        usage: DEFAULT_USAGE,
        cacheReported: true,
        raw: { scripted: true },
        ...next,
      }
    },
  }

  return { port, requests, get calls() { return index } }
}

const proposes = (name: string, argumentsJson: string): Partial<ModelResponse> => ({
  toolCalls: [{ id: `call-${name}`, name, argumentsJson }],
})

const finishes = (shortlist: readonly unknown[]): Partial<ModelResponse> =>
  proposes('finish', JSON.stringify({ shortlist }))

const item = (index: number, overrides: Partial<ShortlistItem> = {}): ShortlistItem => ({
  // Past the end is a test asking for a release no source listed, which the
  // shortlist validator refuses: better to say so here than to read it as a
  // termination reason five assertions later.
  artist: RELEASES[index - 1]?.artist ?? assert.fail(`no release ${index}`),
  title: RELEASES[index - 1]?.title ?? '',
  releaseDate: '2026-09-10',
  sourceUrls: ['https://albumoftheyear.org/album/1'],
  rank: index,
  rationale: 'watch-list artist',
  musicbrainzId: `mbid-${index}`,
  ...overrides,
})

const items = (count: number) => Array.from({ length: count }, (_, index) => item(index + 1))

const run = async (
  model: ModelPort,
  args: Partial<{
    dryRun: boolean
    http: HttpPort
    profile: TasteProfile
    alreadyInNotion: readonly { artist: string; title: string }[]
    notionSchema: string
    createStatus: readonly number[]
    store: Store
    resumeRunId: string
  }> = {},
) => {
  const store = args.store ?? openStore(':memory:')
  const notion = withNotion(args.http ?? fixtureHttp(), args.alreadyInNotion ?? [], {
    ...(args.notionSchema === undefined ? {} : { schema: args.notionSchema }),
    ...(args.createStatus === undefined ? {} : { createStatus: args.createStatus }),
  })
  const outcome = await runRiffRadar({
    args: {
      command: 'run',
      lastDays: 7,
      dryRun: args.dryRun ?? false,
      ...(args.resumeRunId === undefined ? {} : { resumeRunId: args.resumeRunId }),
      raw: 'run',
    },
    ports: {
      clock: tickingClock(),
      model,
      http: notion.port,
    },
    store,
    profile: args.profile ?? profile,
    searchApiKey: 'test-key',
    notionToken: 'test-notion-token',
    notionDatabaseId: 'test-database',
  })

  const runRow = store.database.prepare('SELECT * FROM runs WHERE run_id = ?').get(outcome.runId)
  const stepRows = store.database
    .prepare('SELECT * FROM steps WHERE run_id = ? ORDER BY step_index')
    .all(outcome.runId)

  return { outcome, store, runRow, stepRows, written: notion.written, archived: notion.archived }
}

/**
 * The finish step, which is no longer the last step: a run that writes to
 * Notion records that afterwards.
 */
const finishRow = (stepRows: readonly Record<string, unknown>[]): Record<string, unknown> =>
  stepRows.findLast((row) => row['kind'] === 'finish') ?? assert.fail('no finish step')

// ── Termination reasons ──────────────────────────────────────────────────────

test('finish with five valid items ends the run completed', async () => {
  const { outcome, runRow } = await run(scriptedModel(proposes('fetch_source', '{"source_id": "loudwire"}'), ...looksUpThenFinishes(5)).port)

  assert.equal(outcome.terminationReason, 'completed')
  assert.equal(outcome.shortlistSize, 5)
  assert.equal(runRow?.['termination_reason'], 'completed')
  assert.equal(runRow?.['shortlist_size'], 5)
})

test('finish with one to four valid items ends the run completed_short', async () => {
  const { outcome, runRow } = await run(scriptedModel(proposes('fetch_source', '{"source_id": "loudwire"}'), ...looksUpThenFinishes(3)).port)

  assert.equal(outcome.terminationReason, 'completed_short')
  assert.equal(outcome.shortlistSize, 3)
  assert.equal(runRow?.['shortlist_size'], 3)
})

test('finish with an empty shortlist ends the run no_candidates', async () => {
  const { outcome, runRow } = await run(scriptedModel(finishes([])).port)

  assert.equal(outcome.terminationReason, 'no_candidates')
  assert.equal(runRow?.['notion_write_performed'], 0)
})

test('finish with an invalid shortlist ends the run validation_failed', async () => {
  const model = scriptedModel(proposes('fetch_source', '{"source_id": "loudwire"}'), finishes([item(1, { sourceUrls: [] })]))
  const { outcome, runRow, stepRows } = await run(model.port)

  assert.equal(outcome.terminationReason, 'validation_failed')
  assert.equal(outcome.shortlistSize, 0, 'an invalid shortlist is not a shortlist')
  assert.equal(runRow?.['notion_write_performed'], 0)
  assert.match(String(finishRow(stepRows)?.['error']), /no source URL/)
})

test('three consecutive invalid actions end the run invalid_action_limit', async () => {
  const model = scriptedModel(proposes('web_search', '{"q": "wrong key"}'))
  const { outcome, runRow, stepRows } = await run(model.port)

  assert.equal(outcome.terminationReason, 'invalid_action_limit')
  assert.equal(stepRows.length, 3, 'the third invalid action is the last step')
  assert.equal(runRow?.['notion_write_performed'], 0)
})

test('prose where an action was required counts as an invalid action', async () => {
  const model = scriptedModel({ content: 'I think I will have a think about it.' })
  const { outcome, stepRows } = await run(model.port)

  assert.equal(outcome.terminationReason, 'invalid_action_limit')
  assert.equal(stepRows[0]?.['kind'], 'invalid_action')
  assert.match(String(stepRows[0]?.['validation_result']), /no action proposed/)
})

test('two actions proposed in one step is an invalid action, and both are recorded', async () => {
  const model = scriptedModel(
    {
      toolCalls: [
        { id: 'a', name: 'web_search', argumentsJson: '{"query": "one"}' },
        { id: 'b', name: 'web_search', argumentsJson: '{"query": "two"}' },
      ],
    },
    proposes('fetch_source', '{"source_id": "loudwire"}'),
    ...looksUpThenFinishes(1),
  )
  const { outcome, stepRows } = await run(model.port)

  assert.equal(outcome.terminationReason, 'completed_short')
  assert.equal(stepRows[0]?.['kind'], 'invalid_action')
  assert.match(String(stepRows[0]?.['validation_result']), /2 actions proposed/)
  assert.equal(stepRows[0]?.['dispatched_action'], null)
  // Neither proposal is dropped: a refused action has to be in the trace.
  const proposed = String(stepRows[0]?.['proposed_action'])
  assert.match(proposed, /one/)
  assert.match(proposed, /two/)
})

test('thirty steps end the run max_steps_exceeded', async () => {
  const model = scriptedModel(proposes('web_search', '{"query": "again"}'))
  const { outcome, runRow, stepRows } = await run(model.port)

  assert.equal(outcome.terminationReason, 'max_steps_exceeded')
  assert.equal(stepRows.length, 30)
  assert.equal(runRow?.['notion_write_performed'], 0)
})

test('a run over the cost ceiling ends budget_exceeded', async () => {
  // One step's worth of output tokens priced past the ceiling on its own.
  const expensive = {
    ...proposes('web_search', '{"query": "expensive"}'),
    usage: { uncachedInputTokens: 0, cachedInputTokens: 0, outputTokens: 10_000_000 },
  }
  const { outcome, runRow, stepRows } = await run(scriptedModel(expensive).port)

  assert.equal(outcome.terminationReason, 'budget_exceeded')
  assert.equal(stepRows.length, 1, 'the ceiling is checked before the next call, not after it')
  assert.ok(outcome.estimatedCost >= MAX_RUN_COST_USD)
  assert.equal(runRow?.['notion_write_performed'], 0)
})

test('a model that fails unrecoverably ends the run tool_failure', async () => {
  const { outcome, runRow, stepRows } = await run(
    scriptedModel(new Error('502 from the provider')).port,
  )

  assert.equal(outcome.terminationReason, 'tool_failure')
  assert.equal(stepRows[0]?.['kind'], 'model_error')
  assert.match(String(stepRows[0]?.['error']), /502/)
  assert.equal(runRow?.['notion_write_performed'], 0)
})

// ── Failure categories (ticket 01) ───────────────────────────────────────────

test('a model failure records the category beside the reason, not instead of it', async () => {
  const provider = withCategory(new Error('model request failed: 503 Service Unavailable'), 'transient')
  const { outcome, stepRows } = await run(scriptedModel(provider).port)

  assert.equal(outcome.terminationReason, 'tool_failure', 'the reason is about the run')
  assert.equal(stepRows[0]?.['failure_category'], 'transient', 'the category is about the world')
})

test('a step where nothing outside the run failed records no category', async () => {
  const { stepRows } = await run(
    scriptedModel(proposes('fetch_source', '{"source_id": "loudwire"}'), ...looksUpThenFinishes(2)).port,
  )

  assert.deepEqual(
    stepRows.map((row) => row['failure_category']),
    stepRows.map(() => null),
  )
})

test('a source that refuses us records refused, and the run carries on', async () => {
  const model = scriptedModel(proposes('fetch_source', '{"source_id": "loudwire"}'), finishes([]))
  const { outcome, stepRows } = await run(model.port, { http: withMusicbrainz(fixtureHttp('nope', 403)) })

  assert.equal(stepRows[0]?.['failure_category'], 'refused')
  assert.match(String(stepRows[0]?.['warning']), /HTTP 403/)
  assert.equal(outcome.terminationReason, 'no_candidates', 'a refused source is a warning, not a failure')
})

// Where one step makes several external calls, the category is the one that
// produced the step's warning: here the page answered and the extraction of it
// did not, so the step is `malformed` rather than anything the status said.
test('a page that fetched and an extraction that did not parse records malformed', async () => {
  const model = scriptedModelExtracting('Sorry — I could not read that page.')(
    proposes('fetch_source', '{"source_id": "loudwire"}'),
    finishes([]),
  )
  const { stepRows } = await run(model.port)

  assert.equal(stepRows[0]?.['tool_name'], 'fetch_source')
  assert.equal(stepRows[0]?.['failure_category'], 'malformed')
  assert.equal(stepRows[0]?.['error'], null, 'a bad extraction is a warning, not a failed step')
  assert.match(String(stepRows[0]?.['warning']), /not valid JSON/)
})

test('a Notion write that is refused records the refusal on its own step', async () => {
  const model = scriptedModel(proposes('fetch_source', '{"source_id": "loudwire"}'), ...looksUpThenFinishes(2))
  const { outcome, stepRows } = await run(model.port, { createStatus: [200, 403] })

  const write = stepRows.findLast((row) => row['kind'] === 'notion_write')
  assert.equal(write?.['failure_category'], 'refused')
  assert.equal(outcome.notionWritePerformed, false)
  assert.equal(outcome.terminationReason, 'completed_short', 'the run had already ended well')
})

test('every category the clients produce is one the schema accepts', async () => {
  const { stepRows } = await run(
    scriptedModel(proposes('fetch_source', '{"source_id": "loudwire"}'), finishes([])).port,
    { http: withMusicbrainz(fixtureHttp('nope', 429)) },
  )

  // The CHECK constraint would have refused the insert, so reaching this
  // assertion is most of the test.
  assert.equal(stepRows[0]?.['failure_category'], 'rate_limited')
})

test('exactly one termination reason is recorded per run', async () => {
  const { store, outcome } = await run(scriptedModel(finishes(items(2))).port)
  const rows = store.database.prepare('SELECT termination_reason FROM runs').all()

  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.['termination_reason'], outcome.terminationReason)
})

// ── Guardrails in the trace ──────────────────────────────────────────────────

test('a rejected action is visible: proposed and unvalidated, never dispatched', async () => {
  const model = scriptedModel(
    // Album of the Year is no longer a configured source (ADR-0031), so asking
    // for it is exactly the rejection this test is about.
    proposes('fetch_source', '{"source_id": "aoty"}'),
    finishes(items(1)),
  )
  const { stepRows } = await run(model.port)

  const rejected = stepRows[0]
  assert.match(String(rejected?.['proposed_action']), /aoty/)
  assert.ok(rejected?.['validation_result'], 'the reason it was rejected is recorded')
  assert.equal(rejected?.['dispatched_action'], null, 'nothing was dispatched')

  const dispatched = stepRows[1]
  assert.equal(dispatched?.['validation_result'], 'valid')
  assert.match(String(dispatched?.['dispatched_action']), /finish/)
})

test('malformed JSON arguments are recorded as an invalid action, not a crash', async () => {
  const model = scriptedModel(proposes('web_search', '{"query": '), proposes('fetch_source', '{"source_id": "loudwire"}'), ...looksUpThenFinishes(1))
  const { outcome, stepRows } = await run(model.port)

  assert.equal(outcome.terminationReason, 'completed_short')
  assert.match(String(stepRows[0]?.['validation_result']), /not valid JSON/)
})

test('the model may correct itself: the invalid counter resets on a valid action', async () => {
  const model = scriptedModel(
    proposes('web_search', 'not json'),
    proposes('web_search', 'still not json'),
    proposes('fetch_source', '{"source_id": "loudwire"}'),
    proposes('web_search', 'not json again'),
    proposes('web_search', 'nor this'),
    ...looksUpThenFinishes(1),
  )
  const { outcome, stepRows } = await run(model.port)

  assert.equal(outcome.terminationReason, 'completed_short')
  assert.equal(
    stepRows.length,
    8,
    'four invalid actions, never three in a row, then a lookup, a finish and the write',
  )
})

test('a failed validation is returned to the model as that step result', async () => {
  const model = scriptedModel(proposes('web_search', '{"q": "wrong"}'), finishes(items(1)))
  await run(model.port)

  // The second request carries the rejection the first step produced.
  const second = model.requests[1]?.messages ?? []
  assert.match(
    second.map((message) => message.content).join('\n'),
    /Invalid action, not dispatched/,
  )
})

test('a dispatched action returns its result to the model', async () => {
  const model = scriptedModel(proposes('fetch_source', '{"source_id": "loudwire"}'), finishes(items(1)))
  const { stepRows } = await run(model.port)

  assert.match(String(stepRows[0]?.['tool_result']), /Cutting the Throat of God/)
  assert.match(
    (model.requests[1]?.messages ?? []).map((message) => message.content).join('\n'),
    /Cutting the Throat of God/,
  )
})

test('every step records its duration', async () => {
  const model = scriptedModel(proposes('fetch_source', '{"source_id": "loudwire"}'), finishes(items(1)))
  const { stepRows } = await run(model.port)

  assert.equal(stepRows.length, 2)
  // One tick per clock read inside the step. `finish` reads it once, to end the
  // step; `fetch_source` reads it twice, because it timestamps the page it
  // stored on its way through.
  assert.equal(stepRows[0]?.['duration_ms'], 2000)
  assert.equal(stepRows[1]?.['duration_ms'], 1000)
})

// ── The stable prefix, tokens and cost ───────────────────────────────────────

test('the stable prefix leads every request and never moves', async () => {
  const model = scriptedModel(
    proposes('fetch_source', '{"source_id": "loudwire"}'),
    proposes('web_search', '{"query": "ulcerate"}'),
    finishes(items(1)),
  )
  await run(model.port)

  assert.equal(model.requests.length, 3)
  const [first, , last] = model.requests

  assert.equal(first?.messages[0]?.role, 'system')
  assert.match(String(first?.messages[0]?.content), /Riff Radar/)
  assert.match(String(first?.messages[0]?.content), /Taste profile/)

  // Identical text in the identical position on the last request as the first,
  // with the step-by-step history appended after it.
  assert.deepEqual(last?.messages[0], first?.messages[0])
  assert.deepEqual(last?.messages[1], first?.messages[1])
  assert.ok((last?.messages.length ?? 0) > (first?.messages.length ?? 0))

  // Tool definitions travel beside the messages, not inside the history.
  assert.equal(first?.tools.length, 4)
})

test('tokens are counted three ways per step and summed onto the run', async () => {
  const model = scriptedModel(proposes('fetch_source', '{"source_id": "loudwire"}'), finishes(items(1)))
  const { outcome, runRow, stepRows } = await run(model.port)

  for (const step of stepRows) {
    assert.ok(Number(step['cost']) > 0)
  }

  // The first step fetched a source, so it carries its own model call's tokens
  // as well as the loop's: an extraction billed to nobody would make the cost
  // ceiling unenforceable exactly where the tokens are.
  assert.equal(
    stepRows[0]?.['uncached_input_tokens'],
    DEFAULT_USAGE.uncachedInputTokens + EXTRACTION_USAGE.uncachedInputTokens,
  )
  assert.equal(stepRows[0]?.['output_tokens'], DEFAULT_USAGE.outputTokens + EXTRACTION_USAGE.outputTokens)
  assert.equal(stepRows[1]?.['uncached_input_tokens'], DEFAULT_USAGE.uncachedInputTokens)
  assert.equal(stepRows[1]?.['cached_input_tokens'], DEFAULT_USAGE.cachedInputTokens)
  assert.equal(stepRows[1]?.['output_tokens'], DEFAULT_USAGE.outputTokens)

  assert.equal(
    runRow?.['uncached_input_tokens'],
    DEFAULT_USAGE.uncachedInputTokens * 2 + EXTRACTION_USAGE.uncachedInputTokens,
  )
  assert.equal(runRow?.['cached_input_tokens'], DEFAULT_USAGE.cachedInputTokens * 2)
  assert.equal(runRow?.['output_tokens'], DEFAULT_USAGE.outputTokens * 2 + EXTRACTION_USAGE.outputTokens)
  assert.equal(runRow?.['estimated_cost'], outcome.estimatedCost)

  const stepCosts = stepRows.reduce((total, step) => total + Number(step['cost']), 0)
  assert.ok(Math.abs(stepCosts - outcome.estimatedCost) < 1e-12)
})

test('a provider that reports no cache breakdown makes the cost an upper bound', async () => {
  const model = scriptedModel({ ...finishes(items(1)), cacheReported: false })
  const { outcome, runRow } = await run(model.port)

  assert.equal(outcome.costIsUpperBound, true)
  assert.equal(runRow?.['cost_is_upper_bound'], 1)
})

test('a reported cache breakdown makes the cost a measurement', async () => {
  const { outcome, runRow } = await run(scriptedModel(finishes(items(1))).port)

  assert.equal(outcome.costIsUpperBound, false)
  assert.equal(runRow?.['cost_is_upper_bound'], 0)
})

// ── The run record ───────────────────────────────────────────────────────────

test('the trace records the resolved absolute window, not the flag', async () => {
  const store = openStore(':memory:')
  const outcome = await runRiffRadar({
    args: { command: 'run', lastDays: 14, dryRun: false, raw: 'run --last-days 14' },
    ports: {
      clock: tickingClock(),
      model: scriptedModel(finishes(items(1))).port,
      http: withNotion(fixtureHttp(), []).port,
    },
    store,
    profile,
    searchApiKey: 'test-key',
    notionToken: 'test-notion-token',
    notionDatabaseId: 'test-database',
  })

  const row = store.database.prepare('SELECT * FROM runs WHERE run_id = ?').get(outcome.runId)
  assert.equal(row?.['resolved_from'], '2026-09-01')
  assert.equal(row?.['resolved_to'], '2026-09-14')
  assert.equal(row?.['cli_args'], 'run --last-days 14')
  assert.deepEqual(outcome.window, { from: '2026-09-01', to: '2026-09-14' })
})

test('the run is stamped with the versions that produced it', async () => {
  const { runRow } = await run(scriptedModel(finishes(items(1))).port)

  assert.equal(runRow?.['profile_version'], 3)
  assert.equal(runRow?.['prompt_version'], PROMPT_VERSION)
  assert.equal(runRow?.['action_schema_version'], 1)
  assert.equal(runRow?.['model_id'], 'accounts/fireworks/models/deepseek-v4p1-flash')
})

test('the run records when it started and when it ended', async () => {
  const { runRow } = await run(scriptedModel(finishes(items(1))).port)

  assert.equal(runRow?.['started_at'], new Date(2026, 8, 14, 9, 0, 0).toISOString())
  assert.ok(String(runRow?.['ended_at']) > String(runRow?.['started_at']))
})

// ── The Notion write (ticket 06) ─────────────────────────────────────────────

/** A run that ends `completed_short` with two eligible releases: the write's happy path. */
const proposingTwo = () =>
  scriptedModel(proposes('fetch_source', '{"source_id": "loudwire"}'), ...looksUpThenFinishes(2)).port

test('a completed run writes one Proposed page per item, carrying the run', async () => {
  const { outcome, runRow, written, stepRows } = await run(proposingTwo())

  assert.equal(outcome.notionWritePerformed, true)
  assert.equal(runRow?.['notion_write_performed'], 1)
  assert.equal(written.length, 2)

  for (const page of written) {
    assert.deepEqual(page.properties['Status'], { select: { name: 'Proposed' } })
    assert.equal(
      (page.properties['Run ID']!['rich_text'] as { text: { content: string } }[])[0]?.text.content,
      outcome.runId,
    )
    assert.ok(String(page.properties['Apple Music']!['url']).startsWith('https://music.apple.com/search'))
    assert.ok(!Object.keys(page.properties).includes('Rating'))
  }

  const write = stepRows.at(-1)
  assert.equal(write?.['kind'], 'notion_write')
  assert.equal(JSON.parse(String(write?.['tool_result'])).written, 2)
})

test('--dry-run does everything except write', async () => {
  const { outcome, runRow, written, stepRows } = await run(proposingTwo(), { dryRun: true })

  assert.equal(outcome.terminationReason, 'completed_short')
  assert.equal(outcome.shortlistSize, 2, 'the shortlist is still produced and still validated')
  assert.equal(outcome.notionWritePerformed, false)
  assert.equal(runRow?.['notion_write_performed'], 0)
  assert.deepEqual(written, [])
  assert.equal(stepRows.at(-1)?.['kind'], 'finish')
})

test('a termination reason other than completed blocks the write', async () => {
  // An invalid shortlist, an empty one, and a run that never reached `finish`.
  const blocked = [
    scriptedModel(proposes('fetch_source', '{"source_id": "loudwire"}'), finishes([item(1, { rationale: '' })])).port,
    scriptedModel(finishes([])).port,
    scriptedModel(...Array.from({ length: 3 }, () => proposes('no_such_tool', '{}'))).port,
  ]

  for (const model of blocked) {
    const { outcome, runRow, written } = await run(model)
    assert.ok(!['completed', 'completed_short'].includes(outcome.terminationReason))
    assert.equal(outcome.notionWritePerformed, false)
    assert.equal(runRow?.['notion_write_performed'], 0)
    assert.deepEqual(written, [])
  }
})

test('a write that fails part way through leaves the database as it found it', async () => {
  const { outcome, runRow, archived, stepRows } = await run(proposingTwo(), { createStatus: [200, 400] })

  assert.equal(outcome.notionWritePerformed, false)
  assert.equal(runRow?.['notion_write_performed'], 0)
  assert.equal(archived.length, 1, 'the page that was written is archived again')
  assert.match(String(outcome.notionWriteError), /rolled back/)
  assert.equal(stepRows.at(-1)?.['kind'], 'notion_write')
  assert.match(String(stepRows.at(-1)?.['error']), /HTTP 400/)
})

test('a database missing a property refuses the run before it starts', async () => {
  const { Rationale, ...properties } = JSON.parse(NOTION_SCHEMA).properties
  const store = openStore(':memory:')
  const model = scriptedModel(finishes([]))

  await assert.rejects(
    () =>
      runRiffRadar({
        args: { command: 'run', lastDays: 7, dryRun: false, raw: 'run' },
        ports: {
          clock: tickingClock(),
          model: model.port,
          http: withNotion(fixtureHttp(), [], { schema: JSON.stringify({ properties }) }).port,
        },
        store,
        profile,
        searchApiKey: 'test-key',
        notionToken: 'test-notion-token',
        notionDatabaseId: 'test-database',
      }),
    /Rationale \(rich_text\) is missing/,
  )

  assert.equal(store.database.prepare('SELECT count(*) AS n FROM runs').get()?.['n'], 0)
  assert.equal(model.calls, 0, 'not one model token is spent on a database that cannot be written to')
})

test('two runs in one database are distinct rows with distinct steps', async () => {
  const store = openStore(':memory:')
  const args = { command: 'run', lastDays: 7, dryRun: false, raw: 'run' } as const
  const ports = {
    clock: tickingClock(),
    model: scriptedModel(finishes(items(1))).port,
    http: withNotion(fixtureHttp(), []).port,
  }

  const request = {
    args,
    ports,
    store,
    profile,
    searchApiKey: 'test-key',
    notionToken: 'test-notion-token',
    notionDatabaseId: 'test-database',
  }
  const first = await runRiffRadar(request)
  const second = await runRiffRadar(request)

  assert.notEqual(first.runId, second.runId)
  assert.equal(store.database.prepare('SELECT count(*) AS n FROM runs').get()?.['n'], 2)
  assert.equal(store.database.prepare('SELECT count(*) AS n FROM steps').get()?.['n'], 2)
})

// ── Live discovery (ticket 02) ───────────────────────────────────────────────

test('a release listed by two sources is one candidate carrying both URLs', async () => {
  const byUrl: HttpPort = withMusicbrainz({
    patch: notPatched,
    get: async (url) => ({
      status: 200,
      attempts: 1,
      headers: {},
      body: url.includes('wikipedia') ? fixture('wikipedia.html') : PAGE,
    }),
    post: notSearched,
  })

  const model = scriptedModel(
    proposes('fetch_source', '{"source_id": "loudwire"}'),
    proposes('fetch_source', '{"source_id": "wikipedia"}'),
    ...looksUpThenFinishes(1),
  )
  const { outcome, store, stepRows } = await run(model.port, { http: byUrl })

  assert.equal(outcome.terminationReason, 'completed_short')

  // Both fetches produced the same release, so the second reports no new one.
  const second = JSON.parse(String(stepRows[1]?.['tool_result']))
  assert.equal(second.totalCandidates, RELEASES.length)
  assert.equal(second.newThisFetch, 0)
  assert.deepEqual(second.candidates[0].sourceUrls, [SOURCES.loudwire, SOURCES.wikipedia])

  // And both pages are in the trace, whole, against the run.
  const pages = store.database
    .prepare('SELECT * FROM source_texts WHERE run_id = ? ORDER BY source_id')
    .all(outcome.runId)
  assert.deepEqual(pages.map((page) => page['source_id']), ['loudwire', 'wikipedia'])
  assert.equal(pages[0]?.['raw_body'], PAGE, 'stored exactly as served')
})

test('a source that yields nothing warns on the step and the run carries on', async () => {
  const model = scriptedModel(
    proposes('fetch_source', '{"source_id": "loudwire"}'),
    proposes('fetch_source', '{"source_id": "wikipedia"}'),
    ...looksUpThenFinishes(1),
  )
  // One source refuses, the other serves: the shortlist comes from what is left.
  const { outcome, store, stepRows } = await run(model.port, {
    http: withMusicbrainz({
      patch: notPatched,
      get: async (url) =>
        url === SOURCES.loudwire
          ? { status: 403, attempts: 1, headers: {}, body: 'go away' }
          : { status: 200, attempts: 1, headers: {}, body: PAGE },
      post: notSearched,
    }),
  })

  assert.equal(outcome.terminationReason, 'completed_short', 'a lost source is not a lost run')
  assert.match(String(stepRows[0]?.['warning']), /403/)
  assert.equal(stepRows[0]?.['error'], null, 'a warning is not an error')
  assert.equal(stepRows[0]?.['kind'], 'action', 'a warning is not a failed step')

  const page = store.database
    .prepare('SELECT * FROM source_texts WHERE run_id = ? AND source_id = ?')
    .get(outcome.runId, 'loudwire')
  assert.equal(page?.['status'], 403)
  assert.equal(page?.['candidate_count'], 0)
})

test('a source fetch that throws ends the run as a tool failure', async () => {
  const model = scriptedModel(proposes('fetch_source', '{"source_id": "loudwire"}'), finishes(items(1)))
  const { outcome, stepRows } = await run(model.port, {
    http: {
      patch: notPatched,
      get: async () => {
        throw new Error('getaddrinfo ENOTFOUND')
      },
      post: notSearched,
    },
  })

  assert.equal(outcome.terminationReason, 'tool_failure')
  assert.equal(stepRows[0]?.['kind'], 'tool_error')
  assert.match(String(stepRows[0]?.['error']), /ENOTFOUND/)
})

// ── Web search (ticket 03) ───────────────────────────────────────────────────

const SEARCH_BODY = JSON.stringify({
  query: 'vaultwraith crimson nadir',
  results: [
    {
      title: 'Vaultwraith — Crimson Nadir, out this week',
      url: 'https://example.test/vaultwraith',
      content: 'A release no configured source listed.',
      score: 0.9,
    },
  ],
})

/** A page for a source over GET, the search payload for the search endpoint over POST. */
const searchingHttp = (searchStatus = 200): HttpPort => withMusicbrainz({
  patch: notPatched,
  get: async () => ({ status: 200, attempts: 1, headers: {}, body: PAGE }),
  post: async () => ({
    status: searchStatus,
    attempts: 1,
    headers: {},
    body: searchStatus === 200 ? SEARCH_BODY : 'slow down',
  }),
})

test('a search is an ordinary step: query, result and duration, all recorded', async () => {
  const model = scriptedModel(
    proposes('fetch_source', '{"source_id": "loudwire"}'),
    proposes('web_search', '{"query": "vaultwraith crimson nadir"}'),
    ...looksUpThenFinishes(1),
  )
  const { outcome, stepRows } = await run(model.port, { http: searchingHttp() })

  assert.equal(outcome.terminationReason, 'completed_short')

  const search = stepRows[1]
  assert.equal(search?.['kind'], 'action')
  assert.equal(search?.['tool_name'], 'web_search')
  assert.match(String(search?.['tool_args']), /vaultwraith crimson nadir/)
  assert.match(String(search?.['tool_result']), /example\.test\/vaultwraith/)
  assert.equal(search?.['error'], null)
  assert.ok(Number(search?.['duration_ms']) > 0)
})

test('a release only a search mentioned cannot reach the shortlist', async () => {
  const model = scriptedModel(
    proposes('fetch_source', '{"source_id": "loudwire"}'),
    proposes('web_search', '{"query": "vaultwraith crimson nadir"}'),
    finishes([item(1, { artist: 'Vaultwraith', title: 'Crimson Nadir', musicbrainzId: 'mbid-x' })]),
  )
  const { outcome, runRow, stepRows } = await run(model.port, { http: searchingHttp() })

  assert.equal(outcome.terminationReason, 'validation_failed')
  assert.equal(outcome.shortlistSize, 0)
  assert.equal(runRow?.['notion_write_performed'], 0)
  assert.match(String(finishRow(stepRows)?.['error']), /not among the candidates/)
})

test('a search that fails leaves the run running', async () => {
  const model = scriptedModel(
    proposes('fetch_source', '{"source_id": "loudwire"}'),
    proposes('web_search', '{"query": "ulcerate"}'),
    ...looksUpThenFinishes(1),
  )
  const { outcome, stepRows } = await run(model.port, { http: searchingHttp(429) })

  assert.equal(outcome.terminationReason, 'completed_short', 'a lost search is not a lost run')
  assert.match(String(stepRows[1]?.['warning']), /429/)
  assert.equal(stepRows[1]?.['error'], null, 'a warning is not an error')
  assert.equal(stepRows[1]?.['kind'], 'action')
})

// ── The profile ranks the shortlist, and the trace shows its working ─────────

const tasting = (over: Partial<TasteProfile>): TasteProfile =>
  tasteProfileSchema.parse({ ...profile, ...over, version: profile.version + 1 })

/** The order the finish step recorded, which is the order that would be written. */
const rankedOrder = (stepRows: readonly Record<string, unknown>[]): string[] =>
  JSON.parse(String(finishRow(stepRows)?.['tool_result'])).shortlist.map(
    (item: ShortlistItem) => item.artist,
  )

test('two profiles rank the same releases differently, and the trace says why', async () => {
  const script = () =>
    scriptedModel(proposes('fetch_source', '{"source_id": "loudwire"}'), ...looksUpThenFinishes(3)).port

  const first = await run(script(), {
    profile: tasting({ artists: { always: [], watch: ['Blood Incantation'], exclude: [] } }),
  })
  const second = await run(script(), {
    profile: tasting({ artists: { always: [], watch: ['Chat Pile'], exclude: [] } }),
  })

  assert.equal(rankedOrder(first.stepRows)[0], 'Blood Incantation')
  assert.equal(rankedOrder(second.stepRows)[0], 'Chat Pile')

  // The model proposed the same order both times; the profile moved it.
  assert.deepEqual(
    JSON.parse(String(finishRow(first.stepRows)?.['proposed_action']))[0].arguments,
    JSON.parse(String(finishRow(second.stepRows)?.['proposed_action']))[0].arguments,
  )

  const ranking = JSON.parse(String(finishRow(first.stepRows)?.['tool_result'])).ranking
  assert.deepEqual(ranking[0].signals, [{ signal: 'artist', term: 'Blood Incantation', points: 3 }])
  assert.equal(ranking[0].rank, 1)
})

test('the run records the profile version it ranked with', async () => {
  const { runRow } = await run(scriptedModel(finishes([])).port, {
    profile: tasting({ artists: { always: ['Ulcerate'], watch: [], exclude: [] } }),
  })

  assert.equal(runRow?.['profile_version'], profile.version + 1)
})

test('a vibe note cited in the stored source text scores; an invented one does not', async () => {
  const withVibe = (quote: string) =>
    scriptedModel(
      proposes('fetch_source', '{"source_id": "loudwire"}'),
      ...RELEASES.slice(0, 2).map((release) =>
        proposes('lookup_release', JSON.stringify({ artist: release.artist, title: release.title })),
      ),
      finishes([
        item(1),
        item(2, {
          sourceUrls: [SOURCES.loudwire],
          vibe: { claim: 'a cool world of dissonance', quote },
        }),
      ]),
    ).port

  const opinionated = tasting({ vibe_notes: { include: ['dissonance'], exclude: [] } })

  const cited = await run(withVibe('Chat Pile — Cool World'), { profile: opinionated })
  const invented = await run(withVibe('the best record of the year'), { profile: opinionated })

  assert.deepEqual(rankedOrder(cited.stepRows), ['Chat Pile', 'Ulcerate'])
  assert.deepEqual(rankedOrder(invented.stepRows), ['Ulcerate', 'Chat Pile'])
})

// ── Suppression: what Notion already holds never reaches the model ───────────

test('a release already in Notion is never offered to the model', async () => {
  const model = scriptedModel(proposes('fetch_source', '{"source_id": "loudwire"}'), ...looksUpThenFinishes(3))
  const { stepRows } = await run(model.port, {
    alreadyInNotion: [{ artist: 'Chat Pile', title: 'Cool World' }],
  })

  const fetched = JSON.parse(String(stepRows[0]?.['tool_result']))
  assert.equal(fetched.alreadyProposed, 1)
  assert.deepEqual(
    fetched.candidates.map((candidate: { artist: string }) => candidate.artist),
    ['Ulcerate', 'Blood Incantation', 'Sumac', 'Couch Slut'],
    'the suppressed release is absent from what the model was handed',
  )
})

test('a shortlist naming a suppressed release cannot be validated: it is not a candidate', async () => {
  const model = scriptedModel(proposes('fetch_source', '{"source_id": "loudwire"}'), finishes([item(2)]))
  const { outcome, stepRows } = await run(model.port, {
    alreadyInNotion: [{ artist: 'Chat Pile', title: 'Cool World' }],
  })

  // Suppression and provenance are the same guardrail from two directions:
  // only a source fetch adds candidates, and a suppressed release is not one.
  assert.equal(outcome.terminationReason, 'validation_failed')
  assert.match(String(finishRow(stepRows)?.['error']), /not among the candidates/)
})

test('re-running a week after a write proposes nothing twice', async () => {
  const script = () =>
    scriptedModel(proposes('fetch_source', '{"source_id": "loudwire"}'), ...looksUpThenFinishes(2)).port

  const first = await run(script())
  assert.equal(first.outcome.notionWritePerformed, true)

  // Read back out of the pages the write actually created, not out of the
  // finish step: what suppression reads next Friday is the cell, and a cell
  // written under a name suppression does not look for would suppress nothing.
  const plain = (property: Record<string, unknown> | undefined): string =>
    ((property?.['title'] ?? property?.['rich_text']) as { text: { content: string } }[])[0]?.text
      .content ?? ''

  const proposed = first.written.map((page) => ({
    artist: plain(page.properties['Artist']),
    title: plain(page.properties['Album']),
  }))
  assert.deepEqual(proposed.map((each) => each.artist), ['Ulcerate', 'Chat Pile'])

  const second = await run(
    scriptedModel(proposes('fetch_source', '{"source_id": "loudwire"}'), finishes([])).port,
    { alreadyInNotion: proposed },
  )

  const fetched = JSON.parse(String(second.stepRows[0]?.['tool_result']))
  assert.equal(fetched.alreadyProposed, proposed.length)
  assert.equal(
    fetched.candidates.filter((candidate: { artist: string }) =>
      proposed.some((each) => each.artist === candidate.artist),
    ).length,
    0,
  )
})

test('a suppression read that fails refuses the run, leaving no row behind', async () => {
  const store = openStore(':memory:')
  // The schema is described, so the preflight passes and the query is what fails.
  const refusing: HttpPort = {
    ...withNotion(fixtureHttp(), []).port,
    post: async () => ({ status: 401, attempts: 1, headers: {}, body: '{"message": "unauthorized"}' }),
  }

  await assert.rejects(
    () =>
      runRiffRadar({
        args: { command: 'run', lastDays: 7, dryRun: false, raw: 'run' },
        ports: { clock: tickingClock(), model: scriptedModel(finishes([])).port, http: refusing },
        store,
        profile,
        searchApiKey: 'test-key',
        notionToken: 'test-notion-token',
        notionDatabaseId: 'test-database',
      }),
    /Notion refused/,
  )

  assert.equal(store.database.prepare('SELECT count(*) AS n FROM runs').get()?.['n'], 0)
})

test('a dry run still reads Notion, because it still costs model tokens to run unsuppressed', async () => {
  const { stepRows } = await run(
    scriptedModel(proposes('fetch_source', '{"source_id": "loudwire"}'), finishes([])).port,
    { dryRun: true, alreadyInNotion: [{ artist: 'Chat Pile', title: 'Cool World' }] },
  )

  assert.equal(JSON.parse(String(stepRows[0]?.['tool_result'])).alreadyProposed, 1)
})

// ── Resume ───────────────────────────────────────────────────────────────────

/**
 * A run that was killed, written straight into a real database.
 *
 * Nothing in the loop can abort itself, and nothing was built to let a test
 * abort it: a resume's input is the trace, so a partial trace is a legitimate
 * input and this exercises the real path rather than a test-only hook. The
 * steps are real ones, taken from a run that happened, so the parent is a
 * genuine prefix of a genuine run rather than a plausible-looking fiction.
 */
const killedAfter = (store: Store, steps: readonly TracedStep[]): string => {
  const runId = 'killed-parent'
  store.startRun({
    runId,
    startedAt: '2026-09-14T09:00:00.000Z',
    cliArgs: 'run',
    resolvedFrom: '2026-09-08',
    resolvedTo: '2026-09-14',
    promptVersion: PROMPT_VERSION,
    profileVersion: profile.version,
    actionSchemaVersion: ACTION_SCHEMA_VERSION,
    modelId: MODEL_ID,
  })

  const empty: Omit<RecordedStep, 'stepId' | 'runId' | 'stepIndex' | 'kind'> = {
    timestamp: '2026-09-14T09:00:01.000Z',
    durationMs: 10,
    modelResponse: null,
    proposedAction: null,
    validationResult: null,
    dispatchedAction: null,
    toolName: null,
    toolArgs: null,
    toolResult: null,
    error: null,
    warning: null,
    failureCategory: null,
    candidatesAfter: null,
    uncachedInputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    cost: 0,
  }

  for (const [index, step] of steps.entries()) {
    store.recordStep({ ...empty, ...step, stepId: `killed-${index}`, runId, stepIndex: index })
  }

  return runId
}

/** The first `count` steps of a run that fetched, looked one release up and finished. */
const prefixOfARealRun = async (count: number): Promise<TracedStep[]> => {
  const { store, outcome } = await run(
    scriptedModel(proposes('fetch_source', '{"source_id": "loudwire"}'), ...looksUpThenFinishes(1))
      .port,
    { dryRun: true },
  )
  assert.equal(outcome.terminationReason, 'completed_short', 'the run to take a prefix of')
  return store.stepsOf(outcome.runId).slice(0, count)
}

// ADR-0046: the trace is the checkpoint, and this is the one column that makes
// it one. A step without it is a step a resume would have to guess at.
test('every recorded step carries the candidate list it left behind', async () => {
  const cases = [
    ['a run that finished', scriptedModel(proposes('fetch_source', '{"source_id": "loudwire"}'), ...looksUpThenFinishes(1))],
    ['a run that wrote to Notion', scriptedModel(proposes('fetch_source', '{"source_id": "loudwire"}'), ...looksUpThenFinishes(1))],
    ['a run of invalid actions', scriptedModel(proposes('web_search', '{"q": "wrong key"}'))],
  ] as const

  for (const [what, model] of cases) {
    const { stepRows } = await run(model.port, { dryRun: what !== 'a run that wrote to Notion' })
    assert.ok(stepRows.length > 0, what)
    for (const step of stepRows) {
      assert.notEqual(step['candidates_after'], null, `${what}: ${String(step['kind'])} step`)
    }
  }
})

test('a step the loop broke on still records what the run held', async () => {
  const model = scriptedModel(
    proposes('fetch_source', '{"source_id": "loudwire"}'),
    new Error('the provider hung up'),
  )
  const { outcome, stepRows } = await run(model.port, { dryRun: true })

  assert.equal(outcome.terminationReason, 'tool_failure')
  assert.equal(stepRows[1]?.['kind'], 'model_error')
  // The candidates the first step found are not lost with the step that broke.
  assert.match(String(stepRows[1]?.['candidates_after']), /Ulcerate/)
})

test('a resumed run is a new row linked to the parent, and the parent is closed aborted', async () => {
  const store = openStore(':memory:')
  const parent = killedAfter(store, await prefixOfARealRun(2))

  const { outcome, runRow, stepRows } = await run(scriptedModel(finishes(items(1))).port, {
    store,
    resumeRunId: parent,
    dryRun: true,
  })

  assert.notEqual(outcome.runId, parent, 'a resume is a new run, not an appendix')
  assert.equal(runRow?.['resumed_from'], parent)
  assert.equal(outcome.terminationReason, 'completed_short')

  // Exactly one termination reason per run still holds, and the parent's is the
  // one that says what happened to it.
  const parentRow = store.database.prepare('SELECT * FROM runs WHERE run_id = ?').get(parent)
  assert.equal(parentRow?.['termination_reason'], 'aborted')
  assert.notEqual(parentRow?.['ended_at'], null)

  // `step_index` is a position within a run, so the child's start at zero.
  assert.deepEqual(stepRows.map((step) => step['step_index']), [0])
})

test('a resumed run continues the parent conversation rather than starting one', async () => {
  const store = openStore(':memory:')
  const parent = killedAfter(store, await prefixOfARealRun(2))
  const model = scriptedModel(finishes(items(1)))

  await run(model.port, { store, resumeRunId: parent, dryRun: true })

  const [first] = model.requests
  const roles = (first?.messages ?? []).map((message) => message.role)
  assert.deepEqual(roles, ['system', 'user', 'assistant', 'tool', 'assistant', 'tool'])
  // The candidates the parent found are in the history as the tool said them.
  assert.match(String(first?.messages[3]?.content), /Ulcerate/)
})

test('a resumed run does not repeat the work the parent completed', async () => {
  const store = openStore(':memory:')
  const parent = killedAfter(store, await prefixOfARealRun(2))

  const fetched: string[] = []
  const watching: HttpPort = {
    ...fixtureHttp(),
    get: async (url, headers) => {
      if (!isMusicbrainz(url) && !url.startsWith(NOTION_ENDPOINT)) fetched.push(url)
      return fixtureHttp().get(url, headers)
    },
  }

  await run(scriptedModel(finishes(items(1))).port, {
    store,
    resumeRunId: parent,
    http: watching,
    dryRun: true,
  })

  assert.deepEqual(fetched, [], 'the parent already fetched its source')
})

// The parent was killed between a tool call and the step that records it, so
// that step is not in the trace at all. At-least-once is safe here: every tool
// in the loop is side-effect-free (ADR-0051).
test('a step interrupted before it was recorded is simply taken again', async () => {
  const store = openStore(':memory:')
  const parent = killedAfter(store, await prefixOfARealRun(1))
  const model = scriptedModel(
    proposes('lookup_release', '{"artist": "Ulcerate", "title": "Cutting the Throat of God"}'),
    finishes(items(1)),
  )

  const { outcome, stepRows } = await run(model.port, { store, resumeRunId: parent, dryRun: true })

  assert.equal(outcome.terminationReason, 'completed_short')
  assert.equal(stepRows[0]?.['tool_name'], 'lookup_release', 'the unrecorded lookup is taken again')
  // Nothing of the lost step reached the replayed conversation.
  assert.deepEqual((model.requests[0]?.messages ?? []).map((each) => each.role), [
    'system',
    'user',
    'assistant',
    'tool',
  ])
})

// The criterion this milestone's checkpointing rests on: everything but the
// candidate list is derived from what the trace already holds (ADR-0046).
test('what a resume is not told, it works out: usage, history and the invalid count', async () => {
  const store = openStore(':memory:')
  const steps = await prefixOfARealRun(2)
  const parent = killedAfter(store, steps)

  const spent = steps.reduce(
    (total, step) => total + step.uncachedInputTokens + step.cachedInputTokens + step.outputTokens,
    0,
  )
  assert.ok(spent > 0, 'the parent spent something to inherit')

  const { outcome } = await run(scriptedModel(finishes(items(1))).port, {
    store,
    resumeRunId: parent,
    dryRun: true,
  })

  const inherited =
    outcome.usage.uncachedInputTokens + outcome.usage.cachedInputTokens + outcome.usage.outputTokens
  assert.ok(inherited > spent, `${inherited} tokens includes the parent's ${spent}`)
})

test('a resume inherits the run of invalid actions the parent ended on', async () => {
  const store = openStore(':memory:')
  const twoBadSteps = [...(await prefixOfARealRun(1))]
  // Two invalid actions, written as the loop would have written them.
  const model = scriptedModel(proposes('web_search', '{"q": "wrong key"}'))
  const { store: refused, outcome: refusedRun } = await run(model.port, { dryRun: true })
  assert.equal(refusedRun.terminationReason, 'invalid_action_limit')
  twoBadSteps.push(...refused.stepsOf(refusedRun.runId).slice(0, 2))

  const parent = killedAfter(store, twoBadSteps)
  const { outcome, stepRows } = await run(scriptedModel(proposes('web_search', '{"q": "again"}')).port, {
    store,
    resumeRunId: parent,
    dryRun: true,
  })

  // One more invalid action is the third in a row, not the first.
  assert.equal(outcome.terminationReason, 'invalid_action_limit')
  assert.equal(stepRows.length, 1)
})

test('a resumed run covers the parent window, whatever the clock says', async () => {
  const store = openStore(':memory:')
  const parent = killedAfter(store, await prefixOfARealRun(2))

  const { outcome, runRow } = await run(scriptedModel(finishes(items(1))).port, {
    store,
    resumeRunId: parent,
    dryRun: true,
  })

  assert.deepEqual(outcome.window, { from: '2026-09-08', to: '2026-09-14' })
  assert.equal(runRow?.['resolved_from'], '2026-09-08')
  assert.equal(runRow?.['resolved_to'], '2026-09-14')
})

// Startup is the same path as a fresh run, which is what lets a half-written
// parent self-correct: the pages it already wrote are in Notion, so they are
// suppressed the second time round.
test('a resume reads the schema and the suppression set again', async () => {
  const store = openStore(':memory:')
  const parent = killedAfter(store, await prefixOfARealRun(2))

  const { stepRows } = await run(scriptedModel(finishes([])).port, {
    store,
    resumeRunId: parent,
    dryRun: true,
    alreadyInNotion: [{ artist: 'Ulcerate', title: 'Cutting the Throat of God' }],
  })

  assert.equal(stepRows.length, 1)
  const candidates = JSON.parse(String(stepRows[0]?.['candidates_after']))
  assert.equal(
    candidates.filter((each: { artist: string }) => each.artist === 'Ulcerate').length,
    0,
    'a release Notion already holds is dropped from the replayed list',
  )
})

test('a resume of a run that does not exist is refused, and writes nothing', async () => {
  const store = openStore(':memory:')

  await assert.rejects(
    () => run(scriptedModel(finishes([])).port, { store, resumeRunId: 'no-such-run', dryRun: true }),
    /no-such-run/,
  )
  assert.equal(store.database.prepare('SELECT count(*) AS n FROM runs').get()?.['n'], 0)
})

// Each run's row already holds its chain's accumulated spend, so a grandchild
// that replayed only its parent would lose the conversation and the cost of
// everything before it.
test('a resume of a resume inherits the whole chain, not just its parent', async () => {
  const store = openStore(':memory:')
  const grandparent = killedAfter(store, await prefixOfARealRun(1))

  // One lookup, then the provider hangs up: the middle of a chain, killed the
  // way the run it resumed was.
  const child = await run(
    scriptedModel(
      proposes('lookup_release', '{"artist": "Ulcerate", "title": "Cutting the Throat of God"}'),
      new Error('the provider hung up'),
    ).port,
    { store, resumeRunId: grandparent, dryRun: true },
  )
  assert.equal(child.outcome.terminationReason, 'tool_failure')

  // A killed run's row would have no reason at all; this one has to be reopened
  // because the loop got far enough to record why it stopped.
  store.database
    .prepare('UPDATE runs SET termination_reason = NULL, ended_at = NULL WHERE run_id = ?')
    .run(child.outcome.runId)

  const model = scriptedModel(finishes(items(1)))
  const grandchild = await run(model.port, { store, resumeRunId: child.outcome.runId, dryRun: true })

  assert.equal(grandchild.outcome.terminationReason, 'completed_short')
  // The grandparent's fetch and the child's lookup are both in the history.
  const roles = (model.requests[0]?.messages ?? []).map((message) => message.role)
  assert.deepEqual(roles, ['system', 'user', 'assistant', 'tool', 'assistant', 'tool'])
  assert.ok(
    grandchild.outcome.usage.outputTokens > child.outcome.usage.outputTokens,
    'the whole chain is paid for',
  )
})

// ADR-0047: two runs over the same window are both legitimate and are not the
// same operation. Nothing infers which was meant, so an unfinished run for the
// same dates changes nothing about a run started without the flag.
test('without the flag a run is new, even with an unfinished run over the same window', async () => {
  const store = openStore(':memory:')
  const killed = killedAfter(store, await prefixOfARealRun(2))
  const model = scriptedModel(proposes('fetch_source', '{"source_id": "loudwire"}'), finishes([]))

  const { outcome, runRow } = await run(model.port, { store, dryRun: true })

  assert.equal(runRow?.['resumed_from'], null, 'a run without --resume resumes nothing')
  assert.notEqual(outcome.runId, killed)
  // The other run is untouched: not continued, not closed, not commented on.
  const killedRow = store.database.prepare('SELECT * FROM runs WHERE run_id = ?').get(killed)
  assert.equal(killedRow?.['termination_reason'], null)
  assert.equal(killedRow?.['ended_at'], null)
  // And it started over: the first thing it did was fetch a source for itself.
  assert.deepEqual((model.requests[0]?.messages ?? []).map((each) => each.role), ['system', 'user'])
})

test('a resume is refused by the schema preflight, exactly as a fresh run is', async () => {
  const store = openStore(':memory:')
  const parent = killedAfter(store, await prefixOfARealRun(2))

  await assert.rejects(
    () =>
      run(scriptedModel(finishes([])).port, {
        store,
        resumeRunId: parent,
        dryRun: true,
        notionSchema: JSON.stringify({ properties: { Album: { type: 'title' } } }),
      }),
    /Notion database/,
  )

  // Refused before the run row, so the parent is still there to be resumed once
  // the database is put right.
  const parentRow = store.database.prepare('SELECT * FROM runs WHERE run_id = ?').get(parent)
  assert.equal(parentRow?.['termination_reason'], null)
  assert.equal(store.database.prepare('SELECT count(*) AS n FROM runs').get()?.['n'], 1)
})
