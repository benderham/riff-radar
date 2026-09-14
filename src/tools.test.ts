import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

import { dispatch, toolDefinitions, tools, validateAction } from './tools.ts'

const call = (name: string, argumentsJson: string) => ({ id: 'call-1', name, argumentsJson })

test('every declared action is offered to the model, schema and all', () => {
  assert.deepEqual(
    toolDefinitions.map((definition) => definition.name).sort(),
    ['fetch_source', 'finish', 'lookup_release', 'web_search'],
  )

  for (const definition of toolDefinitions) {
    assert.ok(definition.description.length > 0, `${definition.name} has no description`)
    // Derived from the declaration, not maintained separately.
    assert.deepEqual(
      definition.parameters,
      z.toJSONSchema(tools[definition.name as keyof typeof tools].schema),
      `${definition.name}'s JSON schema is not its declared schema`,
    )
  }
})


test('an unknown action is rejected', () => {
  const result = validateAction(call('write_to_notion', '{}'))
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.error, /unknown action/)
})

test('malformed JSON arguments are an ordinary failure', () => {
  const result = validateAction(call('web_search', '{"query": '))
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.error, /not valid JSON/)
})

test('well-formed JSON of the wrong shape is an ordinary failure', () => {
  const result = validateAction(call('web_search', '{"q": "ulcerate"}'))
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.error, /query/)
})

test('an unconfigured source is rejected before anything is fetched', () => {
  const result = validateAction(call('fetch_source', '{"source_id": "metal-archives"}'))
  assert.equal(result.ok, false)
})

test('a valid call passes validation and dispatches', () => {
  const result = validateAction(call('fetch_source', '{"source_id": "aoty"}'))
  assert.equal(result.ok, true)

  assert.ok(result.ok)
  const dispatched = dispatch(result.name, result.input)
  assert.equal(dispatched.done, false)
  assert.ok(!dispatched.done && dispatched.result.includes('Blood Incantation'))
})

test('finish hands its items back to the loop rather than judging them', () => {
  const result = validateAction(call('finish', '{"shortlist": [{"artist": "Ulcerate"}]}'))
  assert.ok(result.ok)

  const dispatched = dispatch(result.name, result.input)
  assert.ok(dispatched.done)
  assert.deepEqual(dispatched.shortlist, [{ artist: 'Ulcerate' }])
})
