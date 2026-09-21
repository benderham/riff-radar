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

import { NOTION_ENDPOINT, NOTION_PAGE_SIZE, NOTION_VERSION, SHORTLIST_SIZE } from '../config.ts'
import { systemClock } from '../src/adapters/clock.ts'
import { httpAdapter } from '../src/adapters/http.ts'
import type { CuratedRow } from '../src/domain/known-set.ts'
import { RATINGS, curate, preferredCount } from '../src/domain/known-set.ts'

/** Committed, and not configurable: see the note above about `--out`. */
const OUT = 'known-set.json'

const token = process.env['NOTION_TOKEN'] ?? ''
const databaseId = process.env['NOTION_DATABASE_ID'] ?? ''

if (token === '' || databaseId === '') {
  console.error('NOTION_TOKEN and NOTION_DATABASE_ID must be set; nothing was requested')
  process.exit(1)
}

const http = httpAdapter(systemClock)

/**
 * Every property curation reads, each one optional: this is somebody else's
 * database, and a renamed column must come back as a row that fails the rule
 * rather than as a parse error over the whole page.
 */
const text = z.array(z.object({ plain_text: z.string() })).optional()

const querySchema = z.object({
  results: z.array(
    z.object({
      properties: z
        .object({
          Album: z.object({ title: text }).optional(),
          Artist: z.object({ rich_text: text }).optional(),
          'MusicBrainz ID': z.object({ rich_text: text }).optional(),
          'Run ID': z.object({ rich_text: text }).optional(),
          'Release Date': z
            .object({ date: z.object({ start: z.string() }).nullable() })
            .optional(),
          // The name is read as a string and matched here rather than by
          // `z.enum`: a fifth option Ben adds to his own column must make a row
          // unrated, not abort the freeze half way through the database.
          Rating: z.object({ select: z.object({ name: z.string() }).nullable() }).optional(),
        })
        .optional(),
    }),
  ),
  has_more: z.boolean().optional(),
  next_cursor: z.string().nullable().optional(),
})

const joined = (parts: { plain_text: string }[] | undefined): string =>
  (parts ?? []).map((part) => part.plain_text).join('').trim()

const rowOf = (page: z.infer<typeof querySchema>['results'][number]): CuratedRow => {
  const properties = page.properties
  // A Notion date is a day or a range; only the start is a release date.
  const releaseDate = properties?.['Release Date']?.date?.start?.slice(0, 10)
  const name = properties?.Rating?.select?.name
  const rating = RATINGS.find((option) => option === name)
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

/**
 * Every row in the database, paged to the end.
 *
 * Not sampled and not filtered by date: a read that misses half the database
 * produces a Known Set that is half the size, which looks exactly like a thin
 * reference set rather than like a bug.
 */
const allRows = async (): Promise<CuratedRow[]> => {
  const rows: CuratedRow[] = []
  let cursor: string | undefined

  do {
    // Through the HTTP adapter rather than `fetch`, so a 429 part way through
    // the database is retried and backed off the way every other provider call
    // is, instead of losing the whole read.
    const response = await http.post(
      `${NOTION_ENDPOINT}/databases/${databaseId}/query`,
      JSON.stringify({
        page_size: NOTION_PAGE_SIZE,
        ...(cursor === undefined ? {} : { start_cursor: cursor }),
      }),
      {
        authorization: `Bearer ${token}`,
        'notion-version': NOTION_VERSION,
        'content-type': 'application/json',
      },
    )

    if (response.status < 200 || response.status >= 300) {
      // The body is not printed: Notion echoes the request in its errors, and
      // the request carries the database id and could carry the token.
      console.error(`Notion answered HTTP ${response.status}; nothing was frozen`)
      process.exit(1)
    }

    const parsed = querySchema.parse(JSON.parse(response.body))
    for (const page of parsed.results) rows.push(rowOf(page))
    cursor = parsed.has_more === true ? (parsed.next_cursor ?? undefined) : undefined
  } while (cursor !== undefined)

  return rows
}

const at = new Date()
const known = curate(await allRows())

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
