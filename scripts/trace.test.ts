import { test } from 'node:test'
import assert from 'node:assert/strict'

import { cell } from './trace.ts'

test('a cell lines up, whatever it is given', () => {
  assert.equal(cell('finish', 10), 'finish    ')
  assert.equal(cell(42, 4), '42  ')
  assert.equal(cell(null, 3), '   ')
  assert.equal(cell(undefined, 3), '   ')
})

test('a long value is cut, and a multi-line one stays on its line', () => {
  assert.equal(cell('invalid_action', 8), 'invali… ')
  assert.equal(cell('two\nlines  here', 16), 'two lines here  ')
})

test('a value that exactly fills its column still leaves a gap after it', () => {
  // Otherwise a 46-character JSON argument runs straight into the duration.
  assert.equal(cell('12345678', 8), '123456… ')
  for (const width of [4, 8, 20]) assert.ok(cell('x'.repeat(40), width).endsWith(' '))
})
