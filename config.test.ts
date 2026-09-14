import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MissingCredentialsError, REQUIRED_CREDENTIALS, loadCredentials } from './config.ts'

const complete = {
  FIREWORKS_API_KEY: 'fw-key',
  NOTION_TOKEN: 'ntn-token',
  NOTION_DATABASE_ID: 'db-id',
}

test('a complete environment yields the credentials', () => {
  assert.deepEqual(loadCredentials(complete), {
    fireworksApiKey: 'fw-key',
    notionToken: 'ntn-token',
    notionDatabaseId: 'db-id',
  })
})

test('an empty environment is refused, naming every missing variable', () => {
  assert.throws(() => loadCredentials({}), (error: unknown) => {
    assert.ok(error instanceof MissingCredentialsError)
    for (const name of REQUIRED_CREDENTIALS) assert.match(error.message, new RegExp(name))
    assert.deepEqual(error.missing, [...REQUIRED_CREDENTIALS])
    return true
  })
})

test('one missing variable is refused, naming only that one', () => {
  const { NOTION_TOKEN, ...rest } = complete
  assert.throws(() => loadCredentials(rest), (error: unknown) => {
    assert.ok(error instanceof MissingCredentialsError)
    assert.deepEqual(error.missing, ['NOTION_TOKEN'])
    return true
  })
})

test('a blank or whitespace-only variable counts as missing', () => {
  assert.throws(() => loadCredentials({ ...complete, NOTION_TOKEN: '   ' }), MissingCredentialsError)
  assert.throws(() => loadCredentials({ ...complete, FIREWORKS_API_KEY: '' }), MissingCredentialsError)
})

test('credential values never appear in the refusal message', () => {
  // The message is printed and may be pasted into an issue; it must carry names only.
  try {
    loadCredentials({ ...complete, NOTION_TOKEN: '' })
    assert.fail('expected a refusal')
  } catch (error) {
    assert.ok(error instanceof MissingCredentialsError)
    assert.doesNotMatch(error.message, /fw-key|ntn-token|db-id/)
  }
})

test('surrounding whitespace is trimmed from a credential', () => {
  assert.equal(loadCredentials({ ...complete, NOTION_TOKEN: ' ntn-token\n' }).notionToken, 'ntn-token')
})
