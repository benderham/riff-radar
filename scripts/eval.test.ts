import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { SOURCES } from '../config.ts'
import { lookupRelease } from '../src/clients/musicbrainz.ts'
import { splitIdentity } from '../src/domain/candidates.ts'
import { isEligible } from '../src/domain/eligibility.ts'
import { tasteProfileSchema } from '../src/domain/taste-profile.ts'
import { resolveWindow } from '../src/domain/window.ts'
import type { Ports } from '../src/ports.ts'
import type { EvalCase } from '../src/domain/eval.ts'
import { readCase, recordedHttp } from './eval.ts'

/**
 * The two ports a lookup uses, over a case's own recordings. The model is here
 * only because `Ports` carries three: nothing offline may reach it, so it says
 * so rather than being cast away.
 */
const portsFor = (evalCase: EvalCase): Ports => ({
  http: recordedHttp(evalCase),
  clock: { now: () => new Date(evalCase.now), sleep: async () => {} },
  model: {
    complete: () => Promise.reject(new Error('no model in an offline test')),
  },
})

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

test('a sequence answers in order and then repeats its last entry', async () => {
  // The only way a recording says "failed, and then answered": a stateless one
  // can record an outage but never a recovery (ADR-0067).
  const port = recordedHttp(
    evalCase({
      responses: {
        'https://musicbrainz.org/ws/2/release-group?query=': [
          { status: 503, headers: { 'retry-after': '1' } },
          'musicbrainz-release-group.json',
        ],
      },
    }),
  )

  const url = 'https://musicbrainz.org/ws/2/release-group?query=Ulcerate'
  const first = await port.get(url)
  const second = await port.get(url)
  const third = await port.get(url)

  assert.equal(first.status, 503)
  assert.equal(second.status, 200)
  assert.equal(third.status, 200, 'the last entry repeats rather than running out')
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

  assert.equal(cases.length, 21, `${cases.length} cases, expected the twenty and the smoke case`)

  for (const slug of cases) {
    const parsed = readCase(slug)
    assert.equal(parsed.slug, slug)

    const named = [
      ...Object.values(parsed.sources),
      ...Object.values(parsed.responses)
        .flatMap((body) => (Array.isArray(body) ? body : [body]))
        .map((body) => (typeof body === 'string' ? body : body.file)),
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

// ── The mutated eight, checked against the rule their labels claim ───────────
// A label is a fact about a release, and for these cases the fact is one
// MusicBrainz settles: `isEligible` over the lookup the case itself records.
// Writing the cases and grading them are the same hand (spec.md's stated
// conflict), so the containment is that no label here is an opinion — every one
// of them is re-derived from the recorded bytes by the same function the run
// uses, and a label that disagrees with the rule fails this test.
//
// Only the labels MusicBrainz decides can be checked this way. Where a case
// records no lookup — `04-degraded`, and the two unheard-of releases in
// `08-unverified` — eligibility turns on the format the model extracts from the
// page, which no offline test has, and the live replay is what proves those.

test('every mutated label MusicBrainz settles agrees with isEligible', async () => {
  const mutated = readdirSync(new URL('../fixtures/eval/', import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^0[1-8]-/.test(entry.name))
    .map((entry) => readCase(entry.name))

  assert.equal(mutated.length, 8, 'the eight mutated cases')

  const profile = tasteProfileSchema.parse(
    JSON.parse(readFileSync(new URL('../taste-profile.json', import.meta.url), 'utf8')),
  )
  let checked = 0

  for (const each of mutated) {
    const ports = portsFor(each)
    // The case's own instant, not a constant beside it: a case pinned to another
    // week would otherwise be graded against this one's window.
    const window = resolveWindow(new Date(each.now), 7)

    for (const [labelled, expected] of [
      ...each.labels.eligible.map((one) => [one, true] as const),
      ...each.labels.ineligible.map((one) => [one, false] as const),
    ]) {
      const { artist, title } = splitIdentity(labelled)
      // Not caught: a label naming a release the case records nothing for is a
      // broken case, and it throws here for the same reason a pass throws.
      const looked = await lookupRelease(ports, artist, title)
      // Found nothing is the degraded and unverified half, proved live instead.
      if (looked.lookup.found === false) continue

      const verdict = isEligible(
        { artist, title, releaseDates: [], sourceUrls: [], lookup: looked.lookup },
        window,
        profile,
      )

      checked += 1
      assert.equal(
        verdict.eligible,
        expected,
        `${each.slug}: ${labelled} is labelled ${expected ? 'eligible' : 'ineligible'}, and the ` +
          `rule says ${verdict.eligible ? 'eligible' : `ineligible — ${verdict.reason}`}`,
      )
    }
  }

  // Exact rather than a floor: a case that stops recording a lookup fails here
  // instead of quietly checking less. `03` and `04` settle none — both are
  // about MusicBrainz saying nothing — and `05` spends its first ask on its 503.
  assert.equal(checked, 11, `${checked} labels checked`)
})

test('the EP thresholds are crossed in both directions, by four recorded EPs', async () => {
  // Four tracks and twenty minutes have never fired outside a unit test in any
  // run ever made (spec.md, carried-forward item 4). These are the bytes that
  // make them fire: one EP short on tracks, one short on minutes, and one clear
  // of each.
  const boundary = readCase('06-ep-boundary')
  const ports = portsFor(boundary)

  const measured = await Promise.all(
    [...boundary.labels.ineligible, ...boundary.labels.eligible].map(async (labelled) => {
      const { artist, title } = splitIdentity(labelled)
      const { lookup } = await lookupRelease(ports, artist, title)
      assert.ok(lookup.found && lookup.primaryType === 'EP', `${labelled} is not a recorded EP`)
      return [lookup.trackCount, Math.round((lookup.durationMs ?? 0) / 60_000)]
    }),
  )

  // Labels first, so the order is the case's: the two it refuses, then the two
  // it allows. Three tracks and four-at-eighteen are below; four-at-twenty-one
  // and six-at-forty-five are above.
  assert.deepEqual(measured, [
    [3, 25],
    [4, 18],
    [4, 21],
    [6, 45],
  ])
})

test('05-recovers fails a lookup once and finds the release on the ask after', async () => {
  // The case's point, checked without the model: the first ask is a transient
  // failure, the second is the release. A run that retried is not a run that
  // let a failure escape, which is the distinction `escaped` rests on.
  const recovers = readCase('05-recovers')
  const ports = portsFor(recovers)

  const first = await lookupRelease(ports, 'Ember Wake', 'Tidal Flats')
  const second = await lookupRelease(ports, 'Ember Wake', 'Tidal Flats')

  assert.equal(first.lookup.found, false)
  assert.equal(first.failureCategory, 'transient')
  assert.ok(second.lookup.found, 'the second ask is answered')
})
