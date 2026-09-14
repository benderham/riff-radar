/**
 * The actions, declared once each.
 *
 * Name, description, input schema and implementation sit together, and the JSON
 * tool schema sent to the model is derived from the schema rather than kept
 * alongside it — two copies of a contract drift, and the copy that drifts is
 * always the one the model reads.
 *
 * `fetch_source` and `finish` are real. `lookup_release` and `web_search` are
 * still fakes returning canned data, so that the loop and its trace stay
 * exercisable end to end; tickets 03 and 04 replace those two bodies and
 * nothing else.
 *
 * An action receives a `ToolContext`: the ports it needs, the store it records
 * evidence in, and the run's candidates so far. The candidate list is the run's
 * working memory — the one thing an action may add to — and it lives here
 * rather than in the loop because the loop's subject is termination, not music.
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import type { SourceId } from '../config.ts'
import { SOURCES } from '../config.ts'
import { fetchSource } from './clients/sources.ts'
import type { Candidate } from './domain/candidates.ts'
import { hasDateDisagreement, mergeCandidates } from './domain/candidates.ts'
import type { Usage } from './domain/cost.ts'
import type { ShortlistItem } from './domain/shortlist.ts'
import { shortlistItemSchema } from './domain/shortlist.ts'
import type { Ports, ProposedToolCall, ToolDefinition } from './ports.ts'
import type { Store } from './store/store.ts'

/**
 * What a dispatched action produced: text to hand back to the model, or the
 * end of the run. `finish` is the only action that ends it, and Notion writing
 * is not an action at all (ADR-0005).
 */
export type Dispatch =
  | {
      readonly done: false
      readonly result: string
      /** Model calls an action made of its own, priced into the run like any other. */
      readonly usage?: Usage
      readonly cacheReported?: boolean
      /** Something the run should record but not stop for. */
      readonly warning?: string
    }
  | { readonly done: true; readonly shortlist: readonly ShortlistItem[] }

/** What an action is given: the outside world, the trace, and the run so far. */
export interface ToolContext {
  readonly ports: Ports
  readonly store: Store
  readonly runId: string
  /** The run's candidates, deduplicated on release identity. Actions may add. */
  candidates: readonly Candidate[]
}

interface Tool<Schema extends z.ZodType> {
  readonly description: string
  readonly schema: Schema
  run(input: z.infer<Schema>, context: ToolContext): Dispatch | Promise<Dispatch>
}

const defineTool = <Schema extends z.ZodType>(tool: Tool<Schema>): Tool<Schema> => tool

export const tools = {
  fetch_source: defineTool({
    description:
      'Fetch one configured release source and return the releases it lists, merged with everything already found this run. Discovery starts here: every candidate must originate from a source fetch.',
    schema: z.object({
      source_id: z.enum(Object.keys(SOURCES) as [SourceId, ...SourceId[]]),
    }),
    run: async ({ source_id }, context) => {
      const fetched = await fetchSource(context.ports, source_id)

      // Recorded before anything is returned, so a page that produced a bad
      // extraction is still in the trace to be re-examined.
      context.store.recordSourceText({
        sourceTextId: randomUUID(),
        runId: context.runId,
        sourceId: fetched.sourceId,
        url: fetched.url,
        fetchedAt: context.ports.clock.now().toISOString(),
        status: fetched.status,
        rawBody: fetched.rawBody,
        truncated: fetched.truncated,
        candidateCount: fetched.candidates.length,
        warning: fetched.warning ?? null,
      })

      const before = context.candidates.length
      context.candidates = mergeCandidates(context.candidates, fetched.candidates)

      const warning = fetched.warning === undefined ? {} : { warning: fetched.warning }

      return {
        done: false,
        usage: fetched.usage,
        cacheReported: fetched.cacheReported,
        ...warning,
        // The model is handed candidates rather than the page. The candidates
        // are the merged set rather than this page's, because `finish` needs
        // every source URL a release was seen on — but a page is an order of
        // magnitude larger than the releases on it, and it would be resent on
        // every subsequent step rather than on the three that fetch.
        result: JSON.stringify({
          source: fetched.sourceId,
          url: fetched.url,
          found: fetched.candidates.length,
          dropped: fetched.droppedRows,
          truncated: fetched.truncated,
          newThisFetch: context.candidates.length - before,
          totalCandidates: context.candidates.length,
          ...warning,
          candidates: context.candidates.map((candidate) => ({
            ...candidate,
            ...(hasDateDisagreement(candidate)
              ? { dateDisagreement: `sources disagree: ${candidate.releaseDates.join(', ')}` }
              : {}),
          })),
        }),
      }
    },
  }),

  lookup_release: defineTool({
    description:
      'Look a release up in MusicBrainz to confirm its identity and enrich it. Absence from MusicBrainz is missing evidence, not proof the release is invalid.',
    schema: z.object({
      artist: z.string().min(1),
      title: z.string().min(1),
    }),
    run: ({ artist, title }) => ({
      done: false,
      // ponytail: canned identity, replaced by a real client in ticket 04.
      result: JSON.stringify({
        artist,
        title,
        musicbrainzId: `fake-mbid-${title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`,
        firstReleaseDate: '2026-09-10',
        primaryType: 'Album',
      }),
    }),
  }),

  web_search: defineTool({
    description:
      'Search the web to enrich or disambiguate a candidate that a source already produced. It never originates a candidate.',
    schema: z.object({ query: z.string().min(1) }),
    run: ({ query }) => ({
      done: false,
      // ponytail: canned snippet, replaced in ticket 03.
      result: `[fake search] no additional evidence found for "${query}"`,
    }),
  }),

  finish: defineTool({
    description:
      'End the run with the final shortlist, ranked best first. Between one and five releases; a short week is a real answer and padding it is worse than reporting three.',
    schema: z.object({ shortlist: z.array(shortlistItemSchema) }),
    run: ({ shortlist }) => ({ done: true, shortlist }),
  }),
} as const

export type ToolName = keyof typeof tools

/** The tool definitions offered to the model, derived from the declarations. */
export const toolDefinitions: readonly ToolDefinition[] = Object.entries(tools).map(
  ([name, tool]) => ({
    name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.schema),
  }),
)

export type ActionValidation =
  | { readonly ok: true; readonly name: ToolName; readonly input: unknown }
  | { readonly ok: false; readonly error: string }

/**
 * Tool-call arguments are untrusted (ADR-0016): the model chooses the tool name
 * and emits the arguments as free text, and nothing upstream guarantees either.
 * Parse, then validate, before every dispatch. Both a malformed string and a
 * well-formed object of the wrong shape are ordinary failures here.
 */
export const validateAction = (call: ProposedToolCall): ActionValidation => {
  const tool = Object.hasOwn(tools, call.name) ? tools[call.name as ToolName] : undefined
  if (tool === undefined) {
    return { ok: false, error: `unknown action "${call.name}"; expected one of ${Object.keys(tools).join(', ')}` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(call.argumentsJson)
  } catch (error) {
    return { ok: false, error: `arguments are not valid JSON: ${(error as Error).message}` }
  }

  const result = tool.schema.safeParse(parsed)
  if (!result.success) return { ok: false, error: z.prettifyError(result.error) }

  return { ok: true, name: call.name as ToolName, input: result.data }
}

/** Dispatch a validated action. Only reachable through `validateAction`. */
export const dispatch = async (
  name: ToolName,
  input: unknown,
  context: ToolContext,
): Promise<Dispatch> =>
  (tools[name].run as (input: unknown, context: ToolContext) => Dispatch | Promise<Dispatch>)(
    input,
    context,
  )
