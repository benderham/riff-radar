import { test } from 'node:test'
import assert from 'node:assert/strict'

import { htmlToText } from './html-text.ts'

test('tags are removed and their text kept in order', () => {
  assert.equal(
    htmlToText('<div><span>Ulcerate</span> — <em>Cutting the Throat of God</em></div>'),
    'Ulcerate — Cutting the Throat of God',
  )
})

test('script and style bodies are dropped, not merely untagged', () => {
  const html = `
    <style>.album { color: #000 }</style>
    <p>Gatecreeper — Dark Superstition</p>
    <script>window.__DATA__ = { tracking: true }</script>
  `
  assert.equal(htmlToText(html), 'Gatecreeper — Dark Superstition')
})

test('comments are dropped', () => {
  assert.equal(htmlToText('<p>Sumac<!-- editor: check date --></p>'), 'Sumac')
})

test('block elements become line breaks so rows stay separate', () => {
  const html = '<li>Chat Pile — Cool World</li><li>Blood Incantation — Absolute Elsewhere</li>'
  assert.equal(htmlToText(html), 'Chat Pile — Cool World\nBlood Incantation — Absolute Elsewhere')
})

test('a table row keeps its cells on one line, separated', () => {
  const html = '<tr><td>2026-09-12</td><td>Gatecreeper</td><td>Dark Superstition</td></tr>'
  assert.equal(htmlToText(html), '2026-09-12 Gatecreeper Dark Superstition')
})

test('entities are decoded, including numeric and nbsp', () => {
  assert.equal(
    htmlToText('<p>Sunn O&#41;&#41;&#41; &amp; Boris &nbsp;&mdash; Altar &lt;live&gt;</p>'),
    'Sunn O))) & Boris — Altar <live>',
  )
})

test('whitespace is collapsed and blank lines are not repeated', () => {
  const html = '<p>  one   </p>\n\n\n<div>\n\n</div>\n<p>two</p>'
  assert.equal(htmlToText(html), 'one\ntwo')
})

test('an unclosed tag does not swallow the rest of the page', () => {
  assert.equal(htmlToText('<p>kept<div'), 'kept')
})
