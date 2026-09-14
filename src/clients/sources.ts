/**
 * Reading one configured source.
 *
 * Fetch, reduce to text, and hand the text to the model to extract candidates
 * (ADR-0003). There is no parser per source: four bespoke scrapers would be
 * four things to maintain on a project whose subject is agent loops, and they
 * break the week a source is redesigned.
 *
 * The extraction call is a plain completion with no tools, not an agent: one
 * page in, one JSON object out, nothing chosen. Its cost is returned so that
 * the run prices it like any other model call.
 *
 * Nothing here throws for a source that disappoints. A page that 403s, a page
 * that lists nothing, an extraction that comes back malformed — each is a
 * `warning` the run records and the loop hands to the model, because losing one
 * of three sources is a degraded run and not a failed one (ADR-0030).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

import { MAX_SOURCE_TEXT_CHARS, SOURCES } from '../../config.ts'
import type { SourceId } from '../../config.ts'
import type { Candidate } from '../domain/candidates.ts'
import { extractionSchema, normaliseCandidate, withinWindow } from '../domain/candidates.ts'
import type { Usage } from '../domain/cost.ts'
import { NO_USAGE } from '../domain/cost.ts'
import { htmlToText } from '../domain/html-text.ts'
import type { DateWindow } from '../domain/window.ts'
import type { Ports } from '../ports.ts'

const EXTRACT_PROMPT = readFileSync(fileURLToPath(new URL('../prompt/extract.md', import.meta.url)), 'utf8')

const TRUNCATION_MARK = '\n[truncated: the page is longer than this]'

export interface SourceFetch {
  readonly sourceId: SourceId
  readonly url: string
  readonly status: number
  /** The body exactly as received, so extraction can be re-examined without refetching. */
  readonly rawBody: string
  readonly cleanedText: string
  readonly truncated: boolean
  readonly candidates: readonly Candidate[]
  /** Extracted rows that were unusable — no artist, no title, or an unreadable date. */
  readonly droppedRows: number
  /** Rows that were fine, and dated outside the run's window. */
  readonly outsideWindow: number
  readonly usage: Usage
  readonly cacheReported: boolean
  /** Present when the source disappointed: a bad status, nothing listed, or a bad extraction. */
  readonly warning?: string
}

/**
 * The model is asked for JSON and mostly obliges, but a fence around it is a
 * habit no instruction reliably breaks, so one is tolerated rather than refused.
 */
const jsonIn = (content: string): string => {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content)
  return (fenced?.[1] ?? content).trim()
}

const truncate = (text: string): { text: string; truncated: boolean } =>
  text.length <= MAX_SOURCE_TEXT_CHARS
    ? { text, truncated: false }
    : {
        text: `${text.slice(0, MAX_SOURCE_TEXT_CHARS - TRUNCATION_MARK.length)}${TRUNCATION_MARK}`,
        truncated: true,
      }

export const fetchSource = async (
  ports: Ports,
  sourceId: SourceId,
  window: DateWindow,
): Promise<SourceFetch> => {
  const url = SOURCES[sourceId]
  const response = await ports.http.get(url)

  const base = {
    sourceId,
    url,
    status: response.status,
    rawBody: response.body,
    candidates: [],
    droppedRows: 0,
    outsideWindow: 0,
    usage: NO_USAGE,
    cacheReported: true,
  } as const

  if (response.status < 200 || response.status >= 300) {
    // Not handed to the model: an error page extracts into nothing at best, and
    // into an invention at worst, and either way it costs a call to find out.
    return {
      ...base,
      cleanedText: '',
      truncated: false,
      warning: `${url} returned HTTP ${response.status}; no candidates from this source`,
    }
  }

  const { text: cleanedText, truncated } = truncate(htmlToText(response.body))

  const extraction = await ports.model.complete({
    messages: [
      { role: 'system', content: EXTRACT_PROMPT },
      {
        role: 'user',
        content: `Page: ${url}\nReturn only releases dated from ${window.from} to ${window.to} inclusive.\n\n${cleanedText}`,
      },
    ],
    tools: [],
  })

  const read = {
    ...base,
    cleanedText,
    truncated,
    usage: extraction.usage,
    cacheReported: extraction.cacheReported,
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonIn(extraction.content))
  } catch (error) {
    return { ...read, warning: `${url}: extraction was not valid JSON: ${(error as Error).message}` }
  }

  const result = extractionSchema.safeParse(parsed)
  if (!result.success) {
    return { ...read, warning: `${url}: extraction had the wrong shape: ${z.prettifyError(result.error)}` }
  }

  const usable = result.data.candidates
    .map((row) => normaliseCandidate(row, url))
    .filter((candidate): candidate is Candidate => candidate !== undefined)

  // The window is asked of the model and then enforced here, because a release
  // calendar covers a year: a page the model read generously would otherwise
  // hand the loop twelve months of releases and resend them at every step.
  const candidates = usable.filter((candidate) => withinWindow(candidate, window))

  return {
    ...read,
    candidates,
    droppedRows: result.data.candidates.length - usable.length,
    outsideWindow: usable.length - candidates.length,
    // A source that normally yields candidates and yields none is the only
    // detector of a silent redesign (ADR-0003), so it is never left implicit.
    ...(candidates.length === 0
      ? {
          warning:
            usable.length === 0
              ? `${url} yielded no candidates; the page may have changed shape`
              : `${url} listed ${usable.length} releases, none inside ${window.from}..${window.to}`,
        }
      : {}),
  }
}
