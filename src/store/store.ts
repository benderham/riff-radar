/**
 * Writing the trace.
 *
 * SQLite is not behind a port (ADR-0018): tests open a real in-memory database,
 * because faking a database we own would make persistence tests prove nothing.
 * The `database` handle is exposed so tests — and a person with a SQL client —
 * can read a run back without any tooling of ours.
 */

import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { TerminationReason } from '../domain/run.ts'

const SCHEMA = readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8')

export interface StartedRun {
  readonly runId: string
  readonly startedAt: string
  readonly cliArgs: string
  readonly resolvedFrom: string
  readonly resolvedTo: string
  readonly promptVersion: number
  readonly profileVersion: number
  readonly actionSchemaVersion: number
  readonly modelId: string
}

export interface RecordedStep {
  readonly stepId: string
  readonly runId: string
  readonly stepIndex: number
  readonly timestamp: string
  readonly durationMs: number
  readonly kind: 'action' | 'invalid_action' | 'finish' | 'model_error' | 'tool_error'
  readonly modelResponse: string | null
  readonly proposedAction: string | null
  readonly validationResult: string | null
  readonly dispatchedAction: string | null
  readonly toolName: string | null
  readonly toolArgs: string | null
  readonly toolResult: string | null
  readonly error: string | null
  readonly uncachedInputTokens: number
  readonly cachedInputTokens: number
  readonly outputTokens: number
  readonly cost: number
}

export interface FinishedRun {
  readonly runId: string
  readonly endedAt: string
  readonly terminationReason: TerminationReason
  readonly uncachedInputTokens: number
  readonly cachedInputTokens: number
  readonly outputTokens: number
  readonly estimatedCost: number
  readonly shortlistSize: number
  readonly notionWritePerformed: boolean
  readonly costIsUpperBound: boolean
}

export interface Store {
  readonly database: DatabaseSync
  startRun(run: StartedRun): void
  recordStep(step: RecordedStep): void
  finishRun(run: FinishedRun): void
  close(): void
}

const columnsOf = (database: DatabaseSync, table: string) =>
  database.prepare(`PRAGMA table_info(${table})`).all().map((row) => row['name'] as string)

// `CREATE TABLE IF NOT EXISTS` leaves an older file untouched, so a database
// written before a schema change is missing columns and fails later with a bare
// "no such column". Compare it against a fresh in-memory copy of the schema and
// say so at open time instead. No migrations: the trace is reproducible by
// re-running, so deleting the file is the documented fix.
const assertSchemaIsCurrent = (database: DatabaseSync, path: string): void => {
  const expected = new DatabaseSync(':memory:')
  expected.exec(SCHEMA)
  const tables = expected
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all()
    .map((row) => row['name'] as string)

  for (const table of tables) {
    const missing = columnsOf(expected, table).filter(
      (column) => !columnsOf(database, table).includes(column),
    )
    if (missing.length > 0) {
      expected.close()
      throw new Error(
        `${path} was written by an older schema (${table} is missing ${missing.join(', ')}). ` +
          `Delete the file and run again.`,
      )
    }
  }
  expected.close()
}

export const openStore = (path: string): Store => {
  const database = new DatabaseSync(path)
  database.exec(SCHEMA)
  assertSchemaIsCurrent(database, path)

  return {
    database,

    startRun(run) {
      database
        .prepare(
          `INSERT INTO runs (
             run_id, started_at, cli_args, resolved_from, resolved_to,
             prompt_version, profile_version, action_schema_version, model_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          run.runId,
          run.startedAt,
          run.cliArgs,
          run.resolvedFrom,
          run.resolvedTo,
          run.promptVersion,
          run.profileVersion,
          run.actionSchemaVersion,
          run.modelId,
        )
    },

    recordStep(step) {
      database
        .prepare(
          `INSERT INTO steps (
             step_id, run_id, step_index, timestamp, duration_ms, kind,
             model_response, proposed_action, validation_result, dispatched_action,
             tool_name, tool_args, tool_result, error,
             uncached_input_tokens, cached_input_tokens, output_tokens, cost
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          step.stepId,
          step.runId,
          step.stepIndex,
          step.timestamp,
          step.durationMs,
          step.kind,
          step.modelResponse,
          step.proposedAction,
          step.validationResult,
          step.dispatchedAction,
          step.toolName,
          step.toolArgs,
          step.toolResult,
          step.error,
          step.uncachedInputTokens,
          step.cachedInputTokens,
          step.outputTokens,
          step.cost,
        )
    },

    finishRun(run) {
      // The WHERE clause carries the guarantee: a run already holding a reason
      // matches nothing, so a second ending changes no row and is reported.
      const result = database
        .prepare(
          `UPDATE runs SET
             ended_at = ?, termination_reason = ?,
             uncached_input_tokens = ?, cached_input_tokens = ?, output_tokens = ?,
             estimated_cost = ?, shortlist_size = ?, notion_write_performed = ?,
             cost_is_upper_bound = ?
           WHERE run_id = ? AND termination_reason IS NULL`,
        )
        .run(
          run.endedAt,
          run.terminationReason,
          run.uncachedInputTokens,
          run.cachedInputTokens,
          run.outputTokens,
          run.estimatedCost,
          run.shortlistSize,
          run.notionWritePerformed ? 1 : 0,
          run.costIsUpperBound ? 1 : 0,
          run.runId,
        )

      if (result.changes === 0) {
        throw new Error(`run ${run.runId} has already ended, or does not exist`)
      }
    },

    close() {
      database.close()
    },
  }
}
