/**
 * Web search, for disambiguation and enrichment only.
 *
 * A search settles a question about a release a source already produced — which
 * Ulcerate, whose label, is this the re-record — and it never introduces a
 * release of its own (ADR-0001). That rule is enforced where it can be: a
 * shortlist item must name a candidate a source listed, and this client hands
 * back text with no path into the run's candidates at all.
 *
 * Nothing here throws for a search that disappoints. A refused key, a rate
 * limit, an empty result set, a body of the wrong shape — each is a `warning`
 * the run records and the loop hands to the model, because a question left
 * unanswered is a degraded step and not a failed run (ADR-0030).
 */

import { z } from 'zod'

import { SEARCH_ENDPOINT, SEARCH_RESULT_COUNT } from '../../config.ts'
import type { Ports } from '../ports.ts'

export interface SearchResult {
  readonly title: string
  readonly url: string
  readonly description: string
}

export interface SearchFetch {
  readonly query: string
  readonly url: string
  readonly status: number
  readonly results: readonly SearchResult[]
  /** Present when the search disappointed: a bad status, nothing found, a bad body. */
  readonly warning?: string
}

/**
 * Only the three fields a disambiguation needs; the rest of the payload — the
 * relevance score, the answer, the images, the request id — is dropped.
 *
 * Tavily calls the snippet `content`. It keeps the name `description` on this
 * side of the port, because that is what the rest of the project calls it.
 */
const responseSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
        content: z.string().optional(),
      }),
    )
    .optional(),
})

export const searchWeb = async (
  ports: Ports,
  query: string,
  apiKey: string,
): Promise<SearchFetch> => {
  // The key travels in a header and nothing records request headers, so it
  // cannot reach the trace. The query travels in the body, which is why this is
  // a POST; the URL recorded on the step is therefore the bare endpoint, and
  // `query` is carried back on the result separately.
  const response = await ports.http.post(
    SEARCH_ENDPOINT,
    JSON.stringify({ query, max_results: SEARCH_RESULT_COUNT }),
    { authorization: `Bearer ${apiKey}` },
  )

  const base = { query, url: SEARCH_ENDPOINT, status: response.status, results: [] } as const

  if (response.status < 200 || response.status >= 300) {
    return { ...base, warning: `search for "${query}" returned HTTP ${response.status}` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(response.body)
  } catch (error) {
    return { ...base, warning: `search for "${query}": body was not valid JSON: ${(error as Error).message}` }
  }

  const result = responseSchema.safeParse(parsed)
  if (!result.success) {
    return { ...base, warning: `search for "${query}": body had the wrong shape: ${z.prettifyError(result.error)}` }
  }

  const results = (result.data.results ?? []).map((each) => ({
    title: each.title,
    url: each.url,
    description: each.content ?? '',
  }))

  return {
    ...base,
    results,
    ...(results.length === 0 ? { warning: `search for "${query}" returned no results` } : {}),
  }
}
