/**
 * The stable prefix.
 *
 * The system prompt, the tool definitions and the taste profile are identical
 * on every step of a run, so they go at the front of every request, ahead of
 * anything that varies (ADR-0020). A hand-written loop resends a growing
 * history each step; if the unchanging part were not first, none of it would be
 * cacheable and a run would cost roughly thirty times more than it needs to.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { TasteProfile } from '../domain/taste-profile.ts'
import type { DateWindow } from '../domain/window.ts'
import type { ModelMessage } from '../ports.ts'

const SYSTEM_PROMPT = readFileSync(fileURLToPath(new URL('./system.md', import.meta.url)), 'utf8')

/** Invariant for the life of a run, and identical across runs of one version. */
export const stablePrefix = (profile: TasteProfile): ModelMessage => ({
  role: 'system',
  content: `${SYSTEM_PROMPT}\n## Taste profile\n\n\`\`\`json\n${JSON.stringify(profile, null, 2)}\n\`\`\`\n`,
})

/** The one thing that varies per run but not per step. */
export const runBrief = (window: DateWindow): ModelMessage => ({
  role: 'user',
  content: `Find metal albums released between ${window.from} and ${window.to} inclusive, and finish with your shortlist.`,
})
