/**
 * Counting tokens and pricing them.
 *
 * Three rates, never two (ADR-0020). Cached input is roughly thirty times
 * cheaper than uncached, so summing the two into one input count would
 * misreport the cost of a run by up to that factor — and a hand-written loop
 * resends a growing history on every step, so cache behaviour dominates.
 */

import { PRICE_PER_MILLION } from '../../config.ts'

export interface Usage {
  readonly uncachedInputTokens: number
  readonly cachedInputTokens: number
  readonly outputTokens: number
}

export const NO_USAGE: Usage = {
  uncachedInputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
}

export const addUsage = (a: Usage, b: Usage): Usage => ({
  uncachedInputTokens: a.uncachedInputTokens + b.uncachedInputTokens,
  cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
})

export const estimateCost = (usage: Usage): number =>
  (usage.uncachedInputTokens * PRICE_PER_MILLION.uncachedInput +
    usage.cachedInputTokens * PRICE_PER_MILLION.cachedInput +
    usage.outputTokens * PRICE_PER_MILLION.output) /
  1_000_000
