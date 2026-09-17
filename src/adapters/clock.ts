/**
 * The clock, as the outside world actually keeps it.
 *
 * Two methods because the project has two reasons to touch time: resolving the
 * window against local-time components, and waiting — backoff, and MusicBrainz's
 * one-request-per-second gate. Both go through the port so a test controls both
 * (ADR-0018), and this is the one implementation that really waits.
 */

import type { ClockPort } from '../ports.ts'

export const systemClock: ClockPort = {
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}
