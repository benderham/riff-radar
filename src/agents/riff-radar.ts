/**
 * The run, and the loop at the heart of it.
 *
 * This file is meant to be readable top to bottom (ADR-0015): the model chooses
 * one action per step, the action is validated before it is dispatched, the
 * step is recorded, and the run ends for exactly one recorded reason. Nothing
 * here is delegated to a framework, because the loop is the thing the project
 * exists to learn.
 *
 * Four ceilings bound it, each mapping to one termination reason: thirty steps,
 * three consecutive invalid actions, a cost ceiling, and an unrecoverable tool
 * or model failure. The Notion write is post-loop code, never an action
 * (ADR-0005), and happens only when the reason permits it.
 */

import { randomUUID } from 'node:crypto'

import {
  ACTION_SCHEMA_VERSION,
  INVALID_ACTION_LIMIT,
  MAX_RUN_COST_USD,
  MAX_STEPS,
  MODEL_ID,
  PROMPT_VERSION,
  SHORTLIST_SIZE,
} from '../../config.ts'
import type { CliArgs } from '../domain/cli-args.ts'
import type { Usage } from '../domain/cost.ts'
import { NO_USAGE, addUsage, estimateCost } from '../domain/cost.ts'
import type { TerminationReason } from '../domain/run.ts'
import { WRITE_PERMITTED } from '../domain/run.ts'
import type { ShortlistItem } from '../domain/shortlist.ts'
import { validateShortlist } from '../domain/shortlist.ts'
import type { TasteProfile } from '../domain/taste-profile.ts'
import type { DateWindow } from '../domain/window.ts'
import { resolveWindow } from '../domain/window.ts'
import type { ModelMessage, Ports, ProposedToolCall } from '../ports.ts'
import { runBrief, stablePrefix } from '../prompt/prompt.ts'
import type { RecordedStep, Store } from '../store/store.ts'
import type { Dispatch, ToolContext } from '../tools.ts'
import { dispatch, toolDefinitions, validateAction } from '../tools.ts'

export interface RunRequest {
  readonly args: CliArgs
  readonly ports: Ports
  readonly store: Store
  readonly profile: TasteProfile
  /** The search provider's key. Read from the environment by the CLI, never stored. */
  readonly searchApiKey: string
}

export interface RunOutcome {
  readonly runId: string
  readonly window: DateWindow
  readonly terminationReason: TerminationReason
  readonly shortlistSize: number
  readonly notionWritePerformed: boolean
  readonly usage: Usage
  readonly estimatedCost: number
  readonly costIsUpperBound: boolean
  readonly stepCount: number
}

/** A step's record, minus what every step fills in the same way. */
type StepFields = Omit<
  RecordedStep,
  'stepId' | 'runId' | 'stepIndex' | 'timestamp' | 'durationMs' | 'cost'
>

const EMPTY_STEP: StepFields = {
  kind: 'action',
  modelResponse: null,
  proposedAction: null,
  validationResult: null,
  dispatchedAction: null,
  toolName: null,
  toolArgs: null,
  toolResult: null,
  error: null,
  warning: null,
  ...NO_USAGE,
}

export const runRiffRadar = async ({
  args,
  ports,
  store,
  profile,
  searchApiKey,
}: RunRequest): Promise<RunOutcome> => {
  // Resolve first. A window that cannot be resolved is not a run, and must not
  // leave a half-started row behind.
  const startedAt = ports.clock.now()
  const window = resolveWindow(startedAt, args.lastDays)

  const runId = randomUUID()
  store.startRun({
    runId,
    startedAt: startedAt.toISOString(),
    cliArgs: args.raw,
    resolvedFrom: window.from,
    resolvedTo: window.to,
    promptVersion: PROMPT_VERSION,
    profileVersion: profile.version,
    actionSchemaVersion: ACTION_SCHEMA_VERSION,
    modelId: MODEL_ID,
  })

  // The stable prefix never moves: everything that varies is appended after it.
  const messages: ModelMessage[] = [stablePrefix(profile), runBrief(window)]

  // The run's working memory. Actions read and add to it; the loop only passes
  // it along, because what the run has found is not what the loop is about.
  const context: ToolContext = { ports, store, runId, window, searchApiKey, candidates: [] }

  let usage: Usage = NO_USAGE
  let costIsUpperBound = false
  let consecutiveInvalid = 0
  let stepIndex = 0

  let terminationReason: TerminationReason | undefined
  let shortlist: readonly ShortlistItem[] = []

  const recordStep = (fields: StepFields, at: Date, durationMs: number): void => {
    store.recordStep({
      stepId: randomUUID(),
      runId,
      stepIndex: stepIndex++,
      timestamp: at.toISOString(),
      durationMs,
      ...fields,
      cost: estimateCost(fields),
    })
  }

  // ── The loop ───────────────────────────────────────────────────────────────
  while (terminationReason === undefined) {
    // Both ceilings are tested before the call and in a fixed order, because
    // exactly one reason is recorded: a run that hits both records the step
    // ceiling, and which one it records must not depend on timing.
    if (stepIndex >= MAX_STEPS) {
      terminationReason = 'max_steps_exceeded'
      break
    }
    if (estimateCost(usage) >= MAX_RUN_COST_USD) {
      terminationReason = 'budget_exceeded'
      break
    }

    const at = ports.clock.now()
    const started = at.getTime()
    const elapsed = (): number => ports.clock.now().getTime() - started

    let response
    try {
      response = await ports.model.complete({ messages, tools: toolDefinitions })
    } catch (error) {
      recordStep(
        { ...EMPTY_STEP, kind: 'model_error', error: (error as Error).message },
        at,
        elapsed(),
      )
      // The spec's table has no reason of its own for a model failure, and this
      // is the nearest true one: the run could not continue and wrote nothing.
      terminationReason = 'tool_failure'
      break
    }

    usage = addUsage(usage, response.usage)
    costIsUpperBound ||= !response.cacheReported

    const step: StepFields = {
      ...EMPTY_STEP,
      ...response.usage,
      modelResponse: JSON.stringify(response.raw),
    }

    // Every step records what the model proposed in the same shape — a list,
    // even when it holds one — so the column reads the same way whether the
    // step was dispatched or refused.
    const proposed = JSON.stringify(
      response.toolCalls.map((each) => ({ name: each.name, arguments: each.argumentsJson })),
    )

    /**
     * One invalid action: recorded with its proposal and without a dispatch, so
     * the guardrail is visible in the trace (ADR-0012), returned to the model so
     * it can correct itself, and counted towards the consecutive limit.
     */
    const rejectAction = (error: string, call?: ProposedToolCall): void => {
      consecutiveInvalid += 1
      recordStep(
        {
          ...step,
          kind: 'invalid_action',
          proposedAction: proposed,
          validationResult: error,
          toolName: call?.name ?? null,
          toolArgs: call?.argumentsJson ?? null,
          error,
        },
        at,
        elapsed(),
      )

      messages.push({
        role: 'assistant',
        content: response.content,
        ...(call === undefined ? {} : { toolCalls: [call] }),
      })
      messages.push(
        call === undefined
          ? { role: 'user', content: `Invalid action: ${error}` }
          : { role: 'tool', toolCallId: call.id, content: `Invalid action, not dispatched: ${error}` },
      )

      if (consecutiveInvalid >= INVALID_ACTION_LIMIT) terminationReason = 'invalid_action_limit'
    }

    // Prose where an action was required, and two actions where one was, are
    // both invalid actions. Neither is dropped quietly: a proposal the run
    // refused has to be in the trace, or the guardrail is invisible.
    const [call, ...extraCalls] = response.toolCalls
    if (call === undefined) {
      rejectAction('no action proposed; every step must call exactly one tool')
      continue
    }
    if (extraCalls.length > 0) {
      rejectAction(
        `${response.toolCalls.length} actions proposed; every step must call exactly one tool`,
      )
      continue
    }

    const validation = validateAction(call)

    // Arguments are untrusted (ADR-0016): parse, then validate, before dispatch.
    if (!validation.ok) {
      rejectAction(validation.error, call)
      continue
    }

    consecutiveInvalid = 0
    const dispatchedAction = JSON.stringify({ name: validation.name, input: validation.input })

    let outcome: Dispatch
    try {
      outcome = await dispatch(validation.name, validation.input, context)
    } catch (error) {
      recordStep(
        {
          ...step,
          kind: 'tool_error',
          proposedAction: proposed,
          validationResult: 'valid',
          dispatchedAction,
          toolName: validation.name,
          toolArgs: call.argumentsJson,
          error: (error as Error).message,
        },
        at,
        elapsed(),
      )
      terminationReason = 'tool_failure'
      break
    }

    if (outcome.done) {
      shortlist = outcome.shortlist

      // An empty shortlist is the model reporting a quiet week, not a broken
      // one (ADR-0025): nothing eligible was found, and that is a real answer,
      // so it never reaches the validator, whose rule is one to five items.
      // Validated against what the run actually discovered, so a release the
      // model met in a web search rather than on a source cannot reach Notion.
      const result =
        shortlist.length === 0
          ? undefined
          : validateShortlist(shortlist, window, context.candidates)

      terminationReason =
        result === undefined
          ? 'no_candidates'
          : !result.ok
            ? 'validation_failed'
            : shortlist.length === SHORTLIST_SIZE
              ? 'completed'
              : 'completed_short'

      recordStep(
        {
          ...step,
          kind: 'finish',
          proposedAction: proposed,
          validationResult: 'valid',
          dispatchedAction,
          toolName: validation.name,
          toolArgs: call.argumentsJson,
          toolResult: JSON.stringify({ terminationReason, shortlist }),
          error: result === undefined || result.ok ? null : result.errors.join('; '),
        },
        at,
        elapsed(),
      )
      break
    }

    // An action that called the model of its own — extraction does — is priced
    // like any other call, on the step that dispatched it. Leaving it out would
    // make the cost ceiling unenforceable exactly where the tokens are.
    if (outcome.usage !== undefined) {
      usage = addUsage(usage, outcome.usage)
      costIsUpperBound ||= outcome.cacheReported === false
    }

    recordStep(
      {
        ...step,
        ...addUsage(response.usage, outcome.usage ?? NO_USAGE),
        proposedAction: proposed,
        validationResult: 'valid',
        dispatchedAction,
        toolName: validation.name,
        toolArgs: call.argumentsJson,
        toolResult: outcome.result,
        // A source that yielded nothing is a warning, not a failure (ADR-0030):
        // the run continues on its other sources, and the trace says what was
        // missed in a column of its own, so nothing reads it as a failed step.
        warning: outcome.warning ?? null,
      },
      at,
      elapsed(),
    )
    messages.push(
      { role: 'assistant', content: response.content, toolCalls: [call] },
      { role: 'tool', toolCallId: call.id, content: outcome.result },
    )
  }
  // ── End of the loop ────────────────────────────────────────────────────────

  const shortlistSize = WRITE_PERMITTED.includes(terminationReason) ? shortlist.length : 0

  // The write is post-loop code, never a model action (ADR-0005), and it does
  // not exist yet: the Notion client arrives in ticket 06. Until then a run
  // records honestly that it wrote nothing, whatever the flags said.
  // `args.dryRun` is deliberately unread until there is a write for it to block.
  const notionWritePerformed = false

  const estimatedCost = estimateCost(usage)
  store.finishRun({
    runId,
    endedAt: ports.clock.now().toISOString(),
    terminationReason,
    ...usage,
    estimatedCost,
    shortlistSize,
    notionWritePerformed,
    costIsUpperBound,
  })

  return {
    runId,
    window,
    terminationReason,
    shortlistSize,
    notionWritePerformed,
    usage,
    estimatedCost,
    costIsUpperBound,
    stepCount: stepIndex,
  }
}
