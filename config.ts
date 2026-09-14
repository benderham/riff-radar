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
export const PROMPT_VERSION = 2
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

/** The provider's OpenAI-compatible endpoint (ADR-0014). */
export const MODEL_ENDPOINT = 'https://api.fireworks.ai/inference/v1/chat/completions'

/**
 * Price in US dollars per million tokens (ADR-0020). Cached input is ~30x
 * cheaper than uncached, so the three are priced separately and never summed.
 */
export const PRICE_PER_MILLION = {
  uncachedInput: 0.22,
  cachedInput: 0.007,
  output: 0.66,
} as const

/** The loop's ceilings. Each maps to exactly one termination reason. */
export const MAX_STEPS = 30
export const INVALID_ACTION_LIMIT = 3
export const MAX_RUN_COST_USD = 0.25

/** Fixed in configuration, never a flag. */
export const SHORTLIST_SIZE = 5

/**
 * The configured release sources (ADR-0001). Discovery reads these and only
 * these; web search never originates a candidate. Metal Archives is excluded
 * because it lists upcoming releases only (ADR-0002).
 *
 * The fetching lives in ticket 02; the identifiers are here because the action
 * schema names them, so an unknown source is a rejected action rather than a
 * failed request.
 */
export const SOURCES = {
  aoty: 'https://www.albumoftheyear.org/genre/40-metal/recent/',
  wikipedia: 'https://en.wikipedia.org/wiki/2026_in_heavy_metal_music',
  loudwire: 'https://loudwire.com/2026-hard-rock-metal-album-release-calendar/',
} as const

export type SourceId = keyof typeof SOURCES

/** Identifies the project to the sites it reads, rather than pretending to be a browser. */
export const USER_AGENT = 'riff-radar/0.1 (personal listening project)'

export const HTTP_TIMEOUT_MS = 20_000

/**
 * The ceiling on cleaned source text handed to the extraction call.
 *
 * A release calendar is a long page, and the whole of one costs more than the
 * run's ceiling allows. Text past the cap is cut and the cut is marked, so a
 * truncated extraction is visible rather than inferred. The raw body is stored
 * whole either way, so raising this never requires refetching.
 */
export const MAX_SOURCE_TEXT_CHARS = 40_000
