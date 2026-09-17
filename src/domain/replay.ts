/**
 * Rebuilding a run's working memory from its own trace.
 *
 * The trace is the checkpoint (ADR-0046). `steps` already records what the
 * model said, what was dispatched, what came back and what it cost, so a resume
 * replays those columns rather than reading a second copy of the run that could
 * disagree with the first.
 *
 * Six things come back out: the message history, the candidate list, the
 * accumulated usage, the consecutive-invalid count, the run of silent
 * MusicBrainz lookups and the repairs already spent at finish. Only the
 * candidate list is stored; the rest are derived here, which is what this file
 * exists to make provable.
 *
 * Pure. A trace it cannot read is refused whole rather than replayed in part,
 * because a run that cannot be reconstructed is also a run that cannot be
 * explained — and refused as a `ResumeRefusal`, because it happens before the
 * run row, where nothing has been spent and the CLI reports rather than crashes.
 */

import { z } from 'zod'

import type { Candidate } from './candidates.ts'
import type { Usage } from './cost.ts'
import type { FailureCategory } from './failure.ts'
import { NO_USAGE, addUsage } from './cost.ts'
import { ResumeRefusal } from './run.ts'
import type { ModelMessage, ProposedToolCall } from '../ports.ts'
import type { TracedStep } from '../store/store.ts'

/**
 * What `steps.model_response` holds, and the one function that writes it.
 *
 * It carries the provider's body under `raw` — the trace's evidence of what
 * arrived — beside the parsed halves the loop actually appended to its message
 * history. Both, because rebuilding an assistant message out of `raw` would
 * make the resume depend on one provider's wire format, and evidence that only
 * one adapter can read is not evidence.
 */
export const recordedModelResponse = (response: {
  readonly content: string
  readonly toolCalls: readonly ProposedToolCall[]
  readonly raw: unknown
}): string =>
  JSON.stringify({ content: response.content, toolCalls: response.toolCalls, raw: response.raw })

const modelResponseSchema = z.object({
  content: z.string(),
  toolCalls: z.array(z.object({ id: z.string(), name: z.string(), argumentsJson: z.string() })),
})

/**
 * Enough of a candidate to know the column holds candidates, and no more.
 * Loose on purpose: the `lookup` enrichment is the reason this is stored at all
 * (ADR-0046), and a schema that listed its fields would be a second copy of the
 * type, drifting, for no gain — this guard is here to catch a column that is
 * not a candidate list, not to re-describe one.
 */
const candidatesSchema = z.array(
  z.looseObject({
    artist: z.string(),
    title: z.string(),
    releaseDates: z.array(z.string()),
    sourceUrls: z.array(z.string()),
  }),
)

/**
 * What the model is told when its action was refused, in the two shapes it can
 * arrive in: answering a call it made, or answering the step it did not.
 *
 * Exported because the loop says it and the replay says it again: two copies of
 * this sentence would drift, and the drift would be a replayed conversation
 * that differs from the one the model actually had.
 */
export const refusalMessage = (error: string, callId?: string): ModelMessage =>
  callId === undefined
    ? { role: 'user', content: `Invalid action: ${error}` }
    : { role: 'tool', toolCallId: callId, content: `Invalid action, not dispatched: ${error}` }

/**
 * What the model is told when its shortlist was refused (ADR-0053).
 *
 * Deliberately not `refusalMessage`: that one says the action was not
 * dispatched, and a refused `finish` was. What the validator rejected is the
 * shortlist, not the call, and the difference is the whole instruction — the
 * model is being asked to send a corrected list, not a different action.
 *
 * Exported for the same reason as its sibling: the loop says it and the replay
 * says it again.
 */
export const shortlistRefusalMessage = (errors: string, callId: string): ModelMessage => ({
  role: 'tool',
  toolCallId: callId,
  content:
    `The shortlist was refused and nothing was written: ${errors}. ` +
    'Call finish once more with the items corrected or dropped. There is no third attempt.',
})

/**
 * Whether a lookup got no answer, and so counts towards giving up on
 * MusicBrainz (ADR-0052).
 *
 * Exported because the loop counts these as they happen and a resume counts the
 * same steps back out of the trace, and two spellings of one rule would let a
 * resumed run disagree with the run it continues. `not_found` is absent on
 * purpose: a 404 is an answer, and the provider that gave it is up.
 */
export const wentSilent = (category: FailureCategory | null | undefined): boolean =>
  category === 'transient' || category === 'unavailable'

export interface Replayed {
  /** Appended after the stable prefix and the run brief, in the order they happened. */
  readonly messages: readonly ModelMessage[]
  readonly candidates: readonly Candidate[]
  readonly usage: Usage
  readonly consecutiveInvalid: number
  /**
   * The unbroken run of silent lookups at the end of the trace. Two is enough
   * to keep a resumed run degraded, which is why it is counted rather than
   * stored: a degraded lookup records `unavailable` like the failures that
   * caused it, so the run only grows.
   */
  readonly consecutiveLookupFailures: number
  /**
   * How many shortlists the validator has refused in this chain, which is how
   * many repairs have been spent (ADR-0053). One is the limit, and it is
   * counted rather than stored for the same reason the rest of this is: a
   * refused `finish` is already a recorded step carrying the errors it was
   * told.
   */
  readonly shortlistRefusals: number
}

const parseJson = <T>(schema: z.ZodType<T>, json: string, what: string): T => {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    throw new ResumeRefusal(`this run cannot be replayed: ${what} is not readable JSON`)
  }

  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new ResumeRefusal(`this run cannot be replayed: ${what} is not what it should be`)
  }
  return parsed.data
}

/**
 * A finish the validator refused, as against one that ended its run. The error
 * column is the difference and no new kind is needed: a finish that completed,
 * or reported a quiet week, has nothing to say there.
 *
 * A trace can hold two of these — the repair and the second refusal that ended
 * the run — which is why the count is what the repair budget reads, and why
 * only the first of them said anything to the model.
 */
const wasRefused = (step: TracedStep): boolean => step.kind === 'finish' && step.error !== null

/**
 * The two messages one step added to the history, or none.
 *
 * A step that answered the model contributes what the model said and what it
 * was told back. A step the loop broke on — a failed tool, a failed model call,
 * a finish that ended its run, the Notion write — told the model nothing, so it
 * contributes nothing and the resumed run simply takes it again. Replaying half
 * of it would leave a proposed call with no answer, which is a conversation no
 * provider accepts.
 *
 * The exception is the one repaired finish, which did answer: it handed the
 * validator's errors back and the run carried on (ADR-0053). Only the first
 * refusal in a chain did that — a second is what ends the run, and replaying it
 * as an invitation to try again would be a history that never happened.
 */
const messagesOf = (step: TracedStep, repaired: boolean): ModelMessage[] => {
  if (step.kind !== 'action' && step.kind !== 'invalid_action' && !repaired) return []
  if (step.modelResponse === null) return []

  const { content, toolCalls } = parseJson(modelResponseSchema, step.modelResponse, 'a model response')

  // One call is the only shape the loop hands back as a tool message: prose
  // where an action was required, and two actions where one was, were both
  // refused to the model as plain text, and the replay says the same thing.
  const [call] = toolCalls.length === 1 ? toolCalls : []

  const said: ModelMessage = {
    role: 'assistant',
    content,
    ...(call === undefined ? {} : { toolCalls: [call] }),
  }

  if (repaired) {
    return call === undefined ? [] : [said, shortlistRefusalMessage(step.error ?? '', call.id)]
  }

  if (step.kind === 'action') {
    return call === undefined
      ? []
      : [said, { role: 'tool', toolCallId: call.id, content: step.toolResult ?? '' }]
  }

  return [said, refusalMessage(step.error ?? '', call?.id)]
}

export const replay = (steps: readonly TracedStep[]): Replayed => {
  // The one refusal that was handed back rather than final, by position: the
  // budget is one, so a second refused finish is the run ending.
  const repairedAt = steps.findIndex(wasRefused)

  const latest = steps.map((step) => step.candidatesAfter).findLast((each) => each !== null)

  // Trailing, not total: the counter the loop keeps resets on every valid
  // action, so what a resume inherits is the unbroken run at the end.
  const trailing = steps.length - 1 - steps.findLastIndex((step) => step.kind !== 'invalid_action')

  // Only dispatched lookups are consulted. A fetch or a search between two
  // silent lookups neither counts nor clears, and neither does a lookup the
  // loop refused before dispatch: `invalid_action` records the tool the model
  // named, but nothing was asked of MusicBrainz, so reading it as an answer
  // would start a degraded run knocking again.
  const lookups = steps.filter((step) => step.kind === 'action' && step.toolName === 'lookup_release')
  const answered = lookups.findLastIndex((step) => !wentSilent(step.failureCategory))

  return {
    messages: steps.flatMap((step, index) => messagesOf(step, index === repairedAt)),
    candidates:
      latest === undefined
        ? []
        : (parseJson(candidatesSchema, latest, 'a candidate list') as readonly Candidate[]),
    usage: steps.reduce<Usage>(addUsage, NO_USAGE),
    consecutiveInvalid: trailing,
    consecutiveLookupFailures: lookups.length - 1 - answered,
    shortlistRefusals: steps.filter(wasRefused).length,
  }
}
