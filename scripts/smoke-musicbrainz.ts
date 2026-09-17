/**
 * A live smoke test against MusicBrainz. Invoked by hand
 * (`npm run smoke:musicbrainz`), never by the automated suite: the suite must
 * not depend on a network or somebody else's rate limit.
 *
 * It checks what the automated tests cannot — that the bodies MusicBrainz
 * actually serves are still the shapes `musicbrainz.ts` parses — across the
 * three cases that matter: an album, an EP whose tracks are counted, and a
 * release nobody has entered. The adjacency signals are printed with each, so
 * a label, a genre list or a lineup that has quietly stopped arriving is
 * visible here rather than as a release that ranks oddly. When it disagrees
 * with `fixtures/musicbrainz-*`, the real bodies win and replace them.
 *
 * It needs no key. MusicBrainz asks only for a contactable user agent, which
 * `USER_AGENT` carries.
 */

import process from 'node:process'

import { systemClock } from '../src/adapters/clock.ts'
import { httpAdapter } from '../src/adapters/http.ts'
import { lookupRelease } from '../src/clients/musicbrainz.ts'
import type { Ports } from '../src/ports.ts'

const ports = { http: httpAdapter(systemClock), clock: systemClock } as Ports

const CASES = [
  { artist: 'Ulcerate', title: 'Cutting the Throat of God', expect: 'an album' },
  // Ulcerate Fester, deliberately: a different band from Ulcerate, whose EP a
  // fuzzy search offers up when asked about Ulcerate. Getting this one right
  // proves the match rule as well as the second request.
  { artist: 'Ulcerate Fester', title: 'Unceasing Life', expect: 'an EP, with its tracks counted' },
  { artist: 'Vaultwraith Of Nowhere', title: 'Crimson Nadir Unreleased', expect: 'nothing at all' },
] as const

let failures = 0

for (const { artist, title, expect } of CASES) {
  const at = Date.now()
  const result = await lookupRelease(ports, artist, title)
  console.log(`\n${artist} — ${title}  (expecting ${expect}, ${Date.now() - at}ms)`)
  if (result.warning !== undefined) console.log(`  warning: ${result.warning}`)

  if (result.lookup.found) {
    const { releaseGroupId, primaryType, firstReleaseDate, trackCount, durationMs } = result.lookup
    const { label, genres, members } = result.lookup
    console.log(`  ${releaseGroupId}  ${primaryType ?? '(no type)'}  ${firstReleaseDate ?? '(no date)'}`)
    if (trackCount !== undefined || durationMs !== undefined) {
      console.log(`  ${trackCount ?? '?'} tracks, ${Math.round((durationMs ?? 0) / 60_000)} minutes`)
    }
    console.log(`  label: ${label ?? '(none)'}`)
    console.log(`  genres: ${genres?.join(', ') ?? '(none)'}`)
    console.log(`  members: ${members?.length ?? 0} named${members === undefined ? '' : ` — ${members.slice(0, 4).join(', ')}`}`)
  } else {
    console.log('  not found')
  }

  // Each case asserts only what it is here to prove. The third is expected to
  // find nothing, so finding nothing is its success.
  const ok =
    expect === 'nothing at all'
      ? !result.lookup.found && result.warning === undefined
      : result.lookup.found && result.warning === undefined
  if (!ok) {
    failures += 1
    console.error('  ^ not what this case expects')
  } else if (expect.startsWith('an EP') && result.lookup.found && result.lookup.trackCount === undefined) {
    failures += 1
    console.error('  ^ an EP came back without its track count: the release request is not working')
  } else if (expect === 'an album' && result.lookup.found && result.lookup.label === undefined) {
    // Asserted for the album alone. Coverage is uneven by design, and the one
    // case whose label is known to be entered is the one worth failing on.
    failures += 1
    console.error('  ^ a release whose label MusicBrainz holds came back without it')
  }
}

if (failures > 0) {
  console.error(`\n${failures} case(s) disagreed; check src/clients/musicbrainz.ts against the output above`)
  process.exit(1)
}
console.log('\nall three cases behaved as the client expects')
