/**
 * Freezing the Known Set: `npm run known-set`.
 *
 * Invoked by hand, like the six smoke scripts, because it reads Ben's live
 * Notion database. It is the mechanical half of ticket 04 — the rating is his
 * and cannot be automated; bucketing eight months of rows by week and counting
 * what the rule leaves out is arithmetic.
 *
 * **Read-only, and that is the whole safety argument.** This carries its own
 * schema naming `Rating`, which `NOTION_PROPERTIES` still does not, and has no
 * path that creates or patches a page: no import of `notion.ts`, one HTTP verb.
 * The guarantee ADR-0061 amended ADR-0042 down to is "no write path names
 * `Rating`", and this file is why the weaker sentence is worth having.
 *
 * Two outputs. The curation record — the date, the rows, the rule and `k` per
 * week — is counts, and goes in the Eval Report. The frozen set itself is the
 * reference set the Back-test divides by, and it is committed: a benchmark
 * nobody outside can inspect is what ADR-0063's freeze exists to prevent, and
 * ADR-0066 records that as Ben's call. The path is fixed rather than a flag,
 * because the only thing an `--out` would buy is a stale second copy.
 *
 * The curation is pure and lives in `src/domain/known-set.ts` (ADR-0064). This
 * file is paging and printing.
 */

import { writeFileSync } from 'node:fs'
import process from 'node:process'
import { z } from 'zod'

import { SHORTLIST_SIZE } from '../config.ts'
import { systemClock } from '../src/adapters/clock.ts'
import { httpAdapter } from '../src/adapters/http.ts'
import type { CuratedRow } from '../src/domain/known-set.ts'
import { curate, preferredCount, ratingNamed } from '../src/domain/known-set.ts'
import { allRows, joined, notionCredentials, richText, selected } from './notion-read.ts'

/** Committed, and not configurable: see the note above about `--out`. */
const OUT = 'known-set.json'

const { token, databaseId } = notionCredentials()

const http = httpAdapter(systemClock)

/**
 * Every property curation reads, each one optional: this is somebody else's
 * database, and a renamed column must come back as a row that fails the rule
 * rather than as a parse error over the whole page.
 */
const pageSchema = z.object({
  properties: z
    .object({
      Album: z.object({ title: richText }).optional(),
      Artist: z.object({ rich_text: richText }).optional(),
      'MusicBrainz ID': z.object({ rich_text: richText }).optional(),
      'Run ID': z.object({ rich_text: richText }).optional(),
      'Release Date': z.object({ date: z.object({ start: z.string() }).nullable() }).optional(),
      Rating: selected,
    })
    .optional(),
})

const rowOf = (page: z.infer<typeof pageSchema>): CuratedRow => {
  const properties = page.properties
  // A Notion date is a day or a range; only the start is a release date.
  const releaseDate = properties?.['Release Date']?.date?.start?.slice(0, 10)
  const rating = ratingNamed(properties?.Rating?.select?.name)
  const musicbrainzId = joined(properties?.['MusicBrainz ID']?.rich_text)

  return {
    artist: joined(properties?.Artist?.rich_text),
    title: joined(properties?.Album?.title),
    runId: joined(properties?.['Run ID']?.rich_text),
    ...(releaseDate === undefined ? {} : { releaseDate }),
    ...(rating === undefined ? {} : { rating }),
    ...(musicbrainzId === '' ? {} : { musicbrainzId }),
  }
}

const at = new Date()
// Not sampled and not filtered by date: a read that misses half the database
// produces a Known Set that is half the size, which looks exactly like a thin
// reference set rather than like a bug.
const pages = await allRows(http, {
  token,
  databaseId,
  rowSchema: pageSchema,
  failureMessage: 'nothing was frozen',
})
const known = curate(pages.map(rowOf))

writeFileSync(OUT, `${JSON.stringify({ frozenAt: at.toISOString(), ...known }, undefined, 2)}\n`)

// The curation record, which is counts and goes in the Eval Report. No album
// title is printed: this output goes into a terminal and a terminal into a log.
console.log(`frozen ${at.toISOString().slice(0, 10)}`)
console.log(
  `rule: Run ID empty and Rating not Nope; unrated excluded (ADR-0063)\n` +
    `${known.rows} rows read, ${known.rows - known.excluded.unrated} rated, ` +
    `${known.members} members across ${known.weeks.length} weeks`,
)
console.log(
  `excluded: ${known.excluded.nope} Nope, ${known.excluded.unrated} unrated, ` +
    `${known.excluded.agentWritten} agent-written, ${known.excluded.undated} undated, ` +
    `${known.excluded.unidentifiable} unidentifiable`,
)

console.log('\nweek ending    k')
for (const week of known.weeks) {
  console.log(`${week.weekEnding}  ${String(week.k).padStart(3)}`)
}

// The `Rotate`/`AOTY` number is printed only where the cap forced a choice,
// which is the only place ADR-0063 says it means anything.
const busy = known.weeks.filter((week) => week.k > SHORTLIST_SIZE)
console.log(`\n${busy.length} week(s) hold more than ${SHORTLIST_SIZE}, where the cap forced a choice:`)
for (const week of busy) {
  console.log(`${week.weekEnding}   k ${week.k}, ${preferredCount(week)} rated Rotate or AOTY`)
}

console.log(`\nthe set itself is in ${OUT}`)
