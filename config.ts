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
export const PROMPT_VERSION = 6
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
  'TAVILY_API_KEY',
  'NOTION_TOKEN',
  'NOTION_DATABASE_ID',
] as const

/**
 * The names of the credentials a run needs and does not have.
 *
 * All four are required even for a dry run: a dry run still reads Notion to
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
 * What each taste-profile match is worth (ADR-0006, ADR-0007).
 *
 * Every exclusion outweighs its own inclusion, which is what "strong negative
 * weight" means here: a record on a label Ben avoids has to be doing something
 * else right to survive it, but it is not filtered out, because genre and label
 * tags on new releases are frequently wrong.
 *
 * `artists.always` has no weight. It is a guaranteed slot rather than a large
 * number, so no combination of other signals can outbid it and no arithmetic
 * has to be tuned to make sure of that.
 */
export const RANKING_WEIGHTS = {
  artistWatch: 3,
  labelInclude: 2,
  labelExclude: -4,
  genreInclude: 2,
  genreExclude: -4,
  personnelInclude: 2,
  personnelExclude: -4,
  /** The only model judgement, and worth less than anything matched from data. */
  vibeInclude: 1,
  vibeExclude: -2,
} as const

/**
 * The configured release sources (ADR-0001). Discovery reads these and only
 * these; web search never originates a candidate. Metal Archives is excluded
 * because it lists upcoming releases only (ADR-0002).
 *
 * Album of the Year was the third. It answers every request with a bot
 * challenge and cannot be read without pretending to be a browser on a site
 * that has said no, so it is not configured and a run does not spend a step
 * knocking (ADR-0031). Its URL is in that decision, one line from returning.
 *
 * The identifiers are what the action schema names, so an unknown source is a
 * rejected action rather than a failed request.
 */
export const SOURCES = {
  wikipedia: 'https://en.wikipedia.org/wiki/2026_in_heavy_metal_music',
  loudwire: 'https://loudwire.com/2026-hard-rock-metal-album-release-calendar/',
} as const

export type SourceId = keyof typeof SOURCES

/**
 * Web search, for disambiguation only (ADR-0033). Tavily's API answers with
 * JSON to a POST carrying the query in its body, authenticated by a bearer
 * token, and a search never originates a candidate whatever it returns.
 *
 * Five results: a disambiguation is settled by the first page or not at all,
 * and every result is resent to the model on every later step.
 */
export const SEARCH_ENDPOINT = 'https://api.tavily.com/search'
export const SEARCH_RESULT_COUNT = 5

/** Tavily's documented ceiling on a query; the action schema enforces it (ADR-0033). */
export const MAX_SEARCH_QUERY_CHARS = 400

/**
 * Notion, read here and written in ticket 06.
 *
 * The read is the half of cross-run memory that is not the taste profile
 * (ADR-0009): every release already in the database, suppressed on Release
 * Identity whatever its Status. The version string is Notion's dated API
 * contract and is sent on every request; it is what stops a change at their end
 * arriving unannounced.
 *
 * A hundred is Notion's own maximum page size, and the client pages to the end
 * regardless — a partial read suppresses part of what it should and looks
 * exactly like an up-to-date database.
 */
export const NOTION_ENDPOINT = 'https://api.notion.com/v1'
export const NOTION_VERSION = '2022-06-28'
export const NOTION_PAGE_SIZE = 100

/**
 * Identifies the project to the sites it reads, rather than pretending to be a
 * browser. MusicBrainz's terms ask for a contactable agent, so the repository
 * answers for the project — a URL anyone can read, and not Ben's address, which
 * would be personal data in every request and every trace.
 */
export const USER_AGENT = 'riff-radar/0.1 (+https://github.com/benderham/riff-radar)'

export const HTTP_TIMEOUT_MS = 20_000

/**
 * MusicBrainz (ADR-0034). Identity and enrichment only: it never introduces a
 * release, and a release it has never heard of is Unverified rather than
 * invalid (CONTEXT.md).
 *
 * One request per second is the published limit for anonymous clients, and it
 * is enforced in the client rather than by its callers, so no future caller can
 * forget. An EP costs a second request, because a release group states its type
 * but not its tracks.
 *
 * The search is fuzzy and scores what it finds, so a hit is only a match when
 * it scores at least this well *and* its artist and title agree. Binding a
 * candidate to the wrong release group would make Release Identity — and every
 * fact resting on it — confidently wrong about a different record.
 */
export const MUSICBRAINZ_ENDPOINT = 'https://musicbrainz.org/ws/2'
export const MUSICBRAINZ_MIN_INTERVAL_MS = 1_000
export const MUSICBRAINZ_MIN_SCORE = 90

/**
 * MusicBrainz sheds load rather than queueing: under pressure it answers 503,
 * or 200 with an apology in the body. Both are transient and both are common —
 * capturing this project's fixtures took three or four attempts more than once
 * — so a lookup that gives up on the first refusal would leave candidates
 * unverified for no better reason than the hour of the day.
 *
 * Three attempts, spaced by the same one-second gate as any other request. The
 * bound is what keeps a struggling service from becoming a stalled run.
 */
export const MUSICBRAINZ_MAX_ATTEMPTS = 3

/**
 * The ceiling on cleaned source text handed to the extraction call.
 *
 * Sized from the real pages, not guessed: the Loudwire calendar cleans to about
 * 47,000 characters, and it lists the coming months first and the weeks just
 * gone at the very end. A cap below the whole page therefore cuts off exactly
 * the releases a backward-looking run is asking about. 80,000 leaves room for a
 * page to grow through the year, and costs roughly USD 0.003 an extraction
 * against a run ceiling of USD 0.25 (ADR-0029).
 *
 * Text past the cap is cut and the cut is marked, so a truncated extraction is
 * visible rather than inferred. The raw body is stored whole either way, so
 * raising this never requires refetching.
 */
export const MAX_SOURCE_TEXT_CHARS = 80_000

/**
 * The properties a run writes, and the type each must have (ADR-0041).
 *
 * This table is the preflight and the page builder at once (ADR-0042): the preflight
 * refuses a database that does not match it, and nothing is written that is not
 * named here. `Rating` is deliberately absent — it is Ben's column, and the way
 * to guarantee the agent never writes it is that no code can name it.
 *
 * `Album Cover` is not here either, because it is not a property: it is the
 * page's own cover image, set as `cover.external.url` when the page is created.
 */
export const NOTION_PROPERTIES = {
  Album: 'title',
  Artist: 'rich_text',
  'Release Date': 'date',
  'Apple Music': 'url',
  Status: 'select',
  'MusicBrainz ID': 'rich_text',
  'Source URL': 'url',
  Rationale: 'rich_text',
  'Run ID': 'rich_text',
} as const

/** The only Status the agent writes. Ben sets the other two. */
export const NOTION_PROPOSED = 'Proposed'

/**
 * Apple Music has no public catalogue API this project is entitled to use, and
 * a search URL needs no key and cannot go stale: it is a link Ben clicks on a
 * Friday, and the search page finds the album whatever its identifiers are.
 */
export const APPLE_MUSIC_SEARCH = 'https://music.apple.com/search?term='

/**
 * Cover art, best-effort (ADR-0042). The JSON index is read rather than the
 * `/front` redirect, so the `http` port never carries an image: the index names
 * an address Notion fetches for itself when it renders the page.
 *
 * A release with no MusicBrainz id has no cover to ask for, and a failure here
 * is a page without a picture rather than a failed run.
 */
export const COVER_ART_ENDPOINT = 'https://coverartarchive.org/release-group'
