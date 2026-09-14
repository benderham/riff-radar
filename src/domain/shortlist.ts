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
})

export type ShortlistItem = z.infer<typeof shortlistItemSchema>

/**
 * What makes two records the same release: the MusicBrainz release-group id
 * where one exists, and artist and title where one does not.
 */
export const releaseIdentity = (item: ShortlistItem): string =>
  item.musicbrainzId?.trim() ||
  `${item.artist?.trim().toLowerCase()}|${item.title?.trim().toLowerCase()}`

const present = (value: string | undefined): boolean => (value ?? '').trim().length > 0

const itemErrors = (item: ShortlistItem, position: number, window: DateWindow): string[] => {
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

  if (!present(item.releaseDate)) {
    errors.push(`${at}: missing release date`)
  } else if (item.releaseDate! < window.from || item.releaseDate! > window.to) {
    errors.push(`${at}: release date ${item.releaseDate} is outside ${window.from}..${window.to}`)
  }

  return errors
}

export type ShortlistValidation = { readonly ok: true } | { readonly ok: false; readonly errors: readonly string[] }

export const validateShortlist = (
  items: readonly ShortlistItem[],
  window: DateWindow,
): ShortlistValidation => {
  const errors: string[] = []

  if (items.length === 0) errors.push('shortlist is empty')
  if (items.length > SHORTLIST_SIZE) {
    errors.push(`shortlist has ${items.length} items; the maximum is ${SHORTLIST_SIZE}`)
  }

  const seen = new Set<string>()
  for (const [index, item] of items.entries()) {
    errors.push(...itemErrors(item, index + 1, window))

    const identity = releaseIdentity(item)
    if (seen.has(identity)) errors.push(`item ${index + 1}: duplicate release ${identity}`)
    seen.add(identity)
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}
