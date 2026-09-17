/**
 * Notion: what has already been proposed, and what this run proposes.
 *
 * Three things live here, in that order. The suppression read, which is memory.
 * The schema preflight, which is the agent checking that Ben's database is the
 * one it knows how to write to. And the write itself, which is post-loop code
 * the model cannot reach (ADR-0005).
 *
 * This is one half of the only memory that crosses a run boundary (ADR-0009).
 * The other is the taste profile. A release already in the database is
 * suppressed on Release Identity whatever its Status — a record Ben rejected is
 * one he has already judged, and proposing it again is the agent forgetting
 * rather than the agent trying harder.
 *
 * Two identities come back for every record, because a candidate does not have
 * one identity for its whole life: it is artist-and-title from the moment a
 * source lists it, and a release-group id only once a lookup has been spent on
 * it (CONTEXT.md). Suppression has to bite at both, or a release would be
 * suppressed only after the run had already paid to identify it.
 *
 * A failure here refuses the run rather than degrading it (ADR-0039): an
 * unsuppressed run can propose what Notion already holds, and the write's
 * idempotency is exactly what this read exists to guarantee.
 */

import { z } from 'zod'

import { NOTION_ENDPOINT, NOTION_PAGE_SIZE, NOTION_PROPERTIES, NOTION_VERSION } from '../../config.ts'
import { artistTitleIdentity } from '../domain/candidates.ts'
import { notionPage } from '../domain/notion-page.ts'
import type { ShortlistItem } from '../domain/shortlist.ts'
import { categoriseFailure, categoryOf, withCategory } from '../domain/failure.ts'
import { describeStatus } from '../domain/http-outcome.ts'
import type { Ports } from '../ports.ts'
import { coverArtUrl } from './coverart.ts'

/** Anything that stops a run before it starts: the CLI reports these as refusals. */
export class NotionRefusal extends Error {}

/** Raised when Notion could not be read. The run does not start (ADR-0039). */
export class SuppressionUnavailable extends NotionRefusal {}

/**
 * Raised when Ben's database is not the database this writes to. It is raised
 * at the start of a run rather than at the write, because the answer is the
 * same either way and finding out first costs no model tokens.
 */
export class SchemaMismatch extends NotionRefusal {}

/**
 * Raised when a write began and could not be finished. The run is over by
 * then, so this is reported rather than refused — and what it says about the
 * rollback is the part that matters.
 */
export class NotionWriteFailed extends Error {}

/**
 * A refusal, carrying what kind of refusal it was.
 *
 * Notion is the one provider whose failures throw rather than return (ADR-0039:
 * a suppression read that fails refuses the run), so the category travels on
 * the error to the step that records it, instead of being re-read from prose.
 */
const refusal = <E extends Error>(error: E, status: number, body: string): E =>
  withCategory(error, categoriseFailure(status, body))

/**
 * Only the three properties identity needs, and every one of them optional:
 * this is somebody else's database and a property that has been renamed must
 * fail as a missing identity rather than as a parse error on the whole page.
 */
const textOf = z.array(z.object({ plain_text: z.string() })).optional()

const querySchema = z.object({
  results: z.array(
    z.object({
      properties: z
        .object({
          // `Album`, not `Title`: the database is the contract and it predates
          // the specification, which said `Title` and was wrong (ADR-0011).
          Album: z.object({ title: textOf }).optional(),
          Artist: z.object({ rich_text: textOf }).optional(),
          'MusicBrainz ID': z.object({ rich_text: textOf }).optional(),
        })
        .optional(),
    }),
  ),
  has_more: z.boolean().optional(),
  next_cursor: z.string().nullable().optional(),
})

const headersFor = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  'notion-version': NOTION_VERSION,
  'content-type': 'application/json',
})

const joined = (parts: { plain_text: string }[] | undefined): string =>
  (parts ?? []).map((part) => part.plain_text).join('').trim()

/**
 * Every identity one Notion page answers to: its MusicBrainz id, and its artist
 * and title. A page missing both contributes nothing rather than contributing
 * an empty identity that would suppress every unnamed candidate.
 */
const identitiesOf = (page: z.infer<typeof querySchema>['results'][number]): string[] => {
  const musicbrainzId = joined(page.properties?.['MusicBrainz ID']?.rich_text)
  const artist = joined(page.properties?.Artist?.rich_text)
  const title = joined(page.properties?.Album?.title)

  return [
    ...(musicbrainzId === '' ? [] : [musicbrainzId]),
    ...(artist === '' || title === '' ? [] : [artistTitleIdentity(artist, title)]),
  ]
}

/**
 * Every release already in the Notion database, as identities.
 *
 * Paged through to the end rather than sampled: a database this read misses
 * half of suppresses half of what it should, which looks exactly like the
 * database being up to date.
 */
export const suppressedReleases = async (
  ports: Ports,
  token: string,
  databaseId: string,
): Promise<Set<string>> => {
  const identities = new Set<string>()
  let cursor: string | undefined

  do {
    const response = await ports.http.post(
      `${NOTION_ENDPOINT}/databases/${databaseId}/query`,
      JSON.stringify({
        page_size: NOTION_PAGE_SIZE,
        ...(cursor === undefined ? {} : { start_cursor: cursor }),
      }),
      headersFor(token),
    )

    if (response.status < 200 || response.status >= 300) {
      // The body is not repeated: Notion echoes the request in its errors, and
      // the request carries the database id and could carry the token.
      throw refusal(
        new SuppressionUnavailable(
          `Notion refused the suppression query with ${describeStatus(response)}`,
        ),
        response.status,
        response.body,
      )
    }

    let parsed
    try {
      parsed = querySchema.parse(JSON.parse(response.body))
    } catch (error) {
      throw withCategory(
        new SuppressionUnavailable(`Notion's answer was not the shape this reads: ${(error as Error).message}`),
        'malformed',
      )
    }

    for (const page of parsed.results) {
      for (const identity of identitiesOf(page)) identities.add(identity)
    }

    cursor = parsed.has_more === true ? (parsed.next_cursor ?? undefined) : undefined
  } while (cursor !== undefined)

  return identities
}

/**
 * The database's own description: every property it has, and the type of each.
 * Only the names and types are read; nothing here touches a record.
 */
const schemaResponse = z.object({
  properties: z.record(z.string(), z.object({ type: z.string() })),
})

/**
 * That Ben's database is the one this writes to, or what is wrong with it.
 *
 * The agent never creates or alters a schema: a property that is missing, or
 * that is the wrong type, is Ben's to fix by hand. Refusing here rather than
 * at the write is what makes a half-updated database impossible — the write
 * cannot fail on the third row for a reason that was visible before the first.
 */
export const preflightSchema = async (
  ports: Ports,
  token: string,
  databaseId: string,
): Promise<void> => {
  const response = await ports.http.get(`${NOTION_ENDPOINT}/databases/${databaseId}`, headersFor(token))

  if (response.status < 200 || response.status >= 300) {
    throw refusal(
      new SchemaMismatch(
        `Notion refused to describe the database with ${describeStatus(response)}`,
      ),
      response.status,
      response.body,
    )
  }

  let properties
  try {
    properties = schemaResponse.parse(JSON.parse(response.body)).properties
  } catch (error) {
    throw withCategory(
      new SchemaMismatch(`Notion's description of the database was unreadable: ${(error as Error).message}`),
      'malformed',
    )
  }

  const problems = Object.entries(NOTION_PROPERTIES).flatMap(([name, expected]) => {
    const actual = properties[name]?.type
    if (actual === undefined) return [`${name} (${expected}) is missing`]
    return actual === expected ? [] : [`${name} is ${actual}, expected ${expected}`]
  })

  if (problems.length > 0) {
    throw new SchemaMismatch(`the Notion database does not match: ${problems.join('; ')}`)
  }
}

const createPage = async (
  ports: Ports,
  token: string,
  page: unknown,
): Promise<string> => {
  const response = await ports.http.post(`${NOTION_ENDPOINT}/pages`, JSON.stringify(page), headersFor(token))

  if (response.status < 200 || response.status >= 300) {
    // Notion echoes the request in its errors, and the request carries the
    // database id; the status is what says what to do about it.
    throw refusal(
      new NotionWriteFailed(
        `Notion refused a page with ${describeStatus(response)}`,
      ),
      response.status,
      response.body,
    )
  }

  return z.object({ id: z.string() }).parse(JSON.parse(response.body)).id
}

/** Undoes a page. Notion has no delete, and an archived page is out of the database. */
const archivePage = async (ports: Ports, token: string, pageId: string): Promise<void> => {
  const response = await ports.http.patch(
    `${NOTION_ENDPOINT}/pages/${pageId}`,
    JSON.stringify({ archived: true }),
    headersFor(token),
  )
  if (response.status < 200 || response.status >= 300) {
    throw refusal(
      new Error(`${describeStatus(response)} archiving ${pageId}`),
      response.status,
      response.body,
    )
  }
}

/**
 * The shortlist, in Ben's database, as `Proposed` rows.
 *
 * All-or-nothing, which Notion cannot do for us: it has no batch create, so a
 * failure part way through archives the rows already written. The preflight is
 * what makes that path rare; the rollback is what makes a Friday's database
 * either the whole shortlist or none of it, so a re-run proposes the week again
 * rather than the three it did not get to.
 *
 * Cover art is fetched first and per item, because a cover is set when a page
 * is created and never afterwards — and because the whole fetch is best-effort,
 * an archive that has nothing, or is down, costs a picture and not a run.
 */
export const proposeShortlist = async (
  ports: Ports,
  {
    token,
    databaseId,
    runId,
    shortlist,
  }: {
    token: string
    databaseId: string
    runId: string
    shortlist: readonly ShortlistItem[]
  },
): Promise<number> => {
  const created: string[] = []

  try {
    for (const item of shortlist) {
      const musicbrainzId = item.musicbrainzId?.trim()
      const coverUrl =
        musicbrainzId === undefined || musicbrainzId === ''
          ? undefined
          : await coverArtUrl(ports, musicbrainzId)

      created.push(
        await createPage(
          ports,
          token,
          notionPage(item, { databaseId, runId, ...(coverUrl === undefined ? {} : { coverUrl }) }),
        ),
      )
    }
  } catch (error) {
    const undone: string[] = []
    for (const pageId of created) {
      try {
        await archivePage(ports, token, pageId)
      } catch (failure) {
        undone.push((failure as Error).message)
      }
    }

    // The rollback's own failures are appended to the message, but the category
    // is the one that stopped the write: that is the call the step is about.
    throw withCategory(
      new NotionWriteFailed(
        `${(error as Error).message}; ${created.length} page(s) written and rolled back` +
          (undone.length === 0 ? '' : `, except: ${undone.join('; ')}`),
      ),
      categoryOf(error),
    )
  }

  return created.length
}
