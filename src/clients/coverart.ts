/**
 * Album cover art, best-effort.
 *
 * The Cover Art Archive indexes by MusicBrainz release group, so a release the
 * run never identified has no cover to ask for and is not asked about. Every
 * other outcome — no art, a refusal, a timeout, an answer in a shape this does
 * not read — is the same outcome: no cover. Nothing here can fail a run, which
 * is the whole of the rule the ticket states about it.
 *
 * The JSON index is read rather than the `/front` redirect, so this client
 * never carries an image through the `http` port: it returns an address, and
 * Notion fetches the picture itself when it renders the page.
 */

import { z } from 'zod'

import { COVER_ART_ENDPOINT } from '../../config.ts'
import type { Ports } from '../ports.ts'

const indexSchema = z.object({
  images: z.array(z.object({ image: z.string(), front: z.boolean().optional() })),
})

/**
 * The address of the front cover, or nothing.
 *
 * The archive serves `http` addresses for some entries; Notion stores what it
 * is given, so they are upgraded here rather than rendering as a broken image.
 */
export const coverArtUrl = async (
  ports: Ports,
  releaseGroupId: string,
): Promise<string | undefined> => {
  try {
    const response = await ports.http.get(`${COVER_ART_ENDPOINT}/${releaseGroupId}`, {
      accept: 'application/json',
    })
    if (response.status < 200 || response.status >= 300) return undefined

    const { images } = indexSchema.parse(JSON.parse(response.body))
    const image = images.find((each) => each.front === true) ?? images[0]

    return image?.image.replace(/^http:/, 'https:')
  } catch {
    return undefined
  }
}
