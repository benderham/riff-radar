/**
 * Parsing the command line.
 *
 * `riff-radar run [--last-days N] [--dry-run] [--resume RUN_ID]`. Nothing else
 * is accepted: absolute `--from`/`--to` dates are deliberately out of scope for
 * Milestone 1.
 *
 * `--resume` is the whole of how a resume is asked for (ADR-0047). Its absence
 * always means a new run, and it takes no window, because the window comes from
 * the run being continued.
 *
 * Tokenising is `node:util`'s `parseArgs` (ADR-0013's budget: the standard
 * library before anything else). It settles the mechanical half — unknown
 * flags, a flag whose value is missing, the order they appear in — and what is
 * left here is the part that is about this command rather than about argument
 * syntax: the one positional, the integer rule, and the pair that contradict.
 *
 * Anything wrong with the command line is a `UsageError`, raised before the run
 * starts and before anything is written, so a typo costs nothing.
 */

import { parseArgs } from 'node:util'

export class UsageError extends Error {
  override readonly name = 'UsageError'
}

export interface CliArgs {
  readonly command: 'run'
  readonly lastDays: number
  readonly dryRun: boolean
  /** The run to continue. Absent is a new run, always (ADR-0047). */
  readonly resumeRunId?: string
  /** What was typed, for the trace. The resolved window records the rest. */
  readonly raw: string
}

export const DEFAULT_LAST_DAYS = 7

export const USAGE =
  'usage: riff-radar run [--last-days N] [--dry-run] [--resume RUN_ID]'

const parseLastDays = (raw: string): number => {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) {
    throw new UsageError(`--last-days must be a whole number of days, 1 or more; got "${raw}"`)
  }
  return value
}

export const parseCliArgs = (argv: readonly string[]): CliArgs => {
  let values
  let positionals
  try {
    ;({ values, positionals } = parseArgs({
      args: [...argv],
      options: {
        'last-days': { type: 'string' },
        'dry-run': { type: 'boolean' },
        resume: { type: 'string' },
      },
      allowPositionals: true,
      strict: true,
    }))
  } catch (error) {
    // `parseArgs` names the offending flag in its message, which is the half a
    // person needs; the usage line is the half it has no way to know.
    throw new UsageError(`${(error as Error).message}. ${USAGE}`)
  }

  const [command, ...extra] = positionals
  if (command === undefined) throw new UsageError(`no command given. ${USAGE}`)
  if (command !== 'run') throw new UsageError(`unknown command "${command}". ${USAGE}`)
  if (extra.length > 0) throw new UsageError(`unexpected argument "${extra[0]}". ${USAGE}`)

  // `parseArgs` takes the next token as a value whatever it looks like, so
  // `--resume --dry-run` would otherwise resume a run called "--dry-run" and
  // silently swallow the flag.
  const resumeRunId = values.resume
  if (resumeRunId !== undefined && resumeRunId.startsWith('--')) {
    throw new UsageError(`--resume needs the id of a run to continue. ${USAGE}`)
  }

  const lastDays = values['last-days']
  if (resumeRunId !== undefined && lastDays !== undefined) {
    throw new UsageError('--resume takes no --last-days: the window comes from the run being resumed')
  }

  return {
    command,
    lastDays: lastDays === undefined ? DEFAULT_LAST_DAYS : parseLastDays(lastDays),
    dryRun: values['dry-run'] === true,
    ...(resumeRunId === undefined ? {} : { resumeRunId }),
    raw: argv.join(' '),
  }
}
