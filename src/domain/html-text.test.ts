import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readFileSync } from 'node:fs'

import { MAX_SOURCE_TEXT_CHARS } from '../../config.ts'
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

test('the real Loudwire calendar reduces to its release rows', () => {
  const text = htmlToText(
    readFileSync(new URL('../../fixtures/loudwire.html', import.meta.url), 'utf8'),
  )

  // A row survives as one line of artist, title and label.
  assert.ok(text.includes('Anthrax - Cursum Perficio (Megaforce)'))
  assert.ok(text.includes('September 18, 2026'))
  // And the page's machinery does not.
  assert.ok(!text.includes('<'))
  assert.ok(!text.includes('function('))
  assert.ok(!text.includes('livedesign-design-option'))
})

test('a whole real page fits under the cap, so nothing a run wants is cut', () => {
  const text = htmlToText(
    readFileSync(new URL('../../fixtures/loudwire.html', import.meta.url), 'utf8'),
  )

  // Loudwire lists the coming months first and the weeks just gone last, so a
  // cap that cut this page would cut exactly the releases a backward-looking
  // run is asking about. The cap is sized from this number.
  assert.ok(text.includes('September 4, 2026'), 'the past weeks are at the end of the page')
  assert.ok(
    text.length < MAX_SOURCE_TEXT_CHARS,
    `a real page cleans to ${text.length} characters, against a cap of ${MAX_SOURCE_TEXT_CHARS}`,
  )
})
