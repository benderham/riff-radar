/**
 * A live smoke test against Notion, read-only. Invoked by hand
 * (`npm run smoke:notion`), never by the automated suite.
 *
 * It exists because the automated tests cannot check the one thing that
 * matters here: that Ben's database really answers in the shape `notion.ts`
 * parses, and really carries the properties suppression identifies a release
 * by. `api.notion.com` is denied to the sandbox this was written in, so those
 * tests declare their bodies inline and this is the only thing that has met the
 * real service.
 *
 * Nothing is written and nothing is printed that would put the database's
 * contents in a terminal log: counts, and the properties the first page
 * carries, are enough to prove the shape.
 */

import process from 'node:process'

import { systemClock } from '../src/adapters/clock.ts'
import { httpAdapter } from '../src/adapters/http.ts'
import { NOTION_ENDPOINT, NOTION_VERSION } from '../config.ts'
import { preflightSchema, suppressedReleases } from '../src/clients/notion.ts'
import { notionPage } from '../src/domain/notion-page.ts'
import type { Ports } from '../src/ports.ts'

const token = process.env['NOTION_TOKEN'] ?? ''
const databaseId = process.env['NOTION_DATABASE_ID'] ?? ''

if (token === '' || databaseId === '') {
  console.error('NOTION_TOKEN and NOTION_DATABASE_ID must be set; nothing was requested')
  process.exit(1)
}

const ports = { http: httpAdapter(systemClock), clock: systemClock } as Ports

// The raw query first, to report which properties the database actually has.
// A renamed property is the failure this is most likely to catch, and it would
// otherwise show up as a suppression set that is quietly missing entries.
const raw = await ports.http.post(
  `${NOTION_ENDPOINT}/databases/${databaseId}/query`,
  JSON.stringify({ page_size: 1 }),
  { authorization: `Bearer ${token}`, 'notion-version': NOTION_VERSION, 'content-type': 'application/json' },
)

if (raw.status < 200 || raw.status >= 300) {
  console.error(`Notion answered HTTP ${raw.status}; check the token and the database id`)
  process.exit(1)
}

const first = JSON.parse(raw.body).results?.[0]
const properties: string[] = Object.keys(first?.properties ?? {})
console.log(`properties: ${properties.join(', ') || '(the database is empty)'}`)

const REQUIRED = ['Album', 'Artist', 'MusicBrainz ID']
const missing = REQUIRED.filter((name) => !properties.includes(name))
if (first !== undefined && missing.length > 0) {
  console.error(`missing: ${missing.join(', ')} — suppression cannot identify a release without them`)
}

const at = Date.now()
const suppressed = await suppressedReleases(ports, token, databaseId)
console.log(`${suppressed.size} identities suppressed, read in ${Date.now() - at}ms`)

// An identity is either a MusicBrainz id or `artist|title`. Counting the split
// says whether the database's records carry ids, without printing any of them.
const byMusicbrainzId = [...suppressed].filter((identity) => !identity.includes('|')).length
console.log(`${byMusicbrainzId} by MusicBrainz id, ${suppressed.size - byMusicbrainzId} by artist and title`)

if (first !== undefined && missing.length > 0) process.exit(1)
console.log('\nthe database answers in the shape suppression reads')

// ── The write, in dry run ────────────────────────────────────────────────────
// The preflight against the real schema, and the page a real shortlist item
// would become. Nothing is posted: this is the shape of a write, not a write.

try {
  await preflightSchema(ports, token, databaseId)
  console.log('preflight: the database carries every property a run writes')
} catch (error) {
  console.error(`preflight failed: ${(error as Error).message}`)
  process.exit(1)
}

const page = notionPage(
  {
    artist: 'Ulcerate',
    title: 'Cutting the Throat of God',
    releaseDate: '2026-09-11',
    sourceUrls: ['https://loudwire.com/2026-hard-rock-metal-album-release-calendar/'],
    rank: 1,
    rationale: 'A smoke test, and not a real proposal.',
    musicbrainzId: '00000000-0000-0000-0000-000000000000',
  },
  { databaseId, runId: 'smoke', coverUrl: 'https://example.invalid/front.jpg' },
)

// The database id is in the body, so the properties are printed and the parent
// is not: this output goes into a terminal and a terminal goes into a log.
console.log(`dry run, would create: ${JSON.stringify(page.properties)}`)
console.log('\nnothing was written')
