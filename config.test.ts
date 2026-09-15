import { test } from 'node:test'
import assert from 'node:assert/strict'

import { REQUIRED_CREDENTIALS, missingCredentials } from './config.ts'

const complete = {
  FIREWORKS_API_KEY: 'fw-key',
  TAVILY_API_KEY: 'tavily-key',
  NOTION_TOKEN: 'ntn-token',
  NOTION_DATABASE_ID: 'db-id',
}

test('a complete environment is missing nothing', () => {
  assert.deepEqual(missingCredentials(complete), [])
})

test('an empty environment is missing every credential', () => {
  assert.deepEqual(missingCredentials({}), [...REQUIRED_CREDENTIALS])
})

test('one unset variable is reported alone', () => {
  const { NOTION_TOKEN, ...rest } = complete
  assert.deepEqual(missingCredentials(rest), ['NOTION_TOKEN'])
})

test('a blank or whitespace-only variable counts as missing', () => {
  assert.deepEqual(missingCredentials({ ...complete, NOTION_TOKEN: '   ' }), ['NOTION_TOKEN'])
  assert.deepEqual(missingCredentials({ ...complete, FIREWORKS_API_KEY: '' }), [
    'FIREWORKS_API_KEY',
  ])
})

test('names are returned, never values', () => {
  // The result is logged, so it must never be able to carry a secret.
  assert.deepEqual(missingCredentials({ ...complete, NOTION_TOKEN: '' }).join(), 'NOTION_TOKEN')
})
