/**
 * A pass over the Golden Cases: `npm run eval [--case <slug>] [--out <path>]`.
 *
 * Invoked by hand, like the six smoke scripts, because the model is live: the
 * evaluation measures the half of the system that is a model, so a pass cannot
 * live in `npm test` (ADR-0064). Everything else is frozen — the sources are
 * committed bytes, the provider answers are recorded, the clock is fixed, the
 * store is in memory — so a difference between two passes is the change that
 * was made and not a website that moved (ADR-0058).
 *
 * `runRiffRadar` is called unchanged. There is no evaluation-only branch
 * anywhere in `src/`, and if the loop ever needs to know it is being evaluated
 * the design is wrong. The seam this leans on is the same one the loop's own
 * test file has used since milestone 1: fake `http`, fake clock, real store.
 *
 * This file is wiring. The schema, the graders and the arithmetic are pure and
 * live in `src/domain/eval.ts`, where the suite tests them.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { z } from 'zod'

import { SOURCES, TASTE_PROFILE_PATH } from '../config.ts'
import type { SourceId } from '../config.ts'
import { fireworksModel } from '../src/adapters/fireworks.ts'
import { runRiffRadar } from '../src/agents/riff-radar.ts'
import { parseCliArgs } from '../src/domain/cli-args.ts'
import type { CaseResult, EvalCase } from '../src/domain/eval.ts'
import { aggregate, caseSchema, gradeRun } from '../src/domain/eval.ts'
import { tasteProfileSchema } from '../src/domain/taste-profile.ts'
import type { HttpPort, HttpResponse } from '../src/ports.ts'
import { openStore } from '../src/store/store.ts'

const FIXTURES = new URL('../fixtures/', import.meta.url)
const CASES = new URL('eval/', FIXTURES)

/** Fake, and fixed: a case asks about a week in the past and must keep asking about it. */
const NOTION_DATABASE_ID = 'eval-database'

const fixture = (relativePath: string): string =>
  readFileSync(new URL(relativePath, FIXTURES), 'utf8')

/**
 * A recorded answer, or a loud failure.
 *
 * The longest matching prefix wins, which is what lets a case answer every
 * MusicBrainz query with one not-found body and a harvested case override it
 * per release with a longer key. A URL matching nothing throws rather than
 * 404ing, because a graded Defect has to be about the agent and not about a
 * recording nobody made.
 *
 * The one deliberate exception is a configured source the case does not carry:
 * it answers 404, and the run degrades with a warning the way it would against
 * a source that was down (ADR-0030).
 */
export const recordedHttp = (evalCase: EvalCase): HttpPort => {
  const answers = Object.entries(evalCase.responses).sort(
    ([one], [other]) => other.length - one.length,
  )

  const sourceUrls = new Map<string, string>(
    Object.entries(evalCase.sources).map(([id, file]) => [SOURCES[id as SourceId], file]),
  )

  const configured: readonly string[] = Object.values(SOURCES)

  const answer = (url: string): HttpResponse => {
    const source = sourceUrls.get(url)
    if (source !== undefined) {
      return { status: 200, attempts: 1, headers: { 'content-type': 'text/html' }, body: fixture(source) }
    }

    if (configured.includes(url)) {
      return {
        status: 404,
        attempts: 1,
        headers: {},
        body: `this case does not carry ${url}`,
      }
    }

    const recorded = answers.find(([prefix]) => url.startsWith(prefix))
    if (recorded === undefined) {
      throw new Error(
        `${evalCase.slug}: no recorded response for ${url}. Record one, or widen a prefix in case.json.`,
      )
    }

    return {
      status: 200,
      attempts: 1,
      headers: { 'content-type': 'application/json' },
      body: fixture(recorded[1]),
    }
  }

  return {
    get: async (url) => answer(url),
    post: async (url) => answer(url),
    patch: async (url) => answer(url),
  }
}

/** Fixed instant, and no waiting: a pass pays for the model, never for backoff. */
const frozenClock = (now: string) => ({
  now: () => new Date(now),
  sleep: async () => {},
})

export const readCase = (slug: string): EvalCase => {
  const parsed = caseSchema.safeParse(
    JSON.parse(readFileSync(new URL(`${slug}/case.json`, CASES), 'utf8')),
  )

  if (!parsed.success) {
    throw new Error(`${slug}/case.json is not a valid case:\n${z.prettifyError(parsed.error)}`)
  }

  if (parsed.data.slug !== slug) {
    throw new Error(`${slug}/case.json calls itself "${parsed.data.slug}"`)
  }

  return parsed.data
}

const runCase = async (evalCase: EvalCase, apiKey: string): Promise<CaseResult> => {
  const profile = tasteProfileSchema.parse(JSON.parse(readFileSync(TASTE_PROFILE_PATH, 'utf8')))

  const store = openStore(':memory:')
  const ports = {
    clock: frozenClock(evalCase.now),
    model: fireworksModel(apiKey),
    http: recordedHttp(evalCase),
  }

  const startedAt = Date.now()
  const outcome = await runRiffRadar({
    args: parseCliArgs(evalCase.args),
    ports,
    store,
    profile,
    searchApiKey: 'eval',
    notionToken: 'eval',
    notionDatabaseId: NOTION_DATABASE_ID,
  })
  const latencyMs = Date.now() - startedAt

  const steps = store.stepsOf(outcome.runId)

  return {
    slug: evalCase.slug,
    runId: outcome.runId,
    terminationReason: outcome.terminationReason,
    defects: gradeRun({
      shortlist: outcome.shortlist,
      // The candidates the run held when it finished, which is what the trace
      // carries: ranking and eligibility are both judged against them.
      candidates: JSON.parse(steps.at(-1)?.candidatesAfter ?? '[]'),
      window: outcome.window,
      profile,
      sourceTexts: store.sourceTextsOf(outcome.runId),
      steps,
      terminationReason: outcome.terminationReason,
      cost: outcome.estimatedCost,
      labels: evalCase.labels,
      budget: evalCase.budget,
    }),
    steps: outcome.stepCount,
    latencyMs,
    tokens: outcome.usage,
    cost: outcome.estimatedCost,
  }
}

// Invoked, rather than imported by the suite: importing this file must not run a
// pass. The same guard `npm run trace` uses.
if (process.argv[1]?.endsWith('eval.ts')) {
  const apiKey = process.env['FIREWORKS_API_KEY']
  if (!apiKey) {
    console.error('FIREWORKS_API_KEY is not set')
    process.exit(2)
  }

  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { case: { type: 'string' }, out: { type: 'string' } },
  })
  const slugs =
    values.case === undefined
      ? readdirSync(CASES, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort()
      : [values.case]

  const results: CaseResult[] = []
  for (const slug of slugs) {
    const evalCase = readCase(slug)
    console.log(`── ${slug} ${'─'.repeat(Math.max(0, 60 - slug.length))}`)

    const result = await runCase(evalCase, apiKey)
    results.push(result)

    console.log(
      `${result.terminationReason}  ·  ${result.steps} steps  ·  ${(result.latencyMs / 1000).toFixed(
        1,
      )}s  ·  $${result.cost.toFixed(4)}`,
    )
    for (const finding of result.defects) {
      console.log(`  ${finding.defect}${finding.release === undefined ? '' : `  ${finding.release}`}  ${finding.detail}`)
    }
    if (result.defects.length === 0) console.log('  no defects')
  }

  const report = aggregate(results)
  const out = values.out ?? `docs/evidence/eval-${new Date().toISOString().replaceAll(':', '-')}.json`
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)

  console.log(`\n${report.totals.cases} cases  ·  $${report.totals.cost.toFixed(4)}  ·  median ${(
    report.totals.medianLatencyMs / 1000
  ).toFixed(1)}s  ·  ${report.totals.incomplete} incomplete`)
  for (const [defect, count] of Object.entries(report.totals.defects)) {
    if (count > 0) console.log(`  ${defect}: ${count}`)
  }
  console.log(`\nwritten to ${out}`)
}
