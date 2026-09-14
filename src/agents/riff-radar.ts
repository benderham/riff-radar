/**
 * The run.
 *
 * This file is where the hand-written agent loop will live, and it is meant to
 * be readable top to bottom (ADR-0015). Part A of ticket 01 builds everything
 * around the loop and none of the loop itself: a run starts, resolves its
 * window, records itself, finds no candidates because nothing yet looks for
 * any, and stops. Every guardrail it will later need — one termination reason,
 * no write unless the reason permits one — is already in force, so the loop
 * drops into a run that already terminates correctly.
 */

import { randomUUID } from 'node:crypto'

import { ACTION_SCHEMA_VERSION, MODEL_ID, PROMPT_VERSION } from '../../config.ts'
import type { CliArgs } from '../domain/cli-args.ts'
import { formatCliArgs } from '../domain/cli-args.ts'
import type { TerminationReason } from '../domain/run.ts'
import { NO_TOKENS, permitsNotionWrite } from '../domain/run.ts'
import type { TasteProfile } from '../domain/taste-profile.ts'
import type { DateWindow } from '../domain/window.ts'
import { resolveWindow } from '../domain/window.ts'
import type { Ports } from '../ports.ts'
import type { Store } from '../store/store.ts'

export interface RunRequest {
  readonly args: CliArgs
  readonly ports: Ports
  readonly store: Store
  readonly profile: TasteProfile
}

export interface RunOutcome {
  readonly runId: string
  readonly window: DateWindow
  readonly terminationReason: TerminationReason
  readonly shortlistSize: number
  readonly notionWritePerformed: boolean
}

export const runRiffRadar = ({ args, ports, store, profile }: RunRequest): RunOutcome => {
  // Resolve first. A window that cannot be resolved is not a run, and must not
  // leave a half-started row behind.
  const startedAt = ports.clock.now()
  const window = resolveWindow(startedAt, args.lastDays)

  const runId = randomUUID()
  store.startRun({
    runId,
    startedAt: startedAt.toISOString(),
    cliArgs: formatCliArgs(args),
    resolvedFrom: window.from,
    resolvedTo: window.to,
    promptVersion: PROMPT_VERSION,
    profileVersion: profile.version,
    actionSchemaVersion: ACTION_SCHEMA_VERSION,
    modelId: MODEL_ID,
  })

  // ── The loop goes here (part B). ────────────────────────────────────────────
  // Until it exists nothing discovers a candidate, so the run reaches the one
  // outcome that is honest: it found nothing.
  const terminationReason: TerminationReason = 'no_candidates'
  const shortlistSize = 0

  // The write is post-loop code, never a model action (ADR-0005). A dry run and
  // a reason that does not permit a write are both blocks; with no shortlist to
  // write there is nothing to do either way.
  const notionWritePerformed =
    !args.dryRun && permitsNotionWrite(terminationReason) && shortlistSize > 0

  store.finishRun({
    runId,
    endedAt: ports.clock.now().toISOString(),
    terminationReason,
    // No model has been called, so the accounting is genuinely zero rather than
    // unmeasured. Real token counts arrive with the loop.
    ...NO_TOKENS,
    estimatedCost: 0,
    shortlistSize,
    notionWritePerformed,
  })

  return { runId, window, terminationReason, shortlistSize, notionWritePerformed }
}
