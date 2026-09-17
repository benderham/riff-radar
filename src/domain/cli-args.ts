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
 * Anything wrong with the command line is a `UsageError`, raised before the run
 * starts and before anything is written, so a typo costs nothing.
 */

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

const parseLastDays = (raw: string | undefined): number => {
  if (raw === undefined) throw new UsageError(`--last-days needs a number of days. ${USAGE}`)
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) {
    throw new UsageError(`--last-days must be a whole number of days, 1 or more; got "${raw}"`)
  }
  return value
}

export const parseCliArgs = (argv: readonly string[]): CliArgs => {
  const [command, ...rest] = argv
  if (command === undefined) throw new UsageError(`no command given. ${USAGE}`)
  if (command !== 'run') throw new UsageError(`unknown command "${command}". ${USAGE}`)

  let lastDays = DEFAULT_LAST_DAYS
  let dryRun = false
  let resumeRunId: string | undefined
  let windowGiven = false

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index] as string

    if (argument === '--dry-run') {
      dryRun = true
      continue
    }
    if (argument === '--last-days') {
      lastDays = parseLastDays(rest[index + 1])
      windowGiven = true
      index += 1
      continue
    }
    if (argument === '--resume') {
      resumeRunId = rest[index + 1]
      if (resumeRunId === undefined || resumeRunId.startsWith('--')) {
        throw new UsageError(`--resume needs the id of a run to continue. ${USAGE}`)
      }
      index += 1
      continue
    }
    throw new UsageError(`unknown argument "${argument}". ${USAGE}`)
  }

  // Both given is a contradiction rather than an override: the resumed run's
  // window is its parent's, so there is nothing for a second one to mean.
  if (resumeRunId !== undefined && windowGiven) {
    throw new UsageError('--resume takes no --last-days: the window comes from the run being resumed')
  }

  return {
    command,
    lastDays,
    dryRun,
    ...(resumeRunId === undefined ? {} : { resumeRunId }),
    raw: argv.join(' '),
  }
}
