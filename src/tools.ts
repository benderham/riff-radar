/**
 * The actions, declared once each.
 *
 * Name, description, input schema and implementation sit together, and the JSON
 * tool schema sent to the model is derived from the schema rather than kept
 * alongside it — two copies of a contract drift, and the copy that drifts is
 * always the one the model reads.
 *
 * An action receives a `ToolContext`: the ports it needs, the store it records
 * evidence in, and the run's candidates so far. The candidate list is the run's
 * working memory — the one thing an action may add to — and it lives here
 * rather than in the loop because the loop's subject is termination, not music.
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import type { SourceId } from '../config.ts'
import { MAX_SEARCH_QUERY_CHARS, SOURCES } from '../config.ts'
import { lookupRelease } from './clients/musicbrainz.ts'
import { searchWeb } from './clients/search.ts'
import { fetchSource } from './clients/sources.ts'
import type { Candidate } from './domain/candidates.ts'
import {
  artistTitleIdentity,
  candidateIdentity,
  collapseByReleaseGroup,
  dropSuppressed,
  mergeCandidates,
  releaseIdentityOf,
} from './domain/candidates.ts'
import { isEligible } from './domain/eligibility.ts'
import type { FailureCategory } from './domain/failure.ts'
import { optionalCategory } from './domain/failure.ts'
import type { Usage } from './domain/cost.ts'
import type { ShortlistItem } from './domain/shortlist.ts'
import { shortlistItemSchema } from './domain/shortlist.ts'
import type { TasteProfile } from './domain/taste-profile.ts'
import type { DateWindow } from './domain/window.ts'
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
      /** What kind of external thing produced that warning, when one did (ADR-0048). */
      readonly failureCategory?: FailureCategory
    }
  | { readonly done: true; readonly shortlist: readonly ShortlistItem[] }

/** What an action is given: the outside world, the trace, and the run so far. */
export interface ToolContext {
  readonly ports: Ports
  readonly store: Store
  readonly runId: string
  /** The dates this run covers. Discovery is scoped to it. */
  readonly window: DateWindow
  /** Authenticates the search provider. Travels in a header, never into the trace. */
  readonly searchApiKey: string
  /**
   * Release identities Notion already holds, in both forms. Read once before
   * the run and never added to: this is memory, not a finding (ADR-0009).
   */
  readonly suppressed: ReadonlySet<string>
  /** What Ben wants, so a lookup can tell the model whether what it found qualifies. */
  readonly profile: TasteProfile
  /**
   * Whether this run has given up on MusicBrainz (ADR-0052). Set by the loop
   * after two consecutive silent lookups, and never unset: a provider that has
   * gone quiet twice is not asked again this run.
   */
  degraded: boolean
  /** The run's candidates, deduplicated on release identity. Actions may add. */
  candidates: readonly Candidate[]
}

interface Tool<Schema extends z.ZodType> {
  readonly description: string
  readonly schema: Schema
  run(input: z.infer<Schema>, context: ToolContext): Dispatch | Promise<Dispatch>
}

const defineTool = <Schema extends z.ZodType>(tool: Tool<Schema>): Tool<Schema> => tool

/**
 * What a degraded run can no longer check, named rather than left to be
 * inferred (ADR-0052). Three things go: MusicBrainz's release-group date, which
 * is what tells a reissue or a remaster from new work; its track count and
 * duration, which is what an EP has to clear; and its label, genres and
 * personnel, which are three of the profile's ranking terms.
 */
const DEGRADED_NOTE =
  "the source's stated format, as an untyped release group already is. No reissue or remaster " +
  'detection, no EP track-count or duration thresholds, and the label, genre and personnel terms ' +
  'drop out of the ranking.'

const DEGRADED_WARNING = `MusicBrainz is unavailable for the rest of this run; releases are judged on ${DEGRADED_NOTE}`

export const tools = {
  fetch_source: defineTool({
    description:
      'Fetch one configured release source and return the releases it lists, merged with everything already found this run. Discovery starts here: every candidate must originate from a source fetch.',
    schema: z.object({
      source_id: z.enum(Object.keys(SOURCES) as [SourceId, ...SourceId[]]),
    }),
    run: async ({ source_id }, context) => {
      const fetched = await fetchSource(context.ports, source_id, context.window)

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

      // Suppressed here rather than at `finish`, so a release Notion already
      // holds is never offered to the model at all: re-running a week proposes
      // nothing twice, and nothing is spent looking up what would be dropped.
      const merged = mergeCandidates(context.candidates, fetched.candidates)
      context.candidates = dropSuppressed(merged, context.suppressed)
      const suppressed = merged.length - context.candidates.length

      const warning = fetched.warning === undefined ? {} : { warning: fetched.warning }
      // The category belongs to the step and not to the model's reading of it:
      // it is a fact about the call, and the model is told what happened in
      // words, as it always was.
      const category = optionalCategory(fetched.failureCategory)

      return {
        done: false,
        usage: fetched.usage,
        cacheReported: fetched.cacheReported,
        ...warning,
        ...category,
        // The model is handed candidates rather than the page. The candidates
        // are the merged set rather than this page's, because `finish` needs
        // every source URL a release was seen on — but a page is an order of
        // magnitude larger than the releases on it, and it would be resent on
        // every subsequent step rather than on the three that fetch.
        result: JSON.stringify({
          source: fetched.sourceId,
          url: fetched.url,
          found: fetched.candidates.length,
          truncated: fetched.truncated,
          ...(suppressed === 0 ? {} : { alreadyProposed: suppressed }),
          newThisFetch: context.candidates.length - before,
          totalCandidates: context.candidates.length,
          ...warning,
          candidates: context.candidates.map((candidate) => ({
            ...candidate,
            ...(candidate.releaseDates.length > 1
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
    run: async ({ artist, title }, context) => {
      // A run that has given up asks nothing and says so. The request is not
      // made rather than made and ignored: three attempts against a provider
      // that is down cost seven seconds to learn what the last two lookups
      // already established (ADR-0052).
      const found = context.degraded ? undefined : await lookupRelease(context.ports, artist, title)

      // A lookup enriches a candidate a source already listed; it never adds
      // one. Asked about a release no source produced, it answers the model and
      // changes nothing, exactly as `web_search` does (ADR-0032).
      const identity = artistTitleIdentity(artist, title)

      // A lookup that failed is not a lookup. Recording `found: false` for a
      // service that was briefly down would mark the release Unverified, and an
      // Unverified release is judged on the source's own word about its format
      // — so a stumble at MusicBrainz could let a live album through (ADR-0034).
      const failed = found === undefined || (found.lookup.found === false && found.warning !== undefined)
      if (found !== undefined && !failed) {
        // Collapsing after enriching, because the proof that two candidates are
        // one release is exactly what this lookup just produced.
        context.candidates = dropSuppressed(
          collapseByReleaseGroup(
            context.candidates.map((candidate) =>
              candidateIdentity(candidate) === identity ? { ...candidate, lookup: found.lookup } : candidate,
            ),
          ),
          // The lookup may have just given a candidate the identity Notion
          // knows it by, which artist and title alone did not match.
          context.suppressed,
        )
      }

      // The model reads `musicbrainzId`; the same id under a second name and a
      // `found: true` beside it are two more ways of saying one thing.
      let facts: Record<string, unknown> = { unverified: true }
      if (found === undefined) {
        facts = { musicbrainzUnavailable: true, judgedOn: DEGRADED_NOTE }
      } else if (found.lookup.found) {
        const { found: _matched, releaseGroupId, ...rest } = found.lookup
        facts = { musicbrainzId: releaseGroupId, ...rest }
      }

      // The verdict, at the moment it becomes knowable.
      //
      // The rules are enforced at `finish` and stay there (ADR-0035), but a
      // model that cannot see them spends its shortlist on releases the
      // validator will refuse — and it did: two runs in a row died on a release
      // whose lookup looked perfect from here, because MusicBrainz states no
      // type for it and the absence of a field is not a signal anyone can read.
      // The guardrail is unchanged; what changes is that the model is told.
      const judged = context.candidates.find(
        (candidate) => candidateIdentity(candidate) === identity || releaseIdentityOf(candidate) === identity,
      )
      const verdict =
        judged === undefined
          ? undefined
          : isEligible(judged, context.window, context.profile, context.degraded)

      // A degraded lookup is a failure of the same kind as the ones that caused
      // it — `unavailable` is the category for a provider this run has stopped
      // knocking at (ADR-0048) — so the trailing run of silent lookups keeps
      // growing and a resume recomputes the same verdict from the trace.
      const warning = found === undefined ? DEGRADED_WARNING : found.warning
      const category = found === undefined ? 'unavailable' as const : found.failureCategory

      return {
        done: false,
        ...(warning === undefined ? {} : { warning }),
        ...optionalCategory(category),
        result: JSON.stringify({
          artist,
          title,
          ...(warning === undefined ? {} : { warning }),
          ...facts,
          ...(verdict === undefined
            ? {}
            : verdict.eligible
              ? { eligible: true }
              : { eligible: false, ineligibleBecause: verdict.reason, doNotShortlist: true }),
        }),
      }
    },
  }),

  web_search: defineTool({
    description:
      'Search the web to enrich or disambiguate a candidate that a source already produced. It never originates a candidate.',
    schema: z.object({ query: z.string().min(1).max(MAX_SEARCH_QUERY_CHARS) }),
    run: async ({ query }, context) => {
      const search = await searchWeb(context.ports, query, context.searchApiKey)

      // The results are returned and nothing else happens to them. There is no
      // path from here into `context.candidates`, which is what makes "a search
      // never originates a candidate" a fact about the code rather than an
      // instruction in the prompt; `validateShortlist` closes the other end.
      //
      // A warning is returned twice on purpose: once for the step's own column,
      // and once inside the result, because the model reads only the result.
      return {
        done: false,
        ...(search.warning === undefined ? {} : { warning: search.warning }),
        ...optionalCategory(search.failureCategory),
        result: JSON.stringify({
          query,
          found: search.results.length,
          ...(search.warning === undefined ? {} : { warning: search.warning }),
          results: search.results,
        }),
      }
    },
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
