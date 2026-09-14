/**
 * The entry point. Replaces Flue's `app.ts`: this is a command you type, not a
 * server anything calls into (ADR-0021).
 *
 * Order matters and is the point of this file. Parse the command line, check
 * credentials, read the taste profile — and only then open the database. Each
 * of the three refuses before anything is written, so a typo, an unset variable
 * or a broken profile costs nothing and leaves nothing behind.
 */

import { readFileSync } from 'node:fs'
import process from 'node:process'
import { z } from 'zod'

import { DATABASE_PATH, TASTE_PROFILE_PATH, missingCredentials } from '../config.ts'
import { fireworksModel } from './adapters/fireworks.ts'
import { httpAdapter } from './adapters/http.ts'
import { runRiffRadar } from './agents/riff-radar.ts'
import { UsageError, parseCliArgs } from './domain/cli-args.ts'
import { tasteProfileSchema } from './domain/taste-profile.ts'
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

export const runCli = async ({
  argv,
  env,
  ports,
  openStore: open,
  log,
  readTasteProfile = () => JSON.parse(readFileSync(TASTE_PROFILE_PATH, 'utf8')),
}: CliDependencies): Promise<number> => {
  let args
  try {
    args = parseCliArgs(argv)
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    log(error.message)
    return EXIT_REFUSED
  }

  const missing = missingCredentials(env)
  if (missing.length > 0) {
    log(`cannot start: ${missing.join(', ')} not set in the environment`)
    return EXIT_REFUSED
  }

  // ADR-0022 promises a useful error rather than silently empty lists.
  const profile = tasteProfileSchema.safeParse(readTasteProfile())
  if (!profile.success) {
    log(`cannot start: ${TASTE_PROFILE_PATH} is not a valid taste profile`)
    log(z.prettifyError(profile.error))
    return EXIT_REFUSED
  }

  const store = open()

  try {
    const outcome = await runRiffRadar({
      args,
      ports,
      store,
      profile: profile.data,
      // Present: `missingCredentials` refused the run above if it were not.
      searchApiKey: env['BRAVE_API_KEY'] ?? '',
    })

    log(`run ${outcome.runId}`)
    log(`window ${outcome.window.from} to ${outcome.window.to}${args.dryRun ? ' (dry run)' : ''}`)
    log(`stopped: ${outcome.terminationReason}`)
    log(
      `shortlist: ${outcome.shortlistSize}; notion write: ${
        outcome.notionWritePerformed ? 'yes' : 'no'
      }`,
    )
    log(
      `${outcome.stepCount} steps; ${outcome.usage.uncachedInputTokens} uncached + ${
        outcome.usage.cachedInputTokens
      } cached input, ${outcome.usage.outputTokens} output tokens; ${
        outcome.costIsUpperBound ? 'at most ' : ''
      }$${outcome.estimatedCost.toFixed(4)}`,
    )
    return EXIT_OK
  } finally {
    store.close()
  }
}

if (process.argv[1]?.endsWith('cli.ts')) {
  process.exitCode = await runCli({
    argv: process.argv.slice(2),
    env: process.env,
    ports: {
      clock: { now: () => new Date() },
      // Empty rather than asserted: `runCli` refuses a missing credential
      // before it starts a run, so the port is never reached without one.
      model: fireworksModel(process.env['FIREWORKS_API_KEY'] ?? ''),
      http: httpAdapter(),
    },
    openStore: () => openStore(DATABASE_PATH),
    log: (line) => console.log(line),
  })
}
