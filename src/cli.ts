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
import { NotionRefusal } from './clients/notion.ts'
import { UsageError, parseCliArgs } from './domain/cli-args.ts'
import { appleMusicSearchUrl } from './domain/notion-page.ts'
import type { ShortlistItem } from './domain/shortlist.ts'
import { tasteProfileSchema } from './domain/taste-profile.ts'
import type { Ports } from './ports.ts'
import type { Store } from './store/store.ts'
import { openStore } from './store/store.ts'

export const EXIT_OK = 0
export const EXIT_REFUSED = 2
/**
 * A run that did everything right and could not write. Distinct from a refusal,
 * because a refusal spent nothing and left nothing: this one spent a run.
 */
export const EXIT_WRITE_FAILED = 3

export interface CliDependencies {
  readonly argv: readonly string[]
  readonly env: Record<string, string | undefined>
  readonly ports: Ports
  readonly openStore: () => Store
  readonly log: (line: string) => void
  readonly readTasteProfile?: () => unknown
}

/**
 * The shortlist, for the terminal.
 *
 * The same items the write turns into pages, printed whether or not it wrote
 * them: on a dry run this is the whole point of the run, and on a real one it
 * is what landed in Notion. Pure, so the shape is tested without a run.
 */
export const shortlistLines = (shortlist: readonly ShortlistItem[]): string[] =>
  shortlist.flatMap((item) => [
    `  ${item.rank}. ${item.artist} — ${item.title} (${item.releaseDate})${
      item.musicbrainzId === undefined ? ' [unverified]' : ''
    }`,
    `     ${item.rationale}`,
    `     ${appleMusicSearchUrl(item.artist ?? '', item.title ?? '')}`,
  ])

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
      searchApiKey: env['TAVILY_API_KEY'] ?? '',
      notionToken: env['NOTION_TOKEN'] ?? '',
      notionDatabaseId: env['NOTION_DATABASE_ID'] ?? '',
    })

    log(`run ${outcome.runId}`)
    log(`window ${outcome.window.from} to ${outcome.window.to}${args.dryRun ? ' (dry run)' : ''}`)
    log(`stopped: ${outcome.terminationReason}`)
    log(
      `shortlist: ${outcome.shortlistSize}; notion write: ${
        outcome.notionWritePerformed ? 'yes' : 'no'
      }`,
    )
    for (const line of shortlistLines(outcome.shortlist)) log(line)
    if (outcome.notionWriteError !== undefined) log(`notion write failed: ${outcome.notionWriteError}`)
    log(
      `${outcome.stepCount} steps; ${outcome.usage.uncachedInputTokens} uncached + ${
        outcome.usage.cachedInputTokens
      } cached input, ${outcome.usage.outputTokens} output tokens; ${
        outcome.costIsUpperBound ? 'at most ' : ''
      }$${outcome.estimatedCost.toFixed(4)}`,
    )
    // Not a success: Ben's Friday depends on the rows being there, and a zero
    // exit code would say they are.
    return outcome.notionWriteError === undefined ? EXIT_OK : EXIT_WRITE_FAILED
  } catch (error) {
    // The two failures that are refusals rather than crashes: Notion could not
    // be read (ADR-0039), or its database is not the one this writes to. Both
    // happen before the run row, so nothing was spent and nothing was left.
    if (!(error instanceof NotionRefusal)) throw error
    log(`cannot start: ${error.message}`)
    return EXIT_REFUSED
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
