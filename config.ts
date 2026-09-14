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

export interface Credentials {
  readonly fireworksApiKey: string
  readonly notionToken: string
  readonly notionDatabaseId: string
}

export class MissingCredentialsError extends Error {
  override readonly name = 'MissingCredentialsError'
  readonly missing: readonly string[]

  constructor(missing: readonly string[]) {
    super(
      `cannot start: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set in the environment`,
    )
    this.missing = missing
  }
}

/**
 * Reads the credentials a run needs, or refuses.
 *
 * All three are required even for a dry run: a dry run still reads Notion to
 * suppress releases already proposed (ADR-0009), and still calls the model.
 * Refusing here means finding out before the model has been billed, rather than
 * halfway through. The error names the variables and never their values.
 */
export const loadCredentials = (env: Record<string, string | undefined>): Credentials => {
  const present = new Map<string, string>()
  const missing: string[] = []

  for (const name of REQUIRED_CREDENTIALS) {
    const value = env[name]?.trim()
    if (value === undefined || value === '') missing.push(name)
    else present.set(name, value)
  }

  if (missing.length > 0) throw new MissingCredentialsError(missing)

  return {
    fireworksApiKey: present.get('FIREWORKS_API_KEY') as string,
    notionToken: present.get('NOTION_TOKEN') as string,
    notionDatabaseId: present.get('NOTION_DATABASE_ID') as string,
  }
}
