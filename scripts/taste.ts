/**
 * The three subjective numbers: `npm run taste`.
 *
 * Invoked by hand, like the six smoke scripts and the freeze, because it reads
 * Ben's live Notion database. It answers "were the recommendations any good",
 * which the Golden Dataset deliberately never asks (ADR-0060), and it gates
 * nothing: a quiet week of mediocre metal is not a failed milestone.
 *
 * **Read-only, and that is the whole safety argument.** The schema below names
 * `Rating`, which `NOTION_PROPERTIES` still does not, and there is no path here
 * that creates or patches a page: no import of `notion.ts`, one HTTP verb
 * behind `allRows` (ADR-0061).
 *
 * `profile_version` is not in Notion, so it is joined on locally: a proposal
 * carries its `Run ID`, and the version that run ran under is read from the
 * store — and from the trace exports under `docs/evidence/`, because the
 * milestone-1 database was deleted at milestone 2's schema change and those
 * files are the only surviving record of two of the four runs that have ever
 * written to Notion. A run neither remembers is bucketed as `unknown` rather
 * than guessed at or dropped.
 *
 * The arithmetic is pure and lives in `src/domain/taste.ts` (ADR-0064). This
 * file is paging, joining and printing.
 */

import { readFileSync, readdirSync } from 'node:fs'
import process from 'node:process'
import { z } from 'zod'

import { DATABASE_PATH, SHORTLIST_SIZE } from '../config.ts'
import { systemClock } from '../src/adapters/clock.ts'
import { httpAdapter } from '../src/adapters/http.ts'
import { openStore } from '../src/store/store.ts'
import { ratingNamed } from '../src/domain/known-set.ts'
import type { ProposalRow, RunProfile } from '../src/domain/taste.ts'
import { measure } from '../src/domain/taste.ts'
import { allRows, joined, notionCredentials, richText, selected } from './notion-read.ts'

const { token, databaseId } = notionCredentials()

/**
 * The three properties these numbers read, each one optional: this is somebody
 * else's database, and a renamed column must make a row unjudged or unrated
 * rather than fail the parse over the whole page. Both select columns are read
 * as plain strings for the same reason — a fifth `Rating` or a fourth `Status`
 * Ben adds to his own columns must not abort the reading half way through.
 */
const pageSchema = z.object({
  properties: z
    .object({
      Status: selected,
      Rating: selected,
      'Run ID': z.object({ rich_text: richText }).optional(),
    })
    .optional(),
})

const rowOf = (page: z.infer<typeof pageSchema>): ProposalRow => {
  const properties = page.properties
  const status = properties?.Status?.select?.name
  const rating = ratingNamed(properties?.Rating?.select?.name)

  return {
    runId: joined(properties?.['Run ID']?.rich_text),
    ...(status === undefined ? {} : { status }),
    ...(rating === undefined ? {} : { rating }),
  }
}

/** A share as a percentage, or a dash where there is no share to take. */
const percent = (numerator: number, denominator: number): string =>
  denominator === 0 ? '  — ' : `${((numerator / denominator) * 100).toFixed(0).padStart(3)}%`

/** Committed trace exports: the only record of runs whose database is gone. */
const EVIDENCE = 'docs/evidence'

const http = httpAdapter(systemClock)
const store = openStore(DATABASE_PATH)

// The whole database, paged to the end: a read that misses half of it produces
// a rate over half the proposals and looks exactly like a smaller sample.
const pages = await allRows(http, {
  token,
  databaseId,
  rowSchema: pageSchema,
  failureMessage: 'nothing was measured',
})

// Every run this machine has recorded. The prefix is empty, which matches all
// of them, and all of them are real: the evaluation and the harvest open
// `:memory:`, so nothing in this file is a replay.
const runs: RunProfile[] = store.runsMatching('')
store.close()

/** As much of a committed trace export as the join needs. */
const exportSchema = z.object({
  run: z.object({
    run_id: z.string(),
    profile_version: z.number(),
    termination_reason: z.string().nullable(),
  }),
})

// The evidence files a deleted database left behind. Read leniently: this
// directory also holds an Eval Report, which is not a trace, and a file that
// is not JSON at all is one more thing this join does not know rather than a
// reason to abandon a reading of the whole database.
for (const name of readdirSync(EVIDENCE)) {
  if (!name.endsWith('.json')) continue
  let body: unknown
  try {
    body = JSON.parse(readFileSync(`${EVIDENCE}/${name}`, 'utf8'))
  } catch {
    continue
  }
  const parsed = exportSchema.safeParse(body)
  if (!parsed.success) continue
  const exported = parsed.data.run
  if (runs.some((run) => run.runId === exported.run_id)) continue
  runs.push({
    runId: exported.run_id,
    profileVersion: exported.profile_version,
    terminationReason: exported.termination_reason,
  })
}

const metrics = measure(pages.map(rowOf), runs, SHORTLIST_SIZE)

// Counts and rates only. No album title is printed: this output goes into a
// terminal and a terminal into a log.
console.log(`read ${new Date().toISOString().slice(0, 10)}, ${pages.length} rows`)
console.log(`${metrics.handEntered} hand-entered, which are not proposals`)

if (metrics.byProfileVersion.length === 0) {
  console.log('\nno proposals to measure')
} else {
  // Per profile version and never pooled: a profile edit invalidates
  // comparison across the boundary (ADR-0060).
  console.log(`\nprofile   n   ${'Acceptance'.padEnd(20)}${'Taste Yield'.padEnd(29)}Fill Rate`)
}

for (const reading of metrics.byProfileVersion) {
  const version = reading.profileVersion === 'unknown' ? 'unknown' : `v${reading.profileVersion}`
  const acceptance = `${percent(reading.accepted, reading.proposals)} (${reading.unjudged} unjudged)`
  const yielded =
    `${percent(reading.preferred, reading.rated)} of ${reading.rated} rated ` +
    `(${reading.proposals - reading.rated} unrated)`
  // Fill Rate is printed unconditionally and beside the other two: yield alone
  // is maximised by proposing fewer and safer, and this is the denominator
  // that stops the metric rewarding cowardice (ADR-0060).
  const fill = `${percent(reading.full, reading.runs)} of ${reading.runs} run(s)`

  console.log(
    `${version.padEnd(8)}${String(reading.proposals).padStart(3)}   ` +
      `${acceptance.padEnd(20)}${yielded.padEnd(29)}${fill}`,
  )
}
