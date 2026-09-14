/** The system clock. The only implementation of `ClockPort` that reads real time. */

import type { ClockPort } from '../ports.ts'

export const systemClock: ClockPort = {
  now: () => new Date(),
}
