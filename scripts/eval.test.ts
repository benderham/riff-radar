import { existsSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { SOURCES } from '../config.ts'
import type { EvalCase } from '../src/domain/eval.ts'
import { readCase, recordedHttp } from './eval.ts'

const evalCase = (over: Partial<EvalCase> = {}): EvalCase => ({
  slug: 'test-case',
  args: ['run', '--last-days=7'],
  now: '2026-01-16T09:00:00+11:00',
  sources: { loudwire: 'loudwire.html' },
  labels: { eligible: [], ineligible: [] },
  budget: { steps: 20, costUsd: 0.02 },
  responses: { 'https://musicbrainz.org/ws/2/release-group?query=': 'musicbrainz-not-found.json' },
  ...over,
})

test('a source the case carries is served from the fixture it names', async () => {
  const response = await recordedHttp(evalCase()).get(SOURCES.loudwire)

  assert.equal(response.status, 200)
  assert.match(response.body, /2026 Hard Rock/i)
})

test('a configured source the case does not carry answers 404, not a throw', async () => {
  // A missing source is a degraded run, which is a thing the loop knows how to
  // be (ADR-0030). It is not a broken case.
  const response = await recordedHttp(evalCase()).get(SOURCES.wikipedia)

  assert.equal(response.status, 404)
})

test('the longest matching prefix wins, so a broad recording is a fallback', async () => {
  const port = recordedHttp(
    evalCase({
      responses: {
        'https://musicbrainz.org/ws/2/release-group?query=': 'musicbrainz-not-found.json',
        'https://musicbrainz.org/ws/2/release-group?query=Edenbridge':
          'notion-schema.json',
      },
    }),
  )

  const specific = await port.get('https://musicbrainz.org/ws/2/release-group?query=Edenbridge%20Set')
  const fallback = await port.get('https://musicbrainz.org/ws/2/release-group?query=Evoken')

  assert.match(specific.body, /"object": "database"/)
  assert.match(fallback.body, /"count"/)
})

test('a URL nobody recorded throws, naming the case and the URL', async () => {
  await assert.rejects(
    () => recordedHttp(evalCase()).get('https://api.notion.com/v1/databases/eval-database'),
    /test-case: no recorded response for https:\/\/api\.notion\.com/,
  )
})

test('the committed smoke case reads back under its own slug', () => {
  const smoke = readCase('00-smoke')

  assert.equal(smoke.slug, '00-smoke')
  assert.deepEqual(smoke.sources, { loudwire: 'loudwire.html' })
})

test('a recorded status is answered as recorded, body and all', async () => {
  // The format has to be able to record a failure, or no case can exercise the
  // two Defects that are about failure.
  const port = recordedHttp(
    evalCase({
      responses: {
        'https://musicbrainz.org/ws/2': { status: 503, headers: { 'retry-after': '30' } },
      },
    }),
  )

  const response = await port.get('https://musicbrainz.org/ws/2/release-group?query=Evoken')

  assert.equal(response.status, 503)
  assert.equal(response.body, '')
  assert.equal(response.headers['retry-after'], '30')
})

test('a case naming a file that is not there says so, with the case and the path', async () => {
  await assert.rejects(
    () => recordedHttp(evalCase({ sources: { loudwire: 'nowhere.html' } })).get(SOURCES.loudwire),
    /test-case: fixtures\/nowhere\.html is named by case\.json and is not there/,
  )
})

test('a recording matches whatever the capitalisation, because the query travels in the URL', async () => {
  const port = recordedHttp(
    evalCase({
      responses: {
        'https://musicbrainz.org/ws/2/release-group?query=soen%20reliance': 'musicbrainz-release-group.json',
      },
    }),
  )

  const asked = await port.get('https://musicbrainz.org/ws/2/release-group?query=Soen%20Reliance')

  assert.match(asked.body, /"release-groups"/)
})

// ── Every committed case, checked without the model ──────────────────────────
// A pass costs money and twenty minutes, so the failures a pass should never be
// the first to find — a manifest that stopped parsing, a recording whose file
// moved — are found here instead.

test('every committed case parses, and names files that exist', () => {
  const cases = readdirSync(new URL('../fixtures/eval/', import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  assert.ok(cases.length >= 12, `${cases.length} cases, expected the twelve and the smoke case`)

  for (const slug of cases) {
    const parsed = readCase(slug)
    assert.equal(parsed.slug, slug)

    const named = [
      ...Object.values(parsed.sources),
      ...Object.values(parsed.responses).map((body) => (typeof body === 'string' ? body : body.file)),
    ].filter((file): file is string => file !== undefined)

    for (const file of named) {
      assert.ok(
        existsSync(new URL(`../fixtures/${file}`, import.meta.url)),
        `${slug} names fixtures/${file}, which is not there`,
      )
    }
  }
})

test('the harvested twelve label their weeks eligible and nothing ineligible', () => {
  const harvested = readdirSync(new URL('../fixtures/eval/', import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('2026-'))
    .map((entry) => readCase(entry.name))

  assert.equal(harvested.length, 12)

  for (const each of harvested) {
    assert.ok(each.labels.eligible.length > 0, `${each.slug} labels nothing eligible`)
    // Eligibility only, and derived: the twelve carry no hand-written
    // ineligible list, which is ticket 06's eight mutated cases (ADR-0060).
    assert.deepEqual(each.labels.ineligible, [])
  }
})
