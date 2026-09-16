/**
 * Album cover art, best-effort.
 *
 * The Cover Art Archive indexes by MusicBrainz release group, so a release the
 * run never identified has no cover to ask for and is not asked about. Every
 * other outcome — no art, a refusal, a timeout, an answer this does not read —
 * is the same outcome: no cover. Nothing here can fail a run, which is the
 * whole of the rule the ticket states about it.
 *
 * The answer is the redirect. `/front` replies 307 with the image's address
 * when there is art and 404 when there is not, so one request that is
 * deliberately *not* followed settles it: no image is downloaded through this
 * process, and nothing here depends on the storage hosts the archive redirects
 * to — which are numbered, rotate between requests, and cannot be allowlisted
 * by anyone sitting behind a firewall.
 */

import { COVER_ART_ENDPOINT } from '../../config.ts'
import type { Ports } from '../ports.ts'

/** The address of the front cover, or nothing. */
export const coverArtUrl = async (
  ports: Ports,
  releaseGroupId: string,
): Promise<string | undefined> => {
  const front = `${COVER_ART_ENDPOINT}/${releaseGroupId}/front`

  const response = await ports.http.get(front, {}, { followRedirects: false })
  if (response.status < 300 || response.status >= 400) return undefined

  // The archive's own address is the stable one, and it is what a later reader
  // would type; the redirect target carries a storage node's name and today's
  // file name. Notion follows the redirect itself when it renders the page.
  return front
}
