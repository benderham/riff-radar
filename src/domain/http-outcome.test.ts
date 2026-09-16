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
