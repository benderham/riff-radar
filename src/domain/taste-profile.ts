/**
 * The taste profile: semantic memory, hand-edited, never written by the agent.
 *
 * `version` is hand-incremented on every edit and is what a run stamps as
 * `profile_version`, so a result can be traced to the taste that produced it.
 *
 * Parsing is strict. A missing section is refused rather than defaulted to an
 * empty list, because a profile that quietly loads as empty would silently
 * change what a run surfaces.
 */

import { z } from 'zod'

const names = z.array(z.string().min(1))
const includeExclude = z.object({ include: names, exclude: names })

export const tasteProfileSchema = z.object({
  version: z.int().positive(),
  artists: z.object({ always: names, watch: names, exclude: names }),
  labels: includeExclude,
  genres: includeExclude,
  personnel: includeExclude,
  vibe_notes: includeExclude,
})

export type TasteProfile = z.infer<typeof tasteProfileSchema>
