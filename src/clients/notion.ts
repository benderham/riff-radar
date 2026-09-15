/**
 * Notion, read-only: what has already been proposed.
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

import { NOTION_ENDPOINT, NOTION_PAGE_SIZE, NOTION_VERSION } from '../../config.ts'
import { artistTitleIdentity } from '../domain/candidates.ts'
import type { Ports } from '../ports.ts'

/** Raised when Notion could not be read. The run does not start (ADR-0039). */
export class SuppressionUnavailable extends Error {}

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
      {
        authorization: `Bearer ${token}`,
        'notion-version': NOTION_VERSION,
        'content-type': 'application/json',
      },
    )

    if (response.status < 200 || response.status >= 300) {
      // The body is not repeated: Notion echoes the request in its errors, and
      // the request carries the database id and could carry the token.
      throw new SuppressionUnavailable(
        `Notion refused the suppression query with HTTP ${response.status}`,
      )
    }

    let parsed
    try {
      parsed = querySchema.parse(JSON.parse(response.body))
    } catch (error) {
      throw new SuppressionUnavailable(
        `Notion's answer was not the shape this reads: ${(error as Error).message}`,
      )
    }

    for (const page of parsed.results) {
      for (const identity of identitiesOf(page)) identities.add(identity)
    }

    cursor = parsed.has_more === true ? (parsed.next_cursor ?? undefined) : undefined
  } while (cursor !== undefined)

  return identities
}
