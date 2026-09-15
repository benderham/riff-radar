/**
 * The shortlist, and what makes one valid.
 *
 * Validation is a pure function over the proposed items and the run's resolved
 * window, because it is the last guardrail before an external write and must be
 * provable without a model, a network or a database.
 *
 * The action schema deliberately types every item field as optional. Presence
 * is a shortlist rule, not an argument-shape rule: if a missing `artist` failed
 * schema validation it would be recorded as an invalid action, and the run that
 * proposed a broken shortlist would be indistinguishable from the run that
 * proposed a malformed tool call. One rule, one place, one termination reason.
 */

import { z } from 'zod'

import { SHORTLIST_SIZE } from '../../config.ts'
import type { Candidate } from './candidates.ts'
import { artistTitleIdentity, candidateIdentity } from './candidates.ts'
import { isEligible } from './eligibility.ts'
import type { TasteProfile } from './taste-profile.ts'
import type { DateWindow } from './window.ts'

export const shortlistItemSchema = z.object({
  artist: z.string().optional(),
  title: z.string().optional(),
  /** `YYYY-MM-DD`, inside the run's resolved window. */
  releaseDate: z.string().optional(),
  sourceUrls: z.array(z.string()).optional(),
  rank: z.number().optional(),
  rationale: z.string().optional(),
  /** A MusicBrainz release-group id, or `unverified: true` in its place. */
  musicbrainzId: z.string().optional(),
  unverified: z.boolean().optional(),
  /**
   * The one judgement of the model's that scores: what this release resembles,
   * and the Source Text it read that in. An uncited claim is not refused — it
   * simply contributes nothing to the ranking (ADR-0037).
   */
  vibe: z.object({ claim: z.string(), quote: z.string() }).optional(),
})

export type ShortlistItem = z.infer<typeof shortlistItemSchema>

/**
 * What makes two records the same release: the MusicBrainz release-group id
 * where one exists, and artist and title where one does not.
 */
export const releaseIdentity = (item: ShortlistItem): string =>
  item.musicbrainzId?.trim() || artistTitleIdentity(item.artist ?? '', item.title ?? '')

const present = (value: string | undefined): boolean => (value ?? '').trim().length > 0

const itemErrors = (
  item: ShortlistItem,
  position: number,
  window: DateWindow,
  discovered: ReadonlyMap<string, Candidate>,
  profile: TasteProfile,
): string[] => {
  const at = `item ${position}`
  const errors: string[] = []

  if (!present(item.artist)) errors.push(`${at}: missing artist`)
  if (!present(item.title)) errors.push(`${at}: missing album title`)
  if (!present(item.rationale)) errors.push(`${at}: missing rationale`)
  if (!Number.isInteger(item.rank)) errors.push(`${at}: missing or non-integer rank`)

  // Provenance is the thing that cannot be reconstructed later, so its absence
  // invalidates. A missing MusicBrainz id can be honestly declared instead.
  if (!(item.sourceUrls ?? []).some(present)) errors.push(`${at}: no source URL`)
  if (!present(item.musicbrainzId) && item.unverified !== true) {
    errors.push(`${at}: no MusicBrainz id and no explicit unverified: true`)
  }

  // Where a candidate may come from, enforced rather than asked for. Only a
  // source fetch adds to the run's candidates, so an item that matches none of
  // them is a release the model met somewhere else — a web search, or its own
  // training — and the rule that discovery is reproducible (ADR-0001) is worth
  // no more than the code that refuses to let it through.
  const candidate =
    present(item.artist) && present(item.title)
      ? discovered.get(artistTitleIdentity(item.artist!, item.title!))
      : undefined

  if (present(item.artist) && present(item.title) && candidate === undefined) {
    errors.push(`${at}: ${item.artist} — ${item.title} is not among the candidates any source listed`)
  }

  // Eligibility is the brief's rule about what deserves one of five slots, and
  // until now it lived only in the system prompt, which makes it a request
  // rather than a rule. The model still does the choosing; this refuses the
  // choices the rules do not allow (ADR-0035).
  if (candidate !== undefined) {
    const verdict = isEligible(candidate, window, profile)
    if (!verdict.eligible) {
      errors.push(`${at}: ${item.artist} — ${item.title} is not eligible: ${verdict.reason}`)
    }
  }

  if (!present(item.releaseDate)) {
    errors.push(`${at}: missing release date`)
  } else if (item.releaseDate! < window.from || item.releaseDate! > window.to) {
    errors.push(`${at}: release date ${item.releaseDate} is outside ${window.from}..${window.to}`)
  }

  return errors
}

export type ShortlistValidation = { readonly ok: true } | { readonly ok: false; readonly errors: readonly string[] }

/** Spelling and spacing differ between a calendar, MusicBrainz and a hand-edited profile. */
const sameName = (one: string, other: string): boolean =>
  one.trim().toLowerCase() === other.trim().toLowerCase()

const isAlways = (artists: readonly string[], profile: TasteProfile): boolean =>
  artists.some((artist) => profile.artists.always.some((name) => sameName(name, artist)))

/**
 * `artists.always` guarantees a shortlist slot, so an eligible release by one
 * of those artists that the model left off is a refused shortlist rather than
 * a missed opportunity (ADR-0007). Enforced here for the same reason
 * eligibility is: the prompt has asked for it since the first version, and
 * asking is not enforcing (ADR-0035).
 *
 * A guarantee that cannot be honoured is not held against the run: once the
 * shortlist is full of guaranteed artists there is no slot left to guarantee,
 * and the remaining ones are reported by their absence from a full list.
 */
const missingGuarantees = (
  items: readonly ShortlistItem[],
  window: DateWindow,
  candidates: readonly Candidate[],
  profile: TasteProfile,
): string[] => {
  if (profile.artists.always.length === 0) return []

  const shortlisted = new Set(
    items.map((item) => artistTitleIdentity(item.artist ?? '', item.title ?? '')),
  )

  const guaranteed = candidates.filter(
    (candidate) =>
      isAlways(
        candidate.lookup?.found === true && candidate.lookup.artists.length > 0
          ? candidate.lookup.artists
          : [candidate.artist],
        profile,
      ) && isEligible(candidate, window, profile).eligible,
  )

  const present = guaranteed.filter((candidate) => shortlisted.has(candidateIdentity(candidate)))
  if (present.length >= SHORTLIST_SIZE) return []

  return guaranteed
    .filter((candidate) => !shortlisted.has(candidateIdentity(candidate)))
    .map(
      (candidate) =>
        `${candidate.artist} — ${candidate.title} is on the profile's always list and eligible, and is not on the shortlist`,
    )
}

export const validateShortlist = (
  items: readonly ShortlistItem[],
  window: DateWindow,
  candidates: readonly Candidate[],
  profile: TasteProfile,
): ShortlistValidation => {
  const errors: string[] = []
  const discovered = new Map(candidates.map((candidate) => [candidateIdentity(candidate), candidate]))

  if (items.length === 0) errors.push('shortlist is empty')
  if (items.length > SHORTLIST_SIZE) {
    errors.push(`shortlist has ${items.length} items; the maximum is ${SHORTLIST_SIZE}`)
  }

  errors.push(...missingGuarantees(items, window, candidates, profile))

  const seen = new Set<string>()
  for (const [index, item] of items.entries()) {
    errors.push(...itemErrors(item, index + 1, window, discovered, profile))

    const identity = releaseIdentity(item)
    if (seen.has(identity)) errors.push(`item ${index + 1}: duplicate release ${identity}`)
    seen.add(identity)
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}
