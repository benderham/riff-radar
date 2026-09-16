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
  /**
   * `notion_write` is the one kind no model step produces: it is the post-loop
   * write, recorded as a step so that what was written — or what blocked it —
   * sits in the same table as everything else the run did.
   */
  readonly kind:
    | 'action'
    | 'invalid_action'
    | 'finish'
    | 'model_error'
    | 'tool_error'
    | 'notion_write'
  readonly modelResponse: string | null
  readonly proposedAction: string | null
  readonly validationResult: string | null
  readonly dispatchedAction: string | null
  readonly toolName: string | null
  readonly toolArgs: string | null
  readonly toolResult: string | null
  readonly error: string | null
  /** Recorded, not stopped for: a source that returned nothing usable. */
  readonly warning: string | null
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

export interface RecordedSourceText {
  readonly sourceTextId: string
  readonly runId: string
  readonly sourceId: string
  readonly url: string
  readonly fetchedAt: string
  readonly status: number
  readonly rawBody: string
  readonly truncated: boolean
  readonly candidateCount: number
  readonly warning: string | null
}

/** One stored page, read back so a citation can be checked against it. */
export interface StoredSourceText {
  readonly url: string
  readonly rawBody: string
}

export interface Store {
  readonly database: DatabaseSync
  startRun(run: StartedRun): void
  recordStep(step: RecordedStep): void
  recordSourceText(text: RecordedSourceText): void
  /**
   * The pages this run stored. The one read in the interface, and deliberately
   * narrow: it serves checking a quote against the page it claims to come from,
   * and no past run's anything is reachable through it (ADR-0009).
   */
  sourceTextsOf(runId: string): StoredSourceText[]
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
             tool_name, tool_args, tool_result, error, warning,
             uncached_input_tokens, cached_input_tokens, output_tokens, cost
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          step.warning,
          step.uncachedInputTokens,
          step.cachedInputTokens,
          step.outputTokens,
          step.cost,
        )
    },

    recordSourceText(text) {
      database
        .prepare(
          `INSERT INTO source_texts (
             source_text_id, run_id, source_id, url, fetched_at, status,
             raw_body, truncated, candidate_count, warning
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          text.sourceTextId,
          text.runId,
          text.sourceId,
          text.url,
          text.fetchedAt,
          text.status,
          text.rawBody,
          text.truncated ? 1 : 0,
          text.candidateCount,
          text.warning,
        )
    },

    sourceTextsOf(runId) {
      return database
        .prepare(`SELECT url, raw_body FROM source_texts WHERE run_id = ? ORDER BY fetched_at`)
        .all(runId)
        .map((row) => ({ url: row['url'] as string, rawBody: row['raw_body'] as string }))
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
