/**
 * Reading a whole Notion database, for the read-only commands.
 *
 * Shared by `known-set.ts` and `taste.ts`, which both page the same database
 * to the end and differ only in which properties they parse. The paging loop
 * is the part worth having once: a cursor mishandled, or a 429 part way
 * through, loses rows silently, and a half-read database looks exactly like a
 * thin one rather than like a bug.
 *
 * One HTTP verb and no import of `notion.ts`, which is what makes "no write
 * path names `Rating`" checkable in one pass (ADR-0061).
 */

import process from 'node:process'
import { z } from 'zod'

import { NOTION_ENDPOINT, NOTION_PAGE_SIZE, NOTION_VERSION } from '../config.ts'
import type { HttpPort } from '../src/ports.ts'

/**
 * The two environment variables every Notion command needs, or an exit.
 *
 * Refused before anything is requested, which is the contract the credential
 * checks elsewhere keep: nothing spent and nothing written.
 */
export const notionCredentials = (): { token: string; databaseId: string } => {
  const token = process.env['NOTION_TOKEN'] ?? ''
  const databaseId = process.env['NOTION_DATABASE_ID'] ?? ''

  if (token === '' || databaseId === '') {
    console.error('NOTION_TOKEN and NOTION_DATABASE_ID must be set; nothing was requested')
    process.exit(1)
  }

  return { token, databaseId }
}

/** Notion's rich text, as every read-only command receives it. */
export const richText = z.array(z.object({ plain_text: z.string() })).optional()

/** A select column read as a plain string, so a new option is data and not a crash. */
export const selected = z.object({ select: z.object({ name: z.string() }).nullable() }).optional()

/** The one string a rich-text column means. */
export const joined = (parts: { plain_text: string }[] | undefined): string =>
  (parts ?? []).map((part) => part.plain_text).join('').trim()

const envelope = z.object({
  results: z.array(z.unknown()),
  has_more: z.boolean().optional(),
  next_cursor: z.string().nullable().optional(),
})

/**
 * Every row in the database, paged to the end and parsed one page at a time.
 *
 * A refusal exits rather than reporting a number computed from part of the
 * database: a half-read database looks exactly like a small one.
 */
export const allRows = async <Row>(
  http: HttpPort,
  options: {
    readonly token: string
    readonly databaseId: string
    readonly rowSchema: z.ZodType<Row>
    /** Completes the sentence printed if Notion refuses. */
    readonly failureMessage: string
  },
): Promise<Row[]> => {
  const rows: Row[] = []
  let cursor: string | undefined

  do {
    // Through the HTTP adapter rather than `fetch`, so a 429 part way through
    // the database is retried and backed off the way every other provider
    // call is, instead of losing the whole read.
    const response = await http.post(
      `${NOTION_ENDPOINT}/databases/${options.databaseId}/query`,
      JSON.stringify({
        page_size: NOTION_PAGE_SIZE,
        ...(cursor === undefined ? {} : { start_cursor: cursor }),
      }),
      {
        authorization: `Bearer ${options.token}`,
        'notion-version': NOTION_VERSION,
        'content-type': 'application/json',
      },
    )

    if (response.status < 200 || response.status >= 300) {
      // The body is not printed: Notion echoes the request in its errors, and
      // the request carries the database id and could carry the token.
      console.error(`Notion answered HTTP ${response.status}; ${options.failureMessage}`)
      process.exit(1)
    }

    const page = envelope.parse(JSON.parse(response.body))
    for (const result of page.results) rows.push(options.rowSchema.parse(result))
    cursor = page.has_more === true ? (page.next_cursor ?? undefined) : undefined
  } while (cursor !== undefined)

  return rows
}
