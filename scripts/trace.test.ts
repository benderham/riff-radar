import { test } from 'node:test'
import assert from 'node:assert/strict'

import { cell, chainSummary, noteOf } from './trace.ts'

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

test('a step says what kind of thing broke before it says what happened', () => {
  assert.equal(
    noteOf({ error: null, warning: 'loudwire.com returned HTTP 503', failure_category: 'transient' }),
    '[transient] loudwire.com returned HTTP 503',
  )
})

test('a step where nothing broke says nothing', () => {
  assert.equal(noteOf({ error: null, warning: null, failure_category: null }), '')
})

test('an error is preferred to a warning, as it always was', () => {
  assert.equal(
    noteOf({ error: 'Notion refused a page with HTTP 403', warning: 'ignored', failure_category: 'refused' }),
    '[refused] Notion refused a page with HTTP 403',
  )
})

test('a retried step says how many attempts it took, so the seconds are explained', () => {
  assert.equal(
    noteOf({
      error: null,
      warning: 'loudwire.com returned HTTP 503 after 3 attempts; no candidates from this source',
      failure_category: 'transient',
    }),
    '[transient] loudwire.com returned HTTP 503 after 3 attempts; no candidates from this source',
  )
})

test('a chain reads as one story: every run, and the youngest run for the total', () => {
  // A resumed run inherits its parent's spend (ADR-0050), so its own row
  // already holds the chain's accounting. Summing the rows would count the
  // parent twice; the youngest row is the total.
  assert.deepEqual(
    chainSummary([
      { estimated_cost: 0.04, steps: 12 },
      { estimated_cost: 0.07, steps: 5 },
    ]),
    { runs: 2, steps: 17, cost: 0.07 },
  )
})

test('one run is a chain of one, and says the same thing', () => {
  assert.deepEqual(chainSummary([{ estimated_cost: 0.04, steps: 12 }]), {
    runs: 1,
    steps: 12,
    cost: 0.04,
  })
})
