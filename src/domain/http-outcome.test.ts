import { test } from 'node:test'
import assert from 'node:assert/strict'

import { NO_ANSWER, describeStatus } from './http-outcome.ts'

test('an answered request is described by its status', () => {
  assert.equal(describeStatus(503, 'service unavailable'), 'HTTP 503')
})

test('an unanswered request is described by what went wrong, not as HTTP 0', () => {
  assert.equal(
    describeStatus(NO_ANSWER, 'fetch failed: getaddrinfo ENOTFOUND musicbrainz.org'),
    'no answer: fetch failed: getaddrinfo ENOTFOUND musicbrainz.org',
  )
})

test('a call that took more than one attempt says so, and one that did not stays quiet', () => {
  assert.equal(describeStatus(503, 'down', 3), 'HTTP 503 after 3 attempts')
  assert.equal(
    describeStatus(NO_ANSWER, 'fetch failed: ECONNRESET', 2),
    'no answer: fetch failed: ECONNRESET after 2 attempts',
  )
  assert.equal(describeStatus(403, 'go away', 1), 'HTTP 403', 'one attempt is the unremarkable case')
  assert.equal(describeStatus(403, 'go away'), 'HTTP 403', 'and is what a caller without a count means')
})
