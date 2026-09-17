import { test } from 'node:test'
import assert from 'node:assert/strict'

import { NO_ANSWER, describeStatus, retriedNote } from './http-outcome.ts'

test('an answered request is described by its status', () => {
  assert.equal(describeStatus({ status: 503, body: 'service unavailable', attempts: 1 }), 'HTTP 503')
})

test('an unanswered request is described by what went wrong, not as HTTP 0', () => {
  assert.equal(
    describeStatus({
      status: NO_ANSWER,
      body: 'fetch failed: getaddrinfo ENOTFOUND musicbrainz.org',
      attempts: 1,
    }),
    'no answer: fetch failed: getaddrinfo ENOTFOUND musicbrainz.org',
  )
})

test('a call that took more than one attempt says so, and one that did not stays quiet', () => {
  assert.equal(describeStatus({ status: 503, body: 'down', attempts: 3 }), 'HTTP 503 after 3 attempts')
  assert.equal(
    describeStatus({ status: NO_ANSWER, body: 'fetch failed: ECONNRESET', attempts: 2 }),
    'no answer: fetch failed: ECONNRESET after 2 attempts',
  )
  assert.equal(
    describeStatus({ status: 403, body: 'go away', attempts: 1 }),
    'HTTP 403',
    'one attempt is the unremarkable case',
  )
})

test('a success that took more than one attempt accounts for itself, and one that did not is silent', () => {
  assert.equal(retriedNote('musicbrainz.org', 3), 'musicbrainz.org answered after 3 attempts')
  assert.equal(retriedNote('musicbrainz.org', 1), undefined, 'the unremarkable case says nothing')
})
