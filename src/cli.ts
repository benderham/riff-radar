#!/usr/bin/env -S node --disable-warning=ExperimentalWarning --import tsx
/**
 * The entry point. Replaces Flue's `app.ts`: this is a command you type, not a
 * server anything calls into (ADR-0021).
 *
 * Order matters and is the point of this file. Parse the command line, then
 * check credentials, then open the database — so a typo or an unset variable
 * costs nothing and leaves nothing behind. Only once the run can actually
 * proceed is anything written.
 */

import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { DATABASE_PATH, MissingCredentialsError, TASTE_PROFILE_PATH, loadCredentials } from '../config.ts'
import { runRiffRadar } from './agents/riff-radar.ts'
import { UsageError, parseCliArgs } from './domain/cli-args.ts'
import { describeTasteProfileError, parseTasteProfile } from './domain/taste-profile.ts'
import { systemClock } from './adapters/clock.ts'
import type { Ports } from './ports.ts'
import type { Store } from './store/store.ts'
import { openStore } from './store/store.ts'

export const EXIT_OK = 0
export const EXIT_REFUSED = 2

export interface CliDependencies {
  readonly argv: readonly string[]
  readonly env: Record<string, string | undefined>
  readonly ports: Ports
  readonly openStore: () => Store
  readonly log: (line: string) => void
  readonly readTasteProfile?: () => unknown
}

export const runCli = ({
  argv,
  env,
  ports,
  openStore: open,
  log,
  readTasteProfile = () => JSON.parse(readFileSync(TASTE_PROFILE_PATH, 'utf8')),
}: CliDependencies): number => {
  let args
  try {
    args = parseCliArgs(argv)
  } catch (error) {
    if (error instanceof UsageError) {
      log(error.message)
      return EXIT_REFUSED
    }
    throw error
  }

  try {
    // The result is deliberately discarded: nothing in part A calls out yet.
    // The check exists so that a run refuses before the model has been billed.
    loadCredentials(env)
  } catch (error) {
    if (error instanceof MissingCredentialsError) {
      log(error.message)
      return EXIT_REFUSED
    }
    throw error
  }

  let profile
  try {
    profile = parseTasteProfile(readTasteProfile())
  } catch (error) {
    // A profile that will not parse is the same class of problem as an unset
    // variable: refuse before anything is written, and say what is wrong with
    // it. ADR-0022 promises a useful error rather than silently empty lists.
    log(`cannot start: ${TASTE_PROFILE_PATH} is not a valid taste profile`)
    log(describeTasteProfileError(error))
    return EXIT_REFUSED
  }

  const store = open()

  try {
    const outcome = runRiffRadar({ args, ports, store, profile })

    log(`run ${outcome.runId}`)
    log(`window ${outcome.window.from} to ${outcome.window.to}${args.dryRun ? ' (dry run)' : ''}`)
    log(`stopped: ${outcome.terminationReason}`)
    log(
      `shortlist: ${outcome.shortlistSize}; notion write: ${
        outcome.notionWritePerformed ? 'yes' : 'no'
      }`,
    )
    return EXIT_OK
  } finally {
    store.close()
  }
}

const realPathOf = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

// Compared through realpath so that invoking the `bin` symlink counts as
// running this file, rather than silently doing nothing.
const invokedDirectly =
  process.argv[1] !== undefined &&
  realPathOf(fileURLToPath(import.meta.url)) === realPathOf(process.argv[1])

if (invokedDirectly) {
  process.exitCode = runCli({
    argv: process.argv.slice(2),
    env: process.env,
    ports: { clock: systemClock },
    openStore: () => openStore(DATABASE_PATH),
    log: (line) => console.log(line),
  })
}
