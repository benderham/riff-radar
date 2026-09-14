/**
 * The actions, declared once each.
 *
 * Name, description, input schema and implementation sit together, and the JSON
 * tool schema sent to the model is derived from the schema rather than kept
 * alongside it — two copies of a contract drift, and the copy that drifts is
 * always the one the model reads.
 *
 * Three of the four are fakes in this ticket. They return canned data so that
 * the loop, its guardrails and its trace can be exercised end to end before any
 * live integration exists; tickets 02–04 replace the bodies and nothing else.
 * `finish` is real: it hands its items back to the loop, which validates them.
 */

import { z } from 'zod'

import type { SourceId } from '../config.ts'
import { SOURCES } from '../config.ts'
import type { ShortlistItem } from './domain/shortlist.ts'
import { shortlistItemSchema } from './domain/shortlist.ts'
import type { ProposedToolCall, ToolDefinition } from './ports.ts'

/**
 * What a dispatched action produced: text to hand back to the model, or the
 * end of the run. `finish` is the only action that ends it, and Notion writing
 * is not an action at all (ADR-0005).
 */
export type Dispatch =
  | { readonly done: false; readonly result: string }
  | { readonly done: true; readonly shortlist: readonly ShortlistItem[] }

interface Tool<Schema extends z.ZodType> {
  readonly description: string
  readonly schema: Schema
  run(input: z.infer<Schema>): Dispatch
}

const defineTool = <Schema extends z.ZodType>(tool: Tool<Schema>): Tool<Schema> => tool

const FAKE_SOURCE_TEXT = [
  'Recent metal releases',
  '2026-09-09 — Nocturnal Rite — Hollow Crown (Century Media) — full-length',
  '2026-09-10 — Blood Incantation — Absolute Elsewhere (Dark Descent) — full-length',
  '2026-09-11 — Chat Pile — Cool World (The Flenser) — full-length',
  '2026-09-12 — Gatecreeper — Dark Superstition (Nuclear Blast) — full-length',
  '2026-09-12 — Ulcerate — Cutting the Throat of God (Debemur Morti) — full-length',
  '2026-09-13 — Sumac — Live at Roadburn (Thrill Jockey) — live album',
].join('\n')

export const tools = {
  fetch_source: defineTool({
    description:
      'Fetch one configured release source and return its cleaned text. Discovery starts here: every candidate must originate from a source fetch.',
    schema: z.object({
      source_id: z.enum(Object.keys(SOURCES) as [SourceId, ...SourceId[]]),
    }),
    run: ({ source_id }) => ({
      done: false,
      // ponytail: canned text, replaced by a real fetch in ticket 02.
      result: `[fake ${source_id}]\n${FAKE_SOURCE_TEXT}`,
    }),
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
export const dispatch = (name: ToolName, input: unknown): Dispatch =>
  (tools[name].run as (input: unknown) => Dispatch)(input)
