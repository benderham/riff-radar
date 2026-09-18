import { test } from 'node:test'
import assert from 'node:assert/strict'

import { SOURCES } from '../config.ts'
import type { EvalCase } from '../src/domain/eval.ts'
import { readCase, recordedHttp } from './eval.ts'

const evalCase = (over: Partial<EvalCase> = {}): EvalCase => ({
  slug: 'test-case',
  args: ['run', '--last-days=7'],
  now: '2026-01-16T09:00:00+11:00',
  sources: { loudwire: 'eval/00-smoke/responses/notion-schema.json' },
  labels: { eligible: [], ineligible: [] },
  budget: { steps: 20, costUsd: 0.02 },
  responses: {
    'https://musicbrainz.org/ws/2/release-group?query=':
      'eval/00-smoke/responses/musicbrainz-not-found.json',
  },
  ...over,
})

test('a source the case carries is served from the fixture it names', async () => {
  const response = await recordedHttp(evalCase()).get(SOURCES.loudwire)

  assert.equal(response.status, 200)
  assert.match(response.body, /"object": "database"/)
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
        'https://musicbrainz.org/ws/2/release-group?query=':
          'eval/00-smoke/responses/musicbrainz-not-found.json',
        'https://musicbrainz.org/ws/2/release-group?query=Edenbridge':
          'eval/00-smoke/responses/notion-schema.json',
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
