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
 *
 * A resume enters the same loop with its working memory replayed from the
 * parent's trace instead of empty (ADR-0046). Everything else about the start of
 * a run is identical, deliberately: the schema preflight and the suppression
 * read happen again, which is what lets a half-written parent correct itself.
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
import { dropSuppressed } from '../domain/candidates.ts'
import type { CliArgs } from '../domain/cli-args.ts'
import type { Usage } from '../domain/cost.ts'
import { NO_USAGE, addUsage, estimateCost } from '../domain/cost.ts'
import { categoryOf } from '../domain/failure.ts'
import { recordedModelResponse, refusalMessage, replay } from '../domain/replay.ts'
import { preflightSchema, proposeShortlist, suppressedReleases } from '../clients/notion.ts'
import { citedVibes, rankShortlist } from '../domain/ranking.ts'
import type { TerminationReason } from '../domain/run.ts'
import { ResumeRefusal, WRITE_PERMITTED } from '../domain/run.ts'
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
  /** Notion's integration token and database. Read from the environment, never stored. */
  readonly notionToken: string
  readonly notionDatabaseId: string
}

export interface RunOutcome {
  readonly runId: string
  readonly window: DateWindow
  readonly terminationReason: TerminationReason
  readonly shortlistSize: number
  /** The items, in the order they were ranked. Empty unless the reason permits a write. */
  readonly shortlist: readonly ShortlistItem[]
  readonly notionWritePerformed: boolean
  /** Present only when a permitted write was attempted and failed. */
  readonly notionWriteError?: string
  readonly usage: Usage
  readonly estimatedCost: number
  readonly costIsUpperBound: boolean
  readonly stepCount: number
}

/** A step's record, minus what every step fills in the same way. */
type StepFields = Omit<
  RecordedStep,
  'stepId' | 'runId' | 'stepIndex' | 'timestamp' | 'durationMs' | 'cost' | 'candidatesAfter'
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
  failureCategory: null,
  ...NO_USAGE,
}

export const runRiffRadar = async ({
  args,
  ports,
  store,
  profile,
  searchApiKey,
  notionToken,
  notionDatabaseId,
}: RunRequest): Promise<RunOutcome> => {
  // Resolve first. A window that cannot be resolved is not a run, and must not
  // leave a half-started row behind.
  const startedAt = ports.clock.now()

  // A resume is asked for explicitly and never inferred (ADR-0047). The parent
  // is read before anything else because its row is where the window comes
  // from: `--resume` takes none, and recomputing one from today's date would
  // quietly move the run being continued.
  const asked = args.resumeRunId === undefined ? [] : store.runsMatching(args.resumeRunId)
  if (args.resumeRunId !== undefined && asked.length !== 1) {
    throw new ResumeRefusal(
      asked.length === 0
        ? `no run ${args.resumeRunId} to resume`
        : `${args.resumeRunId} matches ${asked.length} runs: ${asked
            .map((each) => each.runId)
            .join(', ')}`,
    )
  }
  const parent = args.resumeRunId === undefined ? undefined : asked[0]

  const window =
    parent === undefined
      ? resolveWindow(startedAt, args.lastDays)
      : { from: parent.resolvedFrom, to: parent.resolvedTo }

  // The whole chain, oldest first, not just the run named on the command line:
  // a resume of a resume inherits the conversation and the spend of everything
  // before it, and replaying one link would lose the rest of the story.
  const ancestry = []
  for (let at = parent; at !== undefined; at = at.resumedFrom === null ? undefined : store.runOf(at.resumedFrom)) {
    ancestry.unshift(at)
  }

  // Replayed before the run row and before a token is spent, for the same
  // reason the two Notion reads are: a trace that cannot be rebuilt is not a
  // resume, and saying so costs nothing at this point.
  const replayed =
    parent === undefined ? undefined : replay(ancestry.flatMap((each) => store.stepsOf(each.runId)))

  // Before the run row, and before a token is spent: a database that is not the
  // one this writes to is a refusal, and the answer is the same whether it is
  // found now or after the loop (ticket 06). The agent never alters a schema.
  await preflightSchema(ports, notionToken, notionDatabaseId)

  // Before the run row, for the same reason: a suppression set that could not
  // be read is not a run at all. An unsuppressed run can propose what Notion
  // already holds, and this read is what makes the write idempotent by
  // construction (ADR-0039). It throws, and nothing has been spent.
  const suppressed = await suppressedReleases(ports, notionToken, notionDatabaseId)

  // The parent is closed before the child is started, so that exactly one
  // termination reason per run still holds and no run row ever changes its mind:
  // its work has been handed on, and the only honest thing left to say about it
  // is that it was aborted. Before, because a parent that cannot be closed — it
  // already ended, so this is a re-run rather than a resume — must not leave a
  // started child behind. Its accounting is the chain up to and including it,
  // which is what every run row in a chain holds (ADR-0050).
  if (parent !== undefined && replayed !== undefined) {
    store.abortRun({
      runId: parent.runId,
      endedAt: startedAt.toISOString(),
      ...replayed.usage,
      estimatedCost: estimateCost(replayed.usage),
    })
  }

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
    ...(parent === undefined ? {} : { resumedFrom: parent.runId }),
  })

  // The stable prefix never moves: everything that varies is appended after it.
  // A resume appends what the parent's trace says was said after it (ADR-0046).
  const messages: ModelMessage[] = [
    stablePrefix(profile),
    runBrief(window),
    ...(replayed?.messages ?? []),
  ]

  // The run's working memory. Actions read and add to it; the loop only passes
  // it along, because what the run has found is not what the loop is about.
  const context: ToolContext = {
    ports,
    store,
    runId,
    window,
    searchApiKey,
    suppressed,
    profile,
    // Suppression is re-read on a resume and applied to the replayed list, so a
    // release the parent proposed and wrote is not proposed twice (ADR-0051).
    candidates: dropSuppressed(replayed?.candidates ?? [], suppressed),
  }

  // The parent's spend and its unbroken run of refusals both carry over: they
  // are facts about the question being asked, not about the process asking it.
  let usage: Usage = replayed?.usage ?? NO_USAGE
  let costIsUpperBound = false
  let consecutiveInvalid = replayed?.consecutiveInvalid ?? 0
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
      // Every step, whatever kind: the column exists so a resume never has to
      // guess what the run held, and a step that skipped it would be a step
      // nobody could resume from (ADR-0046).
      candidatesAfter: JSON.stringify(context.candidates),
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
        {
          ...EMPTY_STEP,
          kind: 'model_error',
          error: (error as Error).message,
          // The reason says the run could not continue; the category says what
          // kind of thing stopped it, which is the half that used to be an
          // apology in a comment here (ADR-0048).
          failureCategory: categoryOf(error) ?? null,
        },
        at,
        elapsed(),
      )
      terminationReason = 'tool_failure'
      break
    }

    usage = addUsage(usage, response.usage)
    costIsUpperBound ||= !response.cacheReported

    const step: StepFields = {
      ...EMPTY_STEP,
      ...response.usage,
      modelResponse: recordedModelResponse(response),
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
      messages.push(refusalMessage(error, call?.id))

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
          failureCategory: categoryOf(error) ?? null,
        },
        at,
        elapsed(),
      )
      terminationReason = 'tool_failure'
      break
    }

    if (outcome.done) {
      // The profile decides the order, not the model (ADR-0037): it scores the
      // attributes of each release the model proposed, and the ranks are
      // rewritten from the result. The one judgement of the model's that counts
      // is its vibe note, and only where the quote is in a page this run stored.
      const ranked = rankShortlist(
        outcome.shortlist,
        context.candidates,
        profile,
        citedVibes(outcome.shortlist, store.sourceTextsOf(runId)),
      )
      shortlist = ranked.map((each) => each.item)

      // An empty shortlist is the model reporting a quiet week, not a broken
      // one (ADR-0025): nothing eligible was found, and that is a real answer,
      // so it never reaches the validator, whose rule is one to five items.
      // Validated against what the run actually discovered, so a release the
      // model met in a web search rather than on a source cannot reach Notion.
      const result =
        shortlist.length === 0
          ? undefined
          : validateShortlist(shortlist, window, context.candidates, profile)

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
          // The score breakdown is what makes the ranking arguable: every
          // contribution, with the profile term that caused it, beside the
          // order it produced.
          toolResult: JSON.stringify({
            terminationReason,
            shortlist,
            ranking: ranked.map(({ item, score }) => ({
              artist: item.artist,
              title: item.title,
              rank: item.rank,
              ...score,
            })),
          }),
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
        failureCategory: outcome.failureCategory ?? null,
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

  // ── The write ──────────────────────────────────────────────────────────────
  // Post-loop code, never a model action (ADR-0005). Six things block it, and
  // all six are already settled by the time this line runs: missing credentials
  // refused the run in the CLI, a database that does not match refused it above,
  // a failed validation and a wrong termination reason are the same fact —
  // `terminationReason` — and an empty shortlist makes `shortlistSize` zero.
  // What is left is the flag.
  // `shortlistSize` is already zero unless the termination reason permits a
  // write, so the reason is not tested twice.
  const mayWrite = !args.dryRun && shortlistSize > 0

  let notionWritePerformed = false
  let notionWriteError: string | undefined

  if (mayWrite) {
    const writeAt = ports.clock.now()
    try {
      const written = await proposeShortlist(ports, {
        token: notionToken,
        databaseId: notionDatabaseId,
        runId,
        shortlist,
      })
      notionWritePerformed = true
      recordStep(
        { ...EMPTY_STEP, kind: 'notion_write', toolResult: JSON.stringify({ written }) },
        writeAt,
        ports.clock.now().getTime() - writeAt.getTime(),
      )
    } catch (error) {
      // The run itself is over and its reason is already decided, so a failed
      // write is reported rather than allowed to rewrite history. What the
      // message says about the rollback is the part a human needs.
      notionWriteError = (error as Error).message
      recordStep(
        { ...EMPTY_STEP, kind: 'notion_write', error: notionWriteError, failureCategory: categoryOf(error) ?? null },
        writeAt,
        ports.clock.now().getTime() - writeAt.getTime(),
      )
    }
  }
  // A blocked write records no step, because nothing was attempted: the run row
  // carries the flags, the termination reason and the shortlist size, which is
  // every reason there is.

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
    shortlist: shortlistSize === 0 ? [] : shortlist,
    notionWritePerformed,
    ...(notionWriteError === undefined ? {} : { notionWriteError }),
    usage,
    estimatedCost,
    costIsUpperBound,
    stepCount: stepIndex,
  }
}
