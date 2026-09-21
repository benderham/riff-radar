/**
 * Harvesting a Golden Case from a historical week: `npm run harvest -- --week 2026-01-16`.
 *
 * Invoked by hand, once per week, because this is the only step in milestone 3
 * that touches a live provider other than the model (ADR-0062). Everything else
 * a run needs is already committed bytes: both Sources are *year* pages whose
 * URL never varies with the window, so a January window is answerable from
 * `fixtures/loudwire.html` captured in September. MusicBrainz is the exception —
 * it is asked live, its answers are written into the case, and the case is
 * hermetic from then on.
 *
 * What the case must **not** carry is a realistic Notion suppression read. Ben's
 * database holds the very albums a historical week is measured against, so a
 * real read would suppress precisely the Known Set and every back-test would
 * score zero. Every case answers the suppression query with an empty database:
 * the question is what this week would have proposed the first time anyone
 * asked.
 *
 * Two recordings are made that the run itself did not ask for, and they are the
 * difference between a case that replays and a case that has to be re-harvested.
 * After the run, every candidate it extracted and every member of the week's
 * Known Set is looked up and recorded, whether the model queried it or not: the
 * model is the one thing a pass does not freeze, so tomorrow's run will ask
 * questions today's did not, and an unrecorded URL is a throw rather than a
 * quiet 404 (by design — a graded Defect has to be about the agent).
 *
 * Labels are eligibility only and derived, never judged: `eligible` is the
 * week's Known Set, which is a frozen file and a rule. Nothing here labels rank
 * order or desirability (ADR-0060).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { parseArgs } from 'node:util'
import {
  KNOWN_SET_PATH,
  MUSICBRAINZ_ENDPOINT,
  NOTION_ENDPOINT,
  SEARCH_ENDPOINT,
  SOURCES,
  TASTE_PROFILE_PATH,
} from '../config.ts'
import type { SourceId } from '../config.ts'
import { systemClock } from '../src/adapters/clock.ts'
import { fireworksModel } from '../src/adapters/fireworks.ts'
import { httpAdapter } from '../src/adapters/http.ts'
import { runRiffRadar } from '../src/agents/riff-radar.ts'
import { lookupRelease } from '../src/clients/musicbrainz.ts'
import { weeksToHarvest } from '../src/domain/backtest.ts'
import type { Candidate } from '../src/domain/candidates.ts'
import { splitIdentity } from '../src/domain/candidates.ts'
import { parseCliArgs } from '../src/domain/cli-args.ts'
import { knownSetWeeks } from '../src/domain/known-set.ts'
import { tasteProfileSchema } from '../src/domain/taste-profile.ts'
import type { HttpPort, HttpResponse, Ports } from '../src/ports.ts'
import { openStore } from '../src/store/store.ts'

const FIXTURES = new URL('../fixtures/', import.meta.url)

/**
 * The twelve: the earliest weeks of the frozen set whose window lies wholly
 * inside the year the Source pages cover, which is where truncation bites least
 * and where the pages carry the whole window (carried-forward items 1 and 6).
 */
const CASES = 12
const YEAR = 2026

/**
 * Midday UTC. `resolveWindow` reads the local date of the instant, so a case
 * pinned to an edge of the day resolves to a different week on a machine in a
 * different timezone — an 09:00+11:00 instant is the previous day anywhere west
 * of UTC+2. Noon UTC is the instant with the most room on both sides: every
 * timezone from UTC-11 to UTC+11 reads the same calendar date.
 */
const AT = 'T12:00:00Z'

/** The same fake every case's recordings name, so no case can reach a real database. */
const NOTION_DATABASE_ID = 'eval-database'

/**
 * Uniform and provisional. `wasteful` is "completed, having spent more than the
 * case allowed", and what a week of real MusicBrainz coverage costs is not known
 * until the baseline has run — so one number for all twelve, revisited in ticket
 * 09 rather than guessed per case now (ADR-0065).
 */
const BUDGET = { steps: 25, costUsd: 0.05 }

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { week: { type: 'string' }, list: { type: 'boolean' } },
})

const apiKey = process.env['FIREWORKS_API_KEY']
if (apiKey === undefined || apiKey === '') {
  console.error('FIREWORKS_API_KEY is not set')
  process.exit(2)
}

const frozen = knownSetWeeks(JSON.parse(readFileSync(KNOWN_SET_PATH, 'utf8')))
const weeks = weeksToHarvest([...frozen.values()], { count: CASES, year: YEAR })

if (values.list === true) {
  for (const week of weeks) console.log(`${week.weekEnding}   k ${week.k}`)
  process.exit(0)
}

const week = weeks.find((each) => each.weekEnding === values.week)
if (week === undefined) {
  console.error(
    `--week must be one of the twelve; ${values.week ?? 'nothing'} is not. Run with --list.`,
  )
  process.exit(2)
}

// The week is the slug. A numeric prefix would renumber every case after any
// week that was ever swapped out, which is churn bought for a sort order the
// dates already give.
const slug = week.weekEnding
const caseDir = new URL(`eval/${slug}/`, FIXTURES)
mkdirSync(new URL('responses/', caseDir), { recursive: true })

/** A body every case shares, by the shape of the Notion URL rather than by its id. */
const notionFixture = (url: string): string | undefined => {
  if (url === `${NOTION_ENDPOINT}/pages`) return 'notion-page-created.json'
  if (url === `${NOTION_ENDPOINT}/databases/${NOTION_DATABASE_ID}/query`) return 'notion-query-empty.json'
  if (url === `${NOTION_ENDPOINT}/databases/${NOTION_DATABASE_ID}`) return 'notion-schema.json'
  return undefined
}

const served = (file: string, contentType: string): HttpResponse => ({
  status: 200,
  attempts: 1,
  headers: { 'content-type': contentType },
  body: readFileSync(new URL(file, FIXTURES), 'utf8'),
})

const recordings: Record<string, string> = {}
let recorded = 0

const live = httpAdapter(systemClock)

/**
 * Fixtures for everything already committed, live MusicBrainz for the rest.
 *
 * A URL that is neither is a provider this harvest was not meant to reach, and
 * it throws rather than being recorded: a case that quietly grew a third live
 * dependency would be discovered when it stopped replaying.
 */
const harvestingHttp: HttpPort = {
  get: async (url) => {
    const sourceId = (Object.keys(SOURCES) as SourceId[]).find((id) => SOURCES[id] === url)
    if (sourceId !== undefined) return served(`${sourceId}.html`, 'text/html')

    if (url.startsWith(MUSICBRAINZ_ENDPOINT)) {
      // A URL already recorded is served from what was recorded rather than
      // asked again: the case can only carry one body per URL anyway, and the
      // seeding pass re-looks-up releases the run already looked up. It saves a
      // request a second under MusicBrainz's rate limit, and it stops the case
      // directory filling with bodies nothing references.
      const already = recordings[url]
      if (already !== undefined) return served(already, 'application/json')

      const response = await live.get(url)
      const file = `eval/${slug}/responses/mb-${String(++recorded).padStart(3, '0')}.json`
      writeFileSync(new URL(file, FIXTURES), response.body)
      // A bare path means 200 to the runner. `case.json` can also carry an
      // object form naming a status, and ticket 06's failed-tool cases are
      // written that way by hand; nothing here emits one. The adapter has
      // already exhausted its retries by this point, and a harvest that froze
      // an exhausted 503 as a case's valid answer is one to re-harvest rather
      // than one to keep (ADR-0058).
      recordings[url] = file
      return response
    }

    const notion = notionFixture(url)
    if (notion !== undefined) return served(notion, 'application/json')

    throw new Error(`harvest would have to reach ${url} live; it records MusicBrainz only`)
  },
  post: async (url, _body, _headers) => {
    const notion = notionFixture(url)
    if (notion !== undefined) return served(notion, 'application/json')
    if (url === SEARCH_ENDPOINT) return served('tavily-search.json', 'application/json')

    throw new Error(`harvest would have to reach ${url} live; it records MusicBrainz only`)
  },
  patch: async (url) => {
    throw new Error(`harvest would have to patch ${url}; a case never writes`)
  },
}

/** Frozen instant, real sleeps: the window is historical and MusicBrainz is not. */
const ports: Ports = {
  clock: { now: () => new Date(`${week.weekEnding}${AT}`), sleep: systemClock.sleep },
  model: fireworksModel(apiKey),
  http: harvestingHttp,
}

const profile = tasteProfileSchema.parse(JSON.parse(readFileSync(TASTE_PROFILE_PATH, 'utf8')))
const store = openStore(':memory:')

console.log(`── ${slug}  k ${week.k} ${'─'.repeat(Math.max(0, 40 - slug.length))}`)

const startedAt = Date.now()
const outcome = await runRiffRadar({
  args: parseCliArgs(['run', '--last-days=7']),
  ports,
  store,
  profile,
  searchApiKey: 'harvest',
  notionToken: 'harvest',
  notionDatabaseId: NOTION_DATABASE_ID,
})

console.log(
  `${outcome.terminationReason}  ·  ${outcome.stepCount} steps  ·  ` +
    `${((Date.now() - startedAt) / 1000).toFixed(1)}s  ·  $${outcome.estimatedCost.toFixed(4)}  ·  ` +
    `window ${outcome.window.from}..${outcome.window.to}`,
)

// ── Seeding the lookups the model did not make ───────────────────────────────
// Everything the run extracted, and everything the Known Set holds for the
// week. The model is the one thing a pass does not freeze, so a replay asks
// questions this run did not, and an unrecorded URL throws.

const candidates: Candidate[] = JSON.parse(
  store.stepsOf(outcome.runId).at(-1)?.candidatesAfter ?? '[]',
)

const toSeed = [
  ...candidates.map((candidate) => ({ artist: candidate.artist, title: candidate.title })),
  ...week.releases.map((release) => splitIdentity(release.artistTitle)),
]

const before = recorded
for (const { artist, title } of toSeed) {
  if (artist === '' || title === '') continue
  await lookupRelease(ports, artist, title)
}
console.log(`seeded ${recorded - before} further lookup(s) over ${toSeed.length} release(s)`)

// ── The case ─────────────────────────────────────────────────────────────────

const caseJson = {
  slug,
  args: ['run', '--last-days=7'],
  now: `${week.weekEnding}${AT}`,
  sources: { loudwire: 'loudwire.html', wikipedia: 'wikipedia.html' },
  labels: {
    // Derived from the frozen Known Set, which is a rule rather than an
    // opinion. A member the eligibility rules would refuse — an EP under the
    // thresholds, a reissue — is labelled eligible here and will read as
    // `missed`; the recorded lookups are what a later pass would use to
    // correct that, with no re-harvest (ADR-0062).
    eligible: week.releases.map((release) => release.artistTitle),
    ineligible: [] as string[],
  },
  budget: BUDGET,
  responses: {
    [`${MUSICBRAINZ_ENDPOINT}/release-group?query=`]: 'musicbrainz-not-found.json',
    [SEARCH_ENDPOINT]: 'tavily-search.json',
    [`${NOTION_ENDPOINT}/databases/${NOTION_DATABASE_ID}/query`]: 'notion-query-empty.json',
    [`${NOTION_ENDPOINT}/databases/${NOTION_DATABASE_ID}`]: 'notion-schema.json',
    [`${NOTION_ENDPOINT}/pages`]: 'notion-page-created.json',
    ...recordings,
  },
}

const casePath = new URL('case.json', caseDir)
if (existsSync(casePath)) {
  console.log(`\n${slug}/case.json exists and was overwritten; the old recordings are still there`)
}
writeFileSync(casePath, `${JSON.stringify(caseJson, null, 2)}\n`)

console.log(`\n${recorded} MusicBrainz answer(s) recorded  ·  $${outcome.estimatedCost.toFixed(4)} at the model`)
console.log(`written to fixtures/eval/${slug}/`)
