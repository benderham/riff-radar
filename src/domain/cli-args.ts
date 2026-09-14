/**
 * Parsing the command line.
 *
 * `riff-radar run [--last-days N] [--dry-run]`. Nothing else is accepted:
 * absolute `--from`/`--to` dates are deliberately out of scope for Milestone 1.
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
  /** What was typed, for the trace. The resolved window records the rest. */
  readonly raw: string
}

export const DEFAULT_LAST_DAYS = 7

export const USAGE = 'usage: riff-radar run [--last-days N] [--dry-run]'

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

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index] as string

    if (argument === '--dry-run') {
      dryRun = true
      continue
    }
    if (argument === '--last-days') {
      lastDays = parseLastDays(rest[index + 1])
      index += 1
      continue
    }
    throw new UsageError(`unknown argument "${argument}". ${USAGE}`)
  }

  return { command, lastDays, dryRun, raw: argv.join(' ') }
}
