/**
 * A live smoke test against the Cover Art Archive. Invoked by hand
 * (`npm run smoke:coverart`), never by the automated suite.
 *
 * It needs no key, and it asks about two release groups: one that has a cover
 * and one that does not. The second is the case that matters, because a cover
 * that is missing must be silence rather than a failure — a run is never worth
 * losing over a picture.
 */

import process from 'node:process'

import { httpAdapter } from '../src/adapters/http.ts'
import { coverArtUrl } from '../src/clients/coverart.ts'
import type { Ports } from '../src/ports.ts'

const ports = { http: httpAdapter(), clock: { now: () => new Date() } } as Ports

// Ulcerate, *Cutting the Throat of God*, as MusicBrainz identifies it.
const withArt = 'c302ec77-589f-462f-b6b3-d63508886978'
// A release group id that cannot exist, standing in for one with no art.
const withoutArt = '00000000-0000-0000-0000-000000000000'

const found = await coverArtUrl(ports, withArt)
console.log(`cover for ${withArt}: ${found ?? '(none)'}`)

// Without this the whole script passes when the network is unreachable, which
// is exactly the failure a smoke test exists to catch.
if (found === undefined) {
  console.error('a release group that has cover art answered with none; the archive was not reached')
  process.exit(1)
}

const missing = await coverArtUrl(ports, withoutArt)
console.log(`cover for ${withoutArt}: ${missing ?? '(none)'}`)

if (missing !== undefined) {
  console.error('a release group with no art answered with an address; the best-effort rule is not holding')
  process.exit(1)
}

console.log('\nno art is silence, which is what a run depends on')
