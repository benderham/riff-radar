/**
 * One Notion page, as a shortlist item becomes it.
 *
 * Pure, and tested without a network, because this is where the agent's
 * promises about what it writes are kept: `Status` is always `Proposed`, the
 * run identifier and the rationale and a source URL are always present, and
 * `Rating` is never written by any path. The property table in `config.ts` is
 * the only list of names, so the preflight and this builder cannot disagree.
 */

import { APPLE_MUSIC_SEARCH, NOTION_PROPOSED } from '../../config.ts'
import type { ShortlistItem } from './shortlist.ts'

/** Notion refuses a rich-text value longer than this, and a 400 fails the write. */
const MAX_TEXT = 2_000

const text = (value: string) => [{ text: { content: value.slice(0, MAX_TEXT) } }]

/**
 * Where Ben goes to listen. A search rather than a catalogue link: no key, no
 * identifier that can go stale, and the album is one tap away on the phone he
 * actually listens on.
 */
export const appleMusicSearchUrl = (artist: string, title: string): string =>
  `${APPLE_MUSIC_SEARCH}${encodeURIComponent(`${artist} ${title}`)}`

/**
 * What a degraded run's proposal rests on, said in the record itself: MusicBrainz
 * could not be reached, so nothing checked the source's word (ADR-0052).
 */
const WITHOUT_MUSICBRAINZ =
  'Judged without MusicBrainz: it was unavailable during this run, so the format is the source\'s ' +
  'own word — no reissue, remaster or EP check ran.'

/** A page as Notion's create endpoint takes it. */
export interface NotionPage {
  readonly parent: { database_id: string }
  /** The album cover, where there is one: the page's own image, not a property. */
  readonly cover?: { external: { url: string } }
  readonly properties: Record<string, Record<string, unknown>>
}

const rationale = (item: ShortlistItem): string => {
  const said = item.rationale ?? ''
  if (item.judgedWithoutMusicbrainz !== true) return said

  return `${said.slice(0, MAX_TEXT - WITHOUT_MUSICBRAINZ.length - 2)}\n\n${WITHOUT_MUSICBRAINZ}`
}

export const notionPage = (
  item: ShortlistItem,
  { databaseId, runId, coverUrl }: { databaseId: string; runId: string; coverUrl?: string },
): NotionPage => {
  const artist = item.artist ?? ''
  const title = item.title ?? ''
  const sourceUrl = (item.sourceUrls ?? []).find((url) => url.trim() !== '')
  const musicbrainzId = item.musicbrainzId?.trim() ?? ''

  return {
    parent: { database_id: databaseId },
    // The album cover is the page's own cover image, not a property (ADR-0041),
    // and a page without one is a page, not a failure.
    ...(coverUrl === undefined ? {} : { cover: { external: { url: coverUrl } } }),
    properties: {
      Album: { title: text(title) },
      Artist: { rich_text: text(artist) },
      ...(item.releaseDate === undefined ? {} : { 'Release Date': { date: { start: item.releaseDate } } }),
      'Apple Music': { url: appleMusicSearchUrl(artist, title) },
      Status: { select: { name: NOTION_PROPOSED } },
      // An Unverified release writes an empty cell rather than a made-up id:
      // suppression falls back to artist and title, which is what it does for
      // every record Ben entered by hand.
      'MusicBrainz ID': { rich_text: musicbrainzId === '' ? [] : text(musicbrainzId) },
      ...(sourceUrl === undefined ? {} : { 'Source URL': { url: sourceUrl } }),
      // A proposal resting on weaker evidence says so where Ben reads it, in
      // the property that is already prose, rather than in a new column his
      // database would have to grow for it (ADR-0052). The rationale gives up
      // the room rather than the note: a cut that dropped the caveat would
      // leave the record looking better evidenced than it is.
      Rationale: { rich_text: text(rationale(item)) },
      'Run ID': { rich_text: text(runId) },
    },
  }
}
