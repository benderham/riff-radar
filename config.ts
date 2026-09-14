/**
 * Run configuration.
 *
 * Everything that is a choice rather than a mechanism lives here: the sources,
 * the ceilings, the model and its prices, the versions stamped onto every run,
 * and the environment variables a run refuses to start without.
 *
 * Secrets are read from the environment and never stored here.
 */

/** Versions stamped onto every run, so a trace says which configuration produced it. */
export const PROMPT_VERSION = 1
export const ACTION_SCHEMA_VERSION = 1

/**
 * The model a run records itself as having used (ADR-0020). Its endpoint and
 * prices arrive with the code that calls it and the accounting that prices it.
 */
export const MODEL_ID = 'accounts/fireworks/models/deepseek-v4p1-flash'

/** Fixed paths, relative to the repository root. */
export const TASTE_PROFILE_PATH = 'taste-profile.json'
export const DATABASE_PATH = 'riff-radar.db'

export const REQUIRED_CREDENTIALS = [
  'FIREWORKS_API_KEY',
  'NOTION_TOKEN',
  'NOTION_DATABASE_ID',
] as const

/**
 * The names of the credentials a run needs and does not have.
 *
 * All three are required even for a dry run: a dry run still reads Notion to
 * suppress releases already proposed (ADR-0009), and still calls the model.
 * Checking here means finding out before the model has been billed. Names are
 * returned, never values, so nothing secret can reach a log.
 */
export const missingCredentials = (env: Record<string, string | undefined>): string[] =>
  REQUIRED_CREDENTIALS.filter((name) => !env[name]?.trim())
