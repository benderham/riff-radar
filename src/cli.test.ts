import { test } from 'node:test'
import assert from 'node:assert/strict'

import { runCli } from './cli.ts'
import type { ClockPort, HttpPort, ModelPort } from './ports.ts'
import { openStore } from './store/store.ts'

const clock: ClockPort = { now: () => new Date(2026, 8, 14, 9, 0, 0) }

/** Finishes immediately with nothing: the CLI's job is wiring, not choosing. */
const model: ModelPort = {
  complete: async () => ({
    content: '',
    toolCalls: [{ id: 'call-1', name: 'finish', argumentsJson: '{"shortlist": []}' }],
    usage: { uncachedInputTokens: 120, cachedInputTokens: 30, outputTokens: 12 },
    cacheReported: true,
    raw: {},
  }),
}

/** The CLI test never reaches a source: its model finishes on the first step. */
const http: HttpPort = {
  get: async (url) => {
    throw new Error(`unexpected fetch of ${url}`)
  },
}

const env = {
  FIREWORKS_API_KEY: 'fw-key',
  BRAVE_API_KEY: 'brave-key',
  NOTION_TOKEN: 'ntn-token',
  NOTION_DATABASE_ID: 'db-id',
}

const harness = () => {
  const lines: string[] = []
  let store: ReturnType<typeof openStore> | undefined
  let storesOpened = 0
  return {
    lines,
    get store() {
      return store
    },
    get storesOpened() {
      return storesOpened
    },
    deps: {
      ports: { clock, model, http },
      openStore: () => {
        storesOpened += 1
        const opened = openStore(':memory:')
        store = opened
        // The CLI closes what it opens; the test keeps the handle alive so the
        // run can be read back afterwards, exactly as a SQL client would.
        return { ...opened, close: () => {} }
      },
      log: (line: string) => lines.push(line),
    },
  }
}

test('a bare run succeeds and reports its window and reason', async () => {
  const h = harness()
  const code = await runCli({ argv: ['run'], env, ...h.deps })

  assert.equal(code, 0)
  assert.equal(h.store?.database.prepare('SELECT count(*) AS n FROM runs').get()?.['n'], 1)
  assert.match(h.lines.join('\n'), /2026-09-08.+2026-09-14/s)
  assert.match(h.lines.join('\n'), /no_candidates/)
  assert.match(h.lines.join('\n'), /120 uncached \+ 30 cached input, 12 output tokens/)
})

test('missing credentials refuse the run and write nothing at all', async () => {
  const h = harness()
  const code = await runCli({ argv: ['run'], env: { FIREWORKS_API_KEY: 'fw-key' }, ...h.deps })

  assert.equal(code, 2)
  assert.equal(h.storesOpened, 0, 'the database must not even be opened')
  assert.equal(h.store, undefined)
  assert.match(h.lines.join('\n'), /NOTION_TOKEN/)
  assert.match(h.lines.join('\n'), /NOTION_DATABASE_ID/)
})

test('the refusal never prints a credential value', async () => {
  const h = harness()
  await runCli({ argv: ['run'], env: { ...env, NOTION_TOKEN: '' }, ...h.deps })
  assert.doesNotMatch(h.lines.join('\n'), /fw-key|db-id/)
})

test('a usage error refuses the run and writes nothing', async () => {
  const h = harness()
  const code = await runCli({ argv: ['run', '--last-days', 'seven'], env, ...h.deps })

  assert.equal(code, 2)
  assert.equal(h.storesOpened, 0)
  assert.match(h.lines.join('\n'), /--last-days/)
})

test('an unknown command prints usage', async () => {
  const h = harness()
  assert.equal(await runCli({ argv: ['fly'], env, ...h.deps }), 2)
  assert.match(h.lines.join('\n'), /usage: riff-radar run/)
})

test('a dry run is reported as one', async () => {
  const h = harness()
  assert.equal(await runCli({ argv: ['run', '--dry-run'], env, ...h.deps }), 0)
  assert.match(h.lines.join('\n'), /dry run/i)
})

test('a malformed taste profile refuses the run and writes nothing', async () => {
  const h = harness()
  const code = await runCli({
    argv: ['run'],
    env,
    ...h.deps,
    readTasteProfile: () => ({ version: 'one' }),
  })

  assert.equal(code, 2)
  assert.equal(h.storesOpened, 0)
  assert.match(h.lines.join('\n'), /taste-profile\.json/)
})

test('an unusable command line is reported before missing credentials', async () => {
  // Both are wrong here. Parsing costs nothing and its message is the more
  // specific of the two, so it is the one that surfaces.
  const h = harness()
  const code = await runCli({ argv: ['run', '--last-days', '0'], env: {}, ...h.deps })

  assert.equal(code, 2)
  assert.match(h.lines.join('\n'), /--last-days/)
  assert.doesNotMatch(h.lines.join('\n'), /FIREWORKS_API_KEY/)
})
