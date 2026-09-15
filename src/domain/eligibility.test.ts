import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { Candidate, MusicbrainzLookup } from './candidates.ts'
import { isEligible } from './eligibility.ts'
import type { DateWindow } from './window.ts'

const WINDOW: DateWindow = { from: '2026-09-08', to: '2026-09-14' }

const found = (over: Partial<Extract<MusicbrainzLookup, { found: true }>> = {}): MusicbrainzLookup => ({
  found: true,
  releaseGroupId: 'rg-1',
  primaryType: 'Album',
  secondaryTypes: [],
  firstReleaseDate: '2026-09-12',
  artistCount: 1,
  ...over,
})

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  artist: 'Ulcerate',
  title: 'Cutting the Throat of God',
  releaseDates: ['2026-09-12'],
  sourceUrls: ['https://loudwire.test/calendar'],
  lookup: found(),
  ...over,
})

const why = (over: Partial<Candidate> = {}): string => {
  const verdict = isEligible(candidate(over), WINDOW)
  return verdict.eligible ? '' : verdict.reason
}

// ── The two formats that qualify ─────────────────────────────────────────────

test('an album released in the window is eligible', () => {
  assert.equal(isEligible(candidate(), WINDOW).eligible, true)
})

test('an EP is eligible at exactly four tracks and twenty minutes', () => {
  const ep = { lookup: found({ primaryType: 'EP', trackCount: 4, durationMs: 20 * 60_000 }) }
  assert.equal(isEligible(candidate(ep), WINDOW).eligible, true)
})

test('an EP one track short is not', () => {
  assert.match(why({ lookup: found({ primaryType: 'EP', trackCount: 3, durationMs: 30 * 60_000 }) }), /4 tracks/)
})

test('an EP one minute short is not', () => {
  const short = { lookup: found({ primaryType: 'EP', trackCount: 6, durationMs: 19 * 60_000 }) }
  assert.match(why(short), /20 minutes/)
})

test('an EP whose tracks MusicBrainz did not report is excluded, not guessed at', () => {
  // ADR-0010: data needed to confirm eligibility is missing, so it excludes.
  assert.match(why({ lookup: found({ primaryType: 'EP' }) }), /track/)
})

// ── The formats that do not ──────────────────────────────────────────────────

test('a single is not an album however long it is', () => {
  assert.match(why({ lookup: found({ primaryType: 'Single' }) }), /Single/)
})

for (const secondary of ['Live', 'Compilation', 'Remix', 'DJ-mix', 'Demo', 'Soundtrack']) {
  test(`a ${secondary} release is excluded`, () => {
    assert.match(why({ lookup: found({ secondaryTypes: [secondary] }) }), new RegExp(secondary))
  })
}

test('a split is excluded on its credited artists', () => {
  assert.match(why({ lookup: found({ artistCount: 2 }) }), /split/i)
})

// ── Dates: the window, reissues, and the future ──────────────────────────────

test('a reissue is excluded because its release group is older than the window', () => {
  // A reissue and a remaster are releases inside the original release group, so
  // the group's first-release-date is the original's. A source listing this
  // week's vinyl reissue of a 2019 album is naming a release group from 2019.
  const reissue = { lookup: found({ firstReleaseDate: '2019-04-05' }) }
  assert.match(why(reissue), /2019-04-05/)
})

test('a total re-record is eligible: MusicBrainz gives it its own release group', () => {
  // The carve-out falls out of the data model rather than a rule of ours. A
  // re-recording is a new release group with a new first-release-date; only a
  // reissue or remaster stays inside the old one.
  const reRecord = { title: 'Ashes (2026)', lookup: found({ releaseGroupId: 'rg-2', firstReleaseDate: '2026-09-10' }) }
  assert.equal(isEligible(candidate(reRecord), WINDOW).eligible, true)
})

test('a year-only MusicBrainz date still excludes a plainly older release group', () => {
  // Real data: Exodus's "Bonded by Blood" release group is dated `1985`, and
  // holds fifteen releases — every reissue and remaster of it since. A partial
  // date that is unambiguously before the window is a reissue, not a mystery.
  assert.match(why({ lookup: found({ firstReleaseDate: '1985' }) }), /1985.*reissue or remaster/)
  assert.match(why({ lookup: found({ firstReleaseDate: '2019-04' }) }), /2019-04.*reissue or remaster/)
})

test('a partial date that overlaps the window is missing data, not a guess', () => {
  // `2026` could be any day of the year, so it cannot place the release in or
  // out of a seven-day window either way.
  assert.match(why({ lookup: found({ firstReleaseDate: '2026' }) }), /only as 2026/)
  assert.match(why({ lookup: found({ firstReleaseDate: '2026-09' }) }), /only as 2026-09/)
})

test('a release dated after the window has not been issued yet', () => {
  const future = { releaseDates: ['2026-11-01'], lookup: found({ firstReleaseDate: '2026-11-01' }) }
  assert.match(why(future), /2026-11-01/)
})

test('one source in the window is enough when they disagree', () => {
  // The disagreement is recorded, not resolved: MusicBrainz agrees with one of them.
  const disagreeing = { releaseDates: ['2026-09-07', '2026-09-12'] }
  assert.equal(isEligible(candidate(disagreeing), WINDOW).eligible, true)
})

// ── What a lookup that never happened, or found nothing, means ───────────────

test('a candidate nobody looked up is excluded', () => {
  const { lookup: _unused, ...neverLookedUp } = candidate()
  const verdict = isEligible(neverLookedUp, WINDOW)
  assert.match(verdict.eligible ? '' : verdict.reason, /not looked up/)
})

test('a candidate MusicBrainz has never heard of falls back to what the source said', () => {
  // Unverified is missing evidence, not invalidity (CONTEXT.md), so the run
  // uses the only format statement it has: the source's own.
  const unverified = { lookup: { found: false } as MusicbrainzLookup, format: 'full-length' }
  assert.equal(isEligible(candidate(unverified), WINDOW).eligible, true)
})

test('an unverified release the source called a live album is still excluded', () => {
  const live = { lookup: { found: false } as MusicbrainzLookup, format: 'live album' }
  assert.match(why(live), /live/i)
})

test('an unverified release no source described is excluded', () => {
  // The base candidate states no format, which is the case being tested.
  assert.match(why({ lookup: { found: false } as MusicbrainzLookup }), /no source stated a format/)
})
