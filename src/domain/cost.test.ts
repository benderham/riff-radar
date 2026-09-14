import { test } from 'node:test'
import assert from 'node:assert/strict'

import { PRICE_PER_MILLION } from '../../config.ts'
import { NO_USAGE, addUsage, estimateCost } from './cost.ts'

test('cached input is priced at the cached rate, not the uncached one', () => {
  const cached = estimateCost({ ...NO_USAGE, cachedInputTokens: 1_000_000 })
  const uncached = estimateCost({ ...NO_USAGE, uncachedInputTokens: 1_000_000 })

  assert.equal(cached, PRICE_PER_MILLION.cachedInput)
  assert.equal(uncached, PRICE_PER_MILLION.uncachedInput)
  assert.ok(uncached > cached * 25, 'summing the two input counts would misreport cost')
})

test('all three rates contribute', () => {
  const cost = estimateCost({
    uncachedInputTokens: 1_000_000,
    cachedInputTokens: 1_000_000,
    outputTokens: 1_000_000,
  })

  assert.equal(
    cost,
    PRICE_PER_MILLION.uncachedInput + PRICE_PER_MILLION.cachedInput + PRICE_PER_MILLION.output,
  )
})

test('usage accumulates field by field', () => {
  const total = addUsage(
    { uncachedInputTokens: 1, cachedInputTokens: 2, outputTokens: 3 },
    { uncachedInputTokens: 10, cachedInputTokens: 20, outputTokens: 30 },
  )

  assert.deepEqual(total, {
    uncachedInputTokens: 11,
    cachedInputTokens: 22,
    outputTokens: 33,
  })
})
