import { test } from 'node:test'
import assert from 'node:assert/strict'

import { NOTION_PROPERTIES } from '../../config.ts'
import { appleMusicSearchUrl, notionPage } from './notion-page.ts'

const item = {
  artist: 'Ulcerate',
  title: 'Cutting the Throat of God',
  releaseDate: '2026-09-11',
  sourceUrls: ['https://loudwire.com/calendar'],
  rank: 1,
  rationale: 'Dissonant death metal, and he has every other Ulcerate record.',
  musicbrainzId: 'rg-1',
}

const built = (over = {}, options = {}) =>
  notionPage({ ...item, ...over }, { databaseId: 'db-1', runId: 'run-1', ...options }) as {
    parent: { database_id: string }
    cover?: { external: { url: string } }
    properties: Record<string, Record<string, unknown>>
  }

test('every record carries Proposed, the run, a source URL and its rationale', () => {
  const page = built()

  assert.equal(page.parent.database_id, 'db-1')
  assert.deepEqual(page.properties['Status'], { select: { name: 'Proposed' } })
  assert.equal((page.properties['Run ID']!['rich_text'] as { text: { content: string } }[])[0]?.text.content, 'run-1')
  assert.deepEqual(page.properties['Source URL'], { url: 'https://loudwire.com/calendar' })
  assert.match(
    (page.properties['Rationale']!['rich_text'] as { text: { content: string } }[])[0]!.text.content,
    /Dissonant death metal/,
  )
  assert.deepEqual(page.properties['Release Date'], { date: { start: '2026-09-11' } })
})

test('Rating is not written, by any path', () => {
  // Not merely absent from this page: absent from the table that names every
  // property the agent knows about, which is the only list either side reads.
  assert.ok(!Object.keys(NOTION_PROPERTIES).includes('Rating'))
  for (const page of [built(), built({ musicbrainzId: undefined, unverified: true }), built({}, { coverUrl: 'https://cover' })]) {
    assert.ok(!Object.keys(page.properties).includes('Rating'))
    assert.deepEqual(Object.keys(page.properties).filter((name) => !(name in NOTION_PROPERTIES)), [])
  }
})

test('the Apple Music link is a search for the artist and the album', () => {
  assert.equal(
    appleMusicSearchUrl('Ulcerate', 'Cutting the Throat of God'),
    'https://music.apple.com/search?term=Ulcerate%20Cutting%20the%20Throat%20of%20God',
  )
})

test('an unverified release writes an empty MusicBrainz cell rather than an invented id', () => {
  const page = built({ musicbrainzId: undefined, unverified: true })
  assert.deepEqual(page.properties['MusicBrainz ID'], { rich_text: [] })
})

test('cover art becomes the page cover, and its absence leaves the page without one', () => {
  assert.deepEqual(built({}, { coverUrl: 'https://img/front.jpg' }).cover, {
    external: { url: 'https://img/front.jpg' },
  })
  assert.equal(built().cover, undefined)
})

test('a rationale longer than Notion accepts is cut rather than rejected by Notion', () => {
  const page = built({ rationale: 'x'.repeat(3_000) })
  const content = (page.properties['Rationale']!['rich_text'] as { text: { content: string } }[])[0]!
  assert.equal(content.text.content.length, 2_000)
})

test('a degraded run\'s caveat survives a rationale that fills the property', () => {
  const page = built({ rationale: 'x'.repeat(3_000), judgedWithoutMusicbrainz: true })
  const content = (page.properties['Rationale']!['rich_text'] as { text: { content: string } }[])[0]!

  assert.equal(content.text.content.length, 2_000)
  assert.match(content.text.content, /without MusicBrainz/i)
})
