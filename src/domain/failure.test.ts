import { test } from 'node:test'
import assert from 'node:assert/strict'

import { NO_ANSWER } from './http-outcome.ts'
import { categoriseFailure, categoryOf, isRetryable, withCategory } from './failure.ts'

test('a request that got no answer is transient', () => {
  assert.equal(categoriseFailure(NO_ANSWER, 'fetch failed: ENOTFOUND'), 'transient')
})

test('a server that is having trouble is transient', () => {
  assert.equal(categoriseFailure(503, 'service unavailable'), 'transient')
  assert.equal(categoriseFailure(500, ''), 'transient')
})

test('a rate limit is its own category, because Retry-After changes the backoff', () => {
  assert.equal(categoriseFailure(429, 'slow down'), 'rate_limited')
})

test("a provider's own gate refusing inside a 200 is a rate limit", () => {
  assert.equal(categoriseFailure(200, '{"error":"Your requests are exceeding the allowable rate limit."}'), 'rate_limited')
})

test('credentials and bot walls are refusals', () => {
  assert.equal(categoriseFailure(401, ''), 'refused')
  assert.equal(categoriseFailure(403, 'Forbidden'), 'refused')
})

test('a 404 is an answer, not a failure of the call', () => {
  assert.equal(categoriseFailure(404, ''), 'not_found')
})

test('any other refusal is a refusal rather than a category of its own', () => {
  assert.equal(categoriseFailure(400, 'bad request'), 'refused')
  assert.equal(categoriseFailure(410, 'gone'), 'refused')
})

test('a successful answer has no category', () => {
  assert.equal(categoriseFailure(200, '{"candidates":[]}'), undefined)
  assert.equal(categoriseFailure(201, ''), undefined)
  // Cover art answers with a redirect it deliberately does not follow.
  assert.equal(categoriseFailure(307, ''), undefined)
})

test('only the two categories worth asking again about are retryable', () => {
  assert.equal(isRetryable('transient'), true)
  assert.equal(isRetryable('rate_limited'), true)
  for (const category of ['refused', 'not_found', 'malformed', 'unavailable'] as const) {
    assert.equal(isRetryable(category), false)
  }
})

test('a thrown failure carries its category to whoever catches it', () => {
  const error = withCategory(new Error('Notion refused a page with HTTP 403'), 'refused')
  assert.equal(categoryOf(error), 'refused')
  assert.equal(error.message, 'Notion refused a page with HTTP 403')
})

test('an error nobody categorised has no category', () => {
  assert.equal(categoryOf(new Error('something else entirely')), undefined)
  assert.equal(categoryOf('not an error at all'), undefined)
})
