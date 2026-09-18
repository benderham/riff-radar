import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { Candidate } from './candidates.ts'
import type { Defect, GradedRun } from './eval.ts'
import {
  DEFECTS,
  escaped,
  gradeRun,
  misranked,
  missed,
  spurious,
  ungrounded,
  unlisted,
  wasteful,
} from './eval.ts'
import type { ShortlistItem } from './shortlist.ts'
import type { TasteProfile } from './taste-profile.ts'

// ── The smallest run records that carry each rule ─────────────────────────────

const NO_OPINIONS: TasteProfile = {
  version: 1,
  artists: { always: [], watch: [], exclude: [] },
  labels: { include: [], exclude: [] },
  genres: { include: [], exclude: [] },
  personnel: { include: [], exclude: [] },
  vibe_notes: { include: [], exclude: [] },
}

const CALENDAR = 'https://loudwire.test/calendar'

const candidate = (artist: string, title: string, over: Partial<Candidate> = {}): Candidate => ({
  artist,
  title,
  releaseDates: ['2026-09-12'],
  sourceUrls: [CALENDAR],
  ...over,
})

const item = (artist: string, title: string, over: Partial<ShortlistItem> = {}): ShortlistItem => ({
  artist,
  title,
  releaseDate: '2026-09-12',
  sourceUrls: [CALENDAR],
  rationale: 'because',
  rank: 1,
  unverified: true,
  ...over,
})

/** A page that lists whatever it is given, so `unlisted` has something to find. */
const page = (...releases: readonly string[]) => [
  { url: CALENDAR, rawBody: `<ul>${releases.map((each) => `<li>${each}</li>`).join('')}</ul>` },
]

const run = (over: Partial<GradedRun> = {}): GradedRun => ({
  shortlist: [],
  candidates: [],
  window: { from: '2026-09-07', to: '2026-09-13' },
  profile: NO_OPINIONS,
  sourceTexts: [],
  steps: [],
  terminationReason: 'completed',
  cost: 0.01,
  labels: { eligible: [], ineligible: [] },
  budget: { steps: 20, costUsd: 0.02 },
  ...over,
})

const step = (over: Partial<GradedRun['steps'][number]> = {}): GradedRun['steps'][number] => ({
  kind: 'action',
  modelResponse: null,
  toolResult: null,
  toolName: 'lookup_release',
  failureCategory: null,
  error: null,
  candidatesAfter: null,
  uncachedInputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  ...over,
})

const defectsOf = (findings: readonly { readonly defect: Defect }[]): Defect[] =>
  findings.map((finding) => finding.defect)

// ── The union is closed ──────────────────────────────────────────────────────

test('the seven defects are a closed union', () => {
  assert.equal(new Set(DEFECTS).size, 7)
  // @ts-expect-error an eighth value is not a Defect
  const eighth: Defect = 'slow'
  assert.ok(!DEFECTS.includes(eighth))
})

// ── unlisted ─────────────────────────────────────────────────────────────────

test('unlisted fires for a labelled release no source carried', () => {
  const graded = run({
    labels: { eligible: ['Ulcerate|Cutting the Throat of God'], ineligible: [] },
    sourceTexts: page('Wormrot — Hiss'),
  })

  assert.deepEqual(defectsOf(unlisted(graded)), ['unlisted'])
})

test('unlisted stays quiet when the source listed the release', () => {
  const graded = run({
    labels: { eligible: ['Ulcerate|Cutting the Throat of God'], ineligible: [] },
    sourceTexts: page('Ulcerate  —  Cutting The Throat of God (12 September)'),
  })

  assert.deepEqual(unlisted(graded), [])
})

test('unlisted needs the artist and the title on the same page', () => {
  const graded = run({
    labels: { eligible: ['Ulcerate|Cutting the Throat of God'], ineligible: [] },
    sourceTexts: [
      { url: CALENDAR, rawBody: '<li>Ulcerate — Stare Into Death and Be Still</li>' },
      { url: 'https://other.test', rawBody: '<li>Wormrot — Cutting the Throat of God</li>' },
    ],
  })

  assert.deepEqual(defectsOf(unlisted(graded)), ['unlisted'])
})

test('unlisted needs the artist and the title on the same listing row', () => {
  // The halves are both on the page, in different rows, which is what a
  // whole-page search cannot tell from a release the calendar actually carried.
  const graded = run({
    labels: { eligible: ['Ulcerate|Cutting the Throat of God'], ineligible: [] },
    sourceTexts: page('Ulcerate — Stare Into Death and Be Still', 'Wormrot — Cutting the Throat of God'),
  })

  assert.deepEqual(defectsOf(unlisted(graded)), ['unlisted'])
})

// ── missed ───────────────────────────────────────────────────────────────────

test('missed fires for an eligible release left off the shortlist', () => {
  const graded = run({
    labels: { eligible: ['Ulcerate|Cutting the Throat of God'], ineligible: [] },
    shortlist: [item('Wormrot', 'Hiss')],
  })

  assert.deepEqual(defectsOf(missed(graded)), ['missed'])
})

test('missed stays quiet when the eligible release is on the shortlist', () => {
  const graded = run({
    labels: { eligible: ['ulcerate|cutting the throat of god'], ineligible: [] },
    shortlist: [item('Ulcerate', 'Cutting the Throat of God')],
  })

  assert.deepEqual(missed(graded), [])
})

test('unlisted suppresses missed for the same release', () => {
  const graded = run({
    labels: { eligible: ['Ulcerate|Cutting the Throat of God'], ineligible: [] },
    sourceTexts: page('Wormrot — Hiss'),
  })

  assert.deepEqual(defectsOf(gradeRun(graded)), ['unlisted'])
})

test('unlisted does not suppress missed for a different release', () => {
  const graded = run({
    labels: {
      eligible: ['Ulcerate|Cutting the Throat of God', 'Wormrot|Hiss'],
      ineligible: [],
    },
    sourceTexts: page('Wormrot — Hiss'),
  })

  assert.deepEqual(defectsOf(gradeRun(graded)), ['unlisted', 'missed'])
})

// ── spurious ─────────────────────────────────────────────────────────────────

test('spurious fires for a shortlisted release the case labels ineligible', () => {
  const graded = run({
    labels: { eligible: [], ineligible: ['Ulcerate|Cutting the Throat of God'] },
    shortlist: [item('Ulcerate', 'Cutting the Throat of God')],
  })

  assert.deepEqual(defectsOf(spurious(graded)), ['spurious'])
})

test('spurious fires for a release dated outside the window', () => {
  const graded = run({ shortlist: [item('Wormrot', 'Hiss', { releaseDate: '2026-08-01' })] })

  assert.deepEqual(defectsOf(spurious(graded)), ['spurious'])
})

test('an unlabelled shortlist item is no opinion rather than spurious', () => {
  const graded = run({ shortlist: [item('Wormrot', 'Hiss')] })

  assert.deepEqual(spurious(graded), [])
})

// ── ungrounded ───────────────────────────────────────────────────────────────

test('ungrounded fires for a vibe note whose quote is in no stored page', () => {
  const graded = run({
    shortlist: [item('Wormrot', 'Hiss', { vibe: { claim: 'like Nails', quote: 'a wall of noise' } })],
    sourceTexts: page('Wormrot — Hiss, thirty minutes of grind'),
  })

  assert.deepEqual(defectsOf(ungrounded(graded)), ['ungrounded'])
})

test('ungrounded stays quiet for a quote the stored page carries', () => {
  const graded = run({
    shortlist: [item('Wormrot', 'Hiss', { vibe: { claim: 'grind', quote: 'thirty minutes of grind' } })],
    sourceTexts: page('Wormrot — Hiss, thirty minutes of grind'),
  })

  assert.deepEqual(ungrounded(graded), [])
})

test('ungrounded fires for a shortlist item with no source URL', () => {
  const graded = run({ shortlist: [item('Wormrot', 'Hiss', { sourceUrls: [] })] })

  assert.deepEqual(defectsOf(ungrounded(graded)), ['ungrounded'])
})

// ── misranked ────────────────────────────────────────────────────────────────

const watched = (artist: string): TasteProfile => ({
  ...NO_OPINIONS,
  artists: { always: [], watch: [artist], exclude: [] },
})

test('misranked fires when a higher-scoring release is ranked below', () => {
  const graded = run({
    profile: watched('Wormrot'),
    candidates: [candidate('Ulcerate', 'Cutting the Throat of God'), candidate('Wormrot', 'Hiss')],
    shortlist: [
      item('Ulcerate', 'Cutting the Throat of God', { rank: 1 }),
      item('Wormrot', 'Hiss', { rank: 2 }),
    ],
  })

  assert.deepEqual(defectsOf(misranked(graded)), ['misranked'])
})

test('misranked stays quiet on the order the profile produces', () => {
  const graded = run({
    profile: watched('Wormrot'),
    candidates: [candidate('Ulcerate', 'Cutting the Throat of God'), candidate('Wormrot', 'Hiss')],
    shortlist: [
      item('Wormrot', 'Hiss', { rank: 1 }),
      item('Ulcerate', 'Cutting the Throat of God', { rank: 2 }),
    ],
  })

  assert.deepEqual(misranked(graded), [])
})

test('misranked stays quiet on two releases that score the same', () => {
  const graded = run({
    candidates: [candidate('Ulcerate', 'Cutting the Throat of God'), candidate('Wormrot', 'Hiss')],
    shortlist: [
      item('Ulcerate', 'Cutting the Throat of God', { rank: 1 }),
      item('Wormrot', 'Hiss', { rank: 2 }),
    ],
  })

  assert.deepEqual(misranked(graded), [])
})

test('a guaranteed slot above a higher-scoring release is not misranked', () => {
  const graded = run({
    profile: {
      ...NO_OPINIONS,
      artists: { always: ['Ulcerate'], watch: ['Wormrot'], exclude: [] },
    },
    candidates: [candidate('Ulcerate', 'Cutting the Throat of God'), candidate('Wormrot', 'Hiss')],
    shortlist: [
      item('Ulcerate', 'Cutting the Throat of God', { rank: 1 }),
      item('Wormrot', 'Hiss', { rank: 2 }),
    ],
  })

  assert.deepEqual(misranked(graded), [])
})

// ── wasteful ─────────────────────────────────────────────────────────────────

test('wasteful fires for a completed run over its step budget', () => {
  const graded = run({ steps: Array.from({ length: 21 }, () => step()), budget: { steps: 20, costUsd: 1 } })

  assert.deepEqual(defectsOf(wasteful(graded)), ['wasteful'])
})

test('wasteful fires for a completed run over its cost budget', () => {
  const graded = run({ cost: 0.05, budget: { steps: 20, costUsd: 0.02 } })

  assert.deepEqual(defectsOf(wasteful(graded)), ['wasteful'])
})

test('a run inside both budgets is not wasteful', () => {
  const graded = run({ steps: [step(), step()], cost: 0.01 })

  assert.deepEqual(wasteful(graded), [])
})

test('a run stopped at the step ceiling is not also wasteful', () => {
  const graded = run({
    terminationReason: 'max_steps_exceeded',
    steps: Array.from({ length: 30 }, () => step()),
    budget: { steps: 20, costUsd: 1 },
  })

  assert.deepEqual(wasteful(graded), [])
})

// ── escaped ──────────────────────────────────────────────────────────────────

test('escaped fires when a retryable failure ended the run', () => {
  const graded = run({
    terminationReason: 'tool_failure',
    steps: [step(), step({ failureCategory: 'transient', error: 'socket hang up' })],
  })

  assert.deepEqual(defectsOf(escaped(graded)), ['escaped'])
})

test('a refusal that ended the run has no recovery to escape', () => {
  const graded = run({
    terminationReason: 'tool_failure',
    steps: [step({ failureCategory: 'refused', error: '401' })],
  })

  assert.deepEqual(escaped(graded), [])
})

test('escaped reports the run once, not each retryable step it recorded', () => {
  const graded = run({
    terminationReason: 'tool_failure',
    steps: [
      step({ failureCategory: 'transient', error: 'socket hang up' }),
      step({ failureCategory: 'transient', error: 'socket hang up' }),
      step({ failureCategory: 'transient', error: 'socket hang up' }),
    ],
  })

  assert.deepEqual(defectsOf(escaped(graded)), ['escaped'])
})

test('transient failures the run recovered from before a refusal killed it have not escaped', () => {
  const graded = run({
    terminationReason: 'tool_failure',
    steps: [
      step({ failureCategory: 'transient', error: 'socket hang up' }),
      step({ toolName: 'propose_shortlist', failureCategory: 'refused', error: '401' }),
    ],
  })

  assert.deepEqual(escaped(graded), [])
})

test('a retryable failure the run survived has not escaped', () => {
  const graded = run({
    terminationReason: 'completed',
    steps: [step({ failureCategory: 'transient', error: 'socket hang up' }), step()],
  })

  assert.deepEqual(escaped(graded), [])
})

// ── The whole grading ────────────────────────────────────────────────────────

test('a clean run has no defects', () => {
  const graded = run({
    labels: { eligible: ['Wormrot|Hiss'], ineligible: [] },
    candidates: [candidate('Wormrot', 'Hiss')],
    shortlist: [item('Wormrot', 'Hiss')],
    sourceTexts: page('Wormrot — Hiss'),
    steps: [step(), step()],
  })

  assert.deepEqual(gradeRun(graded), [])
})
