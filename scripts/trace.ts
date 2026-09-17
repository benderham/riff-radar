/**
 * Read a run back out of the trace: `npm run trace [run-id-prefix]`.
 *
 * No argument lists the last ten runs. An argument — the first few characters
 * of a run id are enough — prints that run's steps, its warnings and errors,
 * and what it proposed. A run that resumed another, or was resumed, prints as
 * the whole chain: one piece of work, however many rows it took (ADR-0047).
 *
 * This is a convenience, never a dependency. The milestone's evidence rule is
 * that a run is reconstructable with a SQL client and nothing else, so this
 * file only issues the queries a human would type, and prints the columns they
 * would read. It opens the database read-only: reading a trace must never be
 * able to change one.
 */

import { DatabaseSync } from 'node:sqlite'
import process from 'node:process'

import { DATABASE_PATH } from '../config.ts'

/**
 * A cell, cut to fit and padded to line up. One-line output is the whole point.
 *
 * A value is never allowed to fill its own width: something that fits exactly
 * would run into the next column, which is how a column of JSON arguments ends
 * up touching a column of durations.
 */
export const cell = (value: unknown, width: number): string => {
  const text = (value ?? '').toString().replaceAll(/\s+/g, ' ')
  return (text.length >= width ? `${text.slice(0, width - 2)}… ` : text).padEnd(width)
}

/**
 * What a step has to say, in one line: the category first, then the prose.
 *
 * The category leads because it is the countable half — a column of
 * `[transient]` reads down the page in a way a sentence does not — and because
 * a step can carry one without prose of its own.
 */
export const noteOf = (step: Record<string, unknown>): string => {
  const said = step['error'] ?? step['warning'] ?? ''
  const category = step['failure_category'] == null ? '' : `[${step['failure_category']}] `
  return `${category}${said}`
}

/**
 * A chain of runs, totalled.
 *
 * Steps add up, because each row's steps are its own. Cost does not: a resumed
 * run loads its parent's accumulated spend and continues against the same
 * ceiling (ADR-0050), so its row already holds the chain's total and summing
 * the rows would count the parent twice. The youngest row is the answer.
 */
export const chainSummary = (
  runs: readonly { readonly estimated_cost: unknown; readonly steps: number }[],
): { runs: number; steps: number; cost: number } => ({
  runs: runs.length,
  steps: runs.reduce((total, run) => total + run.steps, 0),
  cost: Number(runs.at(-1)?.estimated_cost ?? 0),
})

// Nothing runs on import: the formatting above is tested, and this is a script.
if (process.argv[1]?.endsWith('trace.ts')) {
  const database = new DatabaseSync(DATABASE_PATH, { readOnly: true })
  const prefix = process.argv[2]

  if (prefix === undefined) {
    const runs = database
      .prepare(
        `SELECT run_id, started_at, termination_reason, shortlist_size,
                notion_write_performed, estimated_cost
           FROM runs ORDER BY started_at DESC LIMIT 10`,
      )
      .all()

    console.log(`${cell('run', 10)}${cell('started', 26)}${cell('stopped', 22)}${cell('list', 5)}${cell('wrote', 6)}cost`)
    for (const run of runs) {
      console.log(
        cell(String(run['run_id']).slice(0, 8), 10) +
          cell(run['started_at'], 26) +
          cell(run['termination_reason'] ?? '(never finished)', 22) +
          cell(run['shortlist_size'], 5) +
          cell(run['notion_write_performed'] === 1 ? 'yes' : 'no', 6) +
          `$${Number(run['estimated_cost']).toFixed(4)}`,
      )
    }
    console.log(`\n${runs.length} run(s). Pass the first few characters of one to read it.`)
    process.exit(0)
  }

  const matched = database
    .prepare(`SELECT * FROM runs WHERE run_id LIKE ? ORDER BY started_at`)
    .get(`${prefix}%`)

  if (matched === undefined) {
    console.error(`no run whose id starts with "${prefix}"`)
    process.exit(1)
  }

  const rowOf = (runId: unknown) =>
    database.prepare(`SELECT * FROM runs WHERE run_id = ?`).get(String(runId))

  // Up to the root by `resumed_from`, then down again by whoever resumed this
  // one: whichever link of a chain is named, the whole chain is printed.
  const chain = [matched]
  for (let at = matched; at['resumed_from'] != null; ) {
    const older = rowOf(at['resumed_from'])
    if (older === undefined) break
    chain.unshift(older)
    at = older
  }
  for (;;) {
    const younger = database
      .prepare(`SELECT * FROM runs WHERE resumed_from = ?`)
      .get(String(chain.at(-1)?.['run_id']))
    if (younger === undefined) break
    chain.push(younger)
  }

  const counted: { estimated_cost: unknown; steps: number }[] = []

  for (const run of chain) {
    const runId = String(run['run_id'])
    console.log(`run     ${runId}${run['resumed_from'] == null ? '' : `  (resumed from ${String(run['resumed_from']).slice(0, 8)})`}`)
    console.log(`window  ${run['resolved_from']} to ${run['resolved_to']}  (${run['cli_args']})`)
    console.log(`stopped ${run['termination_reason'] ?? '(never finished)'}`)
    console.log(
      `cost    $${Number(run['estimated_cost']).toFixed(4)}${run['cost_is_upper_bound'] === 1 ? ' (a ceiling: no cache figures)' : ''}` +
        `  ·  shortlist ${run['shortlist_size']}  ·  notion write ${run['notion_write_performed'] === 1 ? 'yes' : 'no'}`,
    )
    console.log(`prompt v${run['prompt_version']}  profile v${run['profile_version']}  model ${run['model_id']}\n`)

    const steps = database
      .prepare(`SELECT * FROM steps WHERE run_id = ? ORDER BY step_index`)
      .all(runId)
    counted.push({ estimated_cost: run['estimated_cost'], steps: steps.length })

    console.log(`${cell('#', 4)}${cell('kind', 14)}${cell('tool', 16)}${cell('args', 46)}${cell('ms', 7)}note`)
    for (const step of steps) {
      const note = noteOf(step)
      console.log(
        cell(step['step_index'], 4) +
          cell(step['kind'], 14) +
          cell(step['tool_name'], 16) +
          cell(step['tool_args'] ?? step['validation_result'], 46) +
          cell(step['duration_ms'], 7) +
          cell(note, 200).trimEnd(),
      )
    }

    // The finish step holds the shortlist and the arithmetic that ordered it, which
    // is the one thing worth printing whole rather than in a column.
    const finish = steps.findLast((step) => step['kind'] === 'finish')
    if (finish?.['tool_result'] !== undefined) {
      console.log('\nfinish:')
      console.log(JSON.stringify(JSON.parse(String(finish['tool_result'])), null, 2))
    }
    if (chain.length > 1) console.log('')
  }

  if (chain.length > 1) {
    const total = chainSummary(counted)
    console.log(`chain   ${total.runs} runs, ${total.steps} steps, $${total.cost.toFixed(4)} in total\n`)
  }

  // Every page the chain stored, whichever of its runs fetched it: a resume
  // continues one piece of work, and the evidence reads as one list.
  const pages = database
    .prepare(
      `SELECT url, status, length(raw_body) AS bytes, candidate_count, warning
         FROM source_texts WHERE run_id IN (${chain.map(() => '?').join(', ')}) ORDER BY fetched_at`,
    )
    .all(...chain.map((run) => String(run['run_id'])))

  if (pages.length > 0) {
    console.log('\nsource texts, stored whole:')
    for (const page of pages) {
      console.log(
        `  ${cell(page['url'], 70)}${cell(page['status'], 6)}${cell(`${page['bytes']} bytes`, 14)}` +
          `${cell(`${page['candidate_count']} candidates`, 16)}${page['warning'] ?? ''}`,
      )
    }
  }
}
