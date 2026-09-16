/**
 * What makes a Candidate an Eligible Release.
 *
 * Pure arithmetic over what the sources said and what MusicBrainz knew, so the
 * rules can be proved without a network, a model or a database. The model is
 * told these rules in the prompt and asked to apply them, but asking is not
 * enforcing: `validateShortlist` runs this over every proposed item, so a
 * release that fails here cannot reach Notion however good the rationale.
 *
 * The verdict carries its reason rather than a boolean, because both readers
 * need it — the trace, to explain an absence, and the model, to be told why an
 * item it liked was refused.
 *
 * Two of the rules fall out of MusicBrainz's data model rather than being
 * invented here, which is why they are short. A reissue and a remaster are
 * releases inside the original's release group, so the group's
 * `first-release-date` is the original's and a reissue in this week's calendar
 * is a release group from years ago. A total re-record, by contrast, gets its
 * own release group with its own date, so the carve-out the brief asks for is
 * simply what the data already says (ADR-0034).
 */

import type { Candidate } from './candidates.ts'
import { creditedArtists, sameName } from './candidates.ts'
import type { TasteProfile } from './taste-profile.ts'
import type { DateWindow } from './window.ts'

export type Eligibility =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: string }

const no = (reason: string): Eligibility => ({ eligible: false, reason })
const YES: Eligibility = { eligible: true }

/** An EP earns a slot only by being substantial; the brief sets both numbers. */
const EP_MIN_TRACKS = 4
const EP_MIN_MINUTES = 20

/**
 * Secondary types that are never a new album. `Demo` and `Mixtape/Street` are
 * here with the obvious ones because neither is the finished work Ben is
 * looking for, and `Broadcast` and `Other` are handled with the primary types.
 */
const EXCLUDED_SECONDARY = new Set([
  'Live',
  'Compilation',
  'Remix',
  'DJ-mix',
  'Demo',
  'Soundtrack',
  'Mixtape/Street',
  'Interview',
  'Audiobook',
  'Audio drama',
  'Spokenword',
])

/**
 * What a source's own words are worth when MusicBrainz cannot help.
 *
 * Only consulted for an Unverified release. The strings are what release
 * calendars actually print, and anything unrecognised is missing data rather
 * than an album, because a format nobody stated cannot be confirmed (ADR-0010).
 */
const SOURCE_FORMAT_EXCLUSIONS = /\b(live|single|compilation|reissue|remaster|demo|EP)\b/i
const SOURCE_FORMAT_ALBUM = /\b(album|full[- ]?length|LP)\b/i

/**
 * A release group MusicBrainz dates before the window is not this week's news,
 * whatever a calendar says — it is a reissue, a remaster, or a page listing an
 * old record. Where MusicBrainz is silent the sources decide between them, and
 * one of them placing it inside the window is enough: they disagree by a day or
 * two routinely, and the disagreement is recorded rather than resolved.
 */
const dateVerdict = (candidate: Candidate, window: DateWindow): Eligibility => {
  const looked = candidate.lookup
  const official = looked?.found === true ? looked.firstReleaseDate : undefined

  if (official !== undefined) {
    // MusicBrainz serves partial dates: Exodus's "Bonded by Blood" release
    // group is dated `1985`. Comparing a partial date against the same prefix
    // of the window still settles the two cases that matter — `1985` is
    // unambiguously before any 2026 window — and only a partial date that
    // overlaps the window is genuinely undecidable.
    const scope = official.length
    if (official < window.from.slice(0, scope)) {
      return no(`first released ${official}, before ${window.from}: a reissue or remaster, not new work`)
    }
    if (official > window.to.slice(0, scope)) {
      return no(`first released ${official}, after ${window.to}: not issued yet`)
    }
    if (scope !== 10) return no(`MusicBrainz dates it only as ${official}`)
    return YES
  }

  if (candidate.releaseDates.some((date) => date >= window.from && date <= window.to)) return YES

  // Already ascending: `mergeCandidates` sorts, so the first is the earliest.
  const stated = candidate.releaseDates[0]
  if (stated === undefined) return no('no source stated a release date')

  return no(`no source dates it inside ${window.from}..${window.to}; earliest is ${stated}`)
}

/**
 * The source's own word about the format, for the two cases where MusicBrainz
 * has none: a release it has never heard of, and a release group nobody has
 * typed (ADR-0045). Both are missing a type; neither is evidence of what the
 * record is not.
 */
const statedFormatVerdict = (candidate: Candidate, why: string): Eligibility => {
  const stated = candidate.format ?? ''
  if (stated.trim() === '') return no(`${why}, and no source stated a format`)
  if (SOURCE_FORMAT_EXCLUSIONS.test(stated)) return no(`${why}, and the source called it a ${stated}`)
  if (!SOURCE_FORMAT_ALBUM.test(stated)) return no(`${why}, and "${stated}" is not a format this recognises`)
  return YES
}

const formatVerdict = (candidate: Candidate): Eligibility => {
  const looked = candidate.lookup

  if (looked === undefined) return no('not looked up in MusicBrainz, so its format is unconfirmed')

  if (looked.found === false) return statedFormatVerdict(candidate, 'unverified')

  const secondary = looked.secondaryTypes.find((type) => EXCLUDED_SECONDARY.has(type))
  if (secondary !== undefined) return no(`MusicBrainz calls it a ${secondary} release`)

  // An untyped release group carries *more* evidence than one MusicBrainz has
  // never heard of — a confirmed identity, date, track count and official
  // release — so refusing it while the unheard-of release passes on a
  // calendar's word had the rule the wrong way round (ADR-0045). The date
  // check above has already run, so a reissue cannot arrive through here.
  const primary = looked.primaryType
  if (primary === undefined) {
    return statedFormatVerdict(candidate, 'MusicBrainz states no release type')
  }
  if (primary === 'Album') return YES
  if (primary !== 'EP') return no(`MusicBrainz calls it a ${primary}`)

  const { trackCount, durationMs } = looked
  if (trackCount === undefined || durationMs === undefined) {
    return no('an EP whose track count and duration MusicBrainz did not report')
  }
  if (trackCount < EP_MIN_TRACKS) return no(`an EP of ${trackCount} tracks; ${EP_MIN_TRACKS} tracks are needed`)
  if (durationMs < EP_MIN_MINUTES * 60_000) {
    return no(`an EP of ${Math.round(durationMs / 60_000)} minutes; ${EP_MIN_MINUTES} minutes are needed`)
  }

  return YES
}

/**
 * One artist Ben has excluded is enough, however many others are credited. The
 * asymmetry is ADR-0007's: an exclusion is a filter, and the `always` list is a
 * ranking guarantee rather than an eligibility one — a live album does not
 * become eligible because someone on it is a favourite.
 */
const artistVerdict = (candidate: Candidate, profile: TasteProfile): Eligibility => {
  const excluded = creditedArtists(candidate).find((credited) =>
    profile.artists.exclude.some((name) => sameName(name, credited)),
  )

  return excluded === undefined ? YES : no(`${excluded} is on the profile's excluded artists`)
}

/**
 * Artist first, then format, then date. Each answer is more useful to read than
 * the next: "Disturbed is excluded" beats "a live album", which beats "dated
 * 2019", and only the first true one is reported.
 */
export const isEligible = (
  candidate: Candidate,
  window: DateWindow,
  profile: TasteProfile,
): Eligibility => {
  const artist = artistVerdict(candidate, profile)
  if (!artist.eligible) return artist

  const format = formatVerdict(candidate)
  return format.eligible ? dateVerdict(candidate, window) : format
}
