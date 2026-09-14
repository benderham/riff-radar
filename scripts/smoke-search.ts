/**
 * A live smoke test against the search provider. Invoked by hand
 * (`npm run smoke:search`), never by the automated suite: the suite must not
 * depend on a network, a key or a quota.
 *
 * It exists to check the one thing the automated tests cannot: that the body
 * Brave actually serves is the shape `search.ts` parses. The client's tests run
 * against an invented body of the documented shape, because capturing a real
 * one needs a key. When this disagrees with them, the real body wins and
 * becomes the fixture.
 */

import process from 'node:process'

import { httpAdapter } from '../src/adapters/http.ts'
import { searchWeb } from '../src/clients/search.ts'
import type { Ports } from '../src/ports.ts'

const apiKey = process.env['BRAVE_API_KEY']
if (!apiKey) {
  console.error('BRAVE_API_KEY is not set')
  process.exit(2)
}

const ports = { http: httpAdapter() } as Ports
const query = process.argv[2] ?? 'ulcerate cutting the throat of god metal album'

const search = await searchWeb(ports, query, apiKey)

console.log(`query: ${search.query}`)
console.log(`status: ${search.status}`)
if (search.warning !== undefined) console.log(`warning: ${search.warning}`)
for (const result of search.results) {
  console.log(`\n${result.title}\n  ${result.url}\n  ${result.description.slice(0, 200)}`)
}

// Any empty result set fails, whatever the reason. A body that did not parse
// and a query nobody has written about are indistinguishable from here, and
// this script exists to be read when it fails: a real search for a real album
// returning nothing is worth Ben's attention either way.
if (search.status !== 200 || search.results.length === 0) {
  console.error('\nno usable results; check src/clients/search.ts against the body above')
  process.exit(1)
}
