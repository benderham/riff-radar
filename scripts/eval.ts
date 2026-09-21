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

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { z } from 'zod'

import { KNOWN_SET_PATH, MODEL_ID, PROMPT_VERSION, SHORTLIST_SIZE, SOURCES, TASTE_PROFILE_PATH } from '../config.ts'
import type { SourceId } from '../config.ts'
import { fireworksModel } from '../src/adapters/fireworks.ts'
import { runRiffRadar } from '../src/agents/riff-radar.ts'
import { parseCliArgs } from '../src/domain/cli-args.ts'
import { backtest } from '../src/domain/backtest.ts'
import type { CaseResult, EvalCase, OneResponse } from '../src/domain/eval.ts'
import { aggregate, caseSchema, gradeRun } from '../src/domain/eval.ts'
import { knownSetWeeks, type KnownWeek } from '../src/domain/known-set.ts'
import { tasteProfileSchema } from '../src/domain/taste-profile.ts'
import type { HttpPort, HttpResponse } from '../src/ports.ts'
import { openStore } from '../src/store/store.ts'

const FIXTURES = new URL('../fixtures/', import.meta.url)
const CASES = new URL('eval/', FIXTURES)

/** Fake: a pass never reaches Notion, and every case's recordings name this one. */
const NOTION_DATABASE_ID = 'eval-database'

/**
 * A case whose slug starts `00-` is a fixture of the runner rather than a
 * Golden Case: it proves the wiring and must not reach a pass, where it would
 * skew the mean cost, the median latency and every defect count that ADR-0065's
 * budgets are set against. `--case 00-smoke` still runs it.
 */
const isGoldenCase = (slug: string): boolean => !slug.startsWith('00-')

const fixture = (relativePath: string, slug: string): string => {
  try {
    return readFileSync(new URL(relativePath, FIXTURES), 'utf8')
  } catch {
    throw new Error(`${slug}: fixtures/${relativePath} is named by case.json and is not there`)
  }
}

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
  // Matched case-insensitively, because the encoded artist and title travel in
  // the URL: a harvest seeds a lookup from the Known Set's normalised identity
  // while the model asks with the calendar's capitalisation, and a MusicBrainz
  // query means the same thing either way. Without this the seeded recordings
  // would be invisible to the run they exist for.
  const answers = Object.entries(evalCase.responses)
    .map(([prefix, body]) => [prefix.toLowerCase(), body] as const)
    .sort(([one], [other]) => other.length - one.length)

  const sourceUrls = new Map<string, string>(
    Object.entries(evalCase.sources).map(([id, file]) => [SOURCES[id as SourceId], file]),
  )

  const configured: readonly string[] = Object.values(SOURCES)

  // Where each sequence has got to. The port is the smallest place this can
  // live and the right one: it is built per case, so no pass carries a
  // position into the next run.
  const asked = new Map<string, number>()

  const next = (prefix: string, sequence: readonly OneResponse[]): OneResponse => {
    const index = asked.get(prefix) ?? 0
    asked.set(prefix, index + 1)
    const entry = sequence[Math.min(index, sequence.length - 1)]
    // The schema refuses an empty sequence, so this is `noUncheckedIndexedAccess`
    // being satisfied rather than a case anyone can write.
    if (entry === undefined) throw new Error(`${evalCase.slug}: ${prefix} records an empty sequence`)
    return entry
  }

  const answer = (url: string): HttpResponse => {
    const source = sourceUrls.get(url)
    if (source !== undefined) {
      return {
        status: 200,
        attempts: 1,
        headers: { 'content-type': 'text/html' },
        body: fixture(source, evalCase.slug),
      }
    }

    if (configured.includes(url)) {
      return {
        status: 404,
        attempts: 1,
        headers: {},
        body: `this case does not carry ${url}`,
      }
    }

    const recorded = answers.find(([prefix]) => url.toLowerCase().startsWith(prefix))
    if (recorded === undefined) {
      throw new Error(
        `${evalCase.slug}: no recorded response for ${url}. Record one, or widen a prefix in case.json.`,
      )
    }

    // A bare path is the ordinary recording and means 200. The object form
    // carries the status, which is how a case records a refusal or a rate
    // limit — the failures two of the seven Defects are about. An array is a
    // sequence: successive asks walk it and the last entry repeats, which is
    // how a case says a lookup failed and then answered (ADR-0067).
    const [prefix, recording] = recorded
    const body = Array.isArray(recording) ? next(prefix, recording) : recording
    if (typeof body === 'string') {
      return {
        status: 200,
        attempts: 1,
        headers: { 'content-type': 'application/json' },
        body: fixture(body, evalCase.slug),
      }
    }

    return {
      status: body.status,
      attempts: 1,
      headers: body.headers ?? { 'content-type': 'application/json' },
      body: body.file === undefined ? '' : fixture(body.file, evalCase.slug),
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

/**
 * The frozen Known Set, or nothing.
 *
 * Read once per pass and keyed by the Friday a week closes on, which is how a
 * case finds its week without carrying a field for it: the resolved window's
 * end *is* the bucket's name (ADR-0066). A pass on a machine without the file
 * runs and reports no back-test, because the Golden Cases grade defects with or
 * without Ben's reference set.
 */
const knownWeeks = (): Map<string, KnownWeek> =>
  // Absent is a fine answer. A file that is *not* a frozen set is refused
  // rather than read as empty, because a silent empty Map would report "no
  // back-test" for a corrupt file exactly as it does for an absent one.
  existsSync(KNOWN_SET_PATH)
    ? knownSetWeeks(JSON.parse(readFileSync(KNOWN_SET_PATH, 'utf8')))
    : new Map()

const readProfile = () =>
  tasteProfileSchema.parse(JSON.parse(readFileSync(TASTE_PROFILE_PATH, 'utf8')))

const profileVersion = (): number => readProfile().version

const runCase = async (
  evalCase: EvalCase,
  apiKey: string,
  weeks: Map<string, KnownWeek>,
): Promise<CaseResult> => {
  const profile = readProfile()

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
  // Only a harvested case is back-tested, and a harvested case is named by the
  // week it replays. The smoke case's window ends on a real Known Set week, so
  // keying on the window alone would score a hand-built fixture against Ben's
  // January albums; a mutated case (ticket 06) inherits its parent's `now` and
  // would do the same.
  const week = evalCase.slug === outcome.window.to ? weeks.get(evalCase.slug) : undefined

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
    ...(week === undefined ? {} : { backtest: backtest(outcome.shortlist, week) }),
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
          .filter(isGoldenCase)
          .sort()
      : [values.case]

  const weeks = knownWeeks()
  const results: CaseResult[] = []
  const broken: string[] = []

  for (const slug of slugs) {
    console.log(`── ${slug} ${'─'.repeat(Math.max(0, 60 - slug.length))}`)

    // A case that throws — a recording nobody made, a file that moved — must
    // not take the pass down with it: every case before it has already been
    // paid for at the model, and a report that is never written is that spend
    // thrown away. The failure is reported and the pass goes on.
    let result
    try {
      result = await runCase(readCase(slug), apiKey, weeks)
    } catch (error) {
      broken.push(slug)
      console.log(`  could not run: ${(error as Error).message}`)
      continue
    }

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
    if (result.backtest !== undefined) {
      const { hits, k, score, preferred } = result.backtest
      console.log(
        `  back-test ${hits}/${Math.min(k, SHORTLIST_SIZE)} = ${score.toFixed(2)}  (k ${k}` +
          `${preferred === undefined ? '' : `, ${preferred} rated Rotate or AOTY`})`,
      )
    }
  }

  const report = aggregate(results, {
    at: new Date().toISOString(),
    promptVersion: PROMPT_VERSION,
    profileVersion: profileVersion(),
    modelId: MODEL_ID,
  })

  const out =
    values.out ??
    fileURLToPath(new URL(`../docs/evidence/eval-${report.configuration.at.replaceAll(':', '-')}.json`, import.meta.url))
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)

  if (broken.length > 0) console.log(`\ncould not run: ${broken.join(', ')}`)
  console.log(`\n${report.totals.cases} cases  ·  $${report.totals.cost.toFixed(4)}  ·  median ${(
    report.totals.medianLatencyMs / 1000
  ).toFixed(1)}s  ·  ${report.totals.incomplete} incomplete`)
  for (const [defect, count] of Object.entries(report.totals.defects)) {
    if (count > 0) console.log(`  ${defect}: ${count}`)
  }
  console.log(`\nwritten to ${out}`)
}
