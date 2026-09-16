import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { HttpPort, Ports } from '../ports.ts'
import { coverArtUrl } from './coverart.ts'

const serving = (answer: Partial<{ status: number; body: string }> | Error) => {
  const urls: string[] = []
  const http: HttpPort = {
    patch: async () => { throw new Error('unexpected patch') },
    get: async (url) => {
      urls.push(url)
      if (answer instanceof Error) throw answer
      return { status: 200, body: '{}', headers: {}, ...answer }
    },
    post: async () => {
      throw new Error('cover art never posts')
    },
  }
  return { urls, ports: { http, clock: { now: () => new Date() } } as Ports }
}

const index = (images: unknown[]) => JSON.stringify({ images })

test('the front cover is preferred over whatever else the archive holds', async () => {
  const { ports } = serving({
    body: index([{ image: 'https://img/back.jpg' }, { image: 'https://img/front.jpg', front: true }]),
  })

  assert.equal(await coverArtUrl(ports, 'rg-1'), 'https://img/front.jpg')
})

test('an http address is upgraded, so Notion does not render a broken image', async () => {
  const { ports } = serving({ body: index([{ image: 'http://img/front.jpg', front: true }]) })
  assert.equal(await coverArtUrl(ports, 'rg-1'), 'https://img/front.jpg')
})

test('no art, a refusal, an unreadable answer and a dead connection all mean no cover', async () => {
  for (const answer of [
    { status: 404, body: 'not found' },
    { status: 503, body: '' },
    { body: 'not json at all' },
    { body: index([]) },
    new Error('connection reset'),
  ]) {
    const { ports } = serving(answer)
    assert.equal(await coverArtUrl(ports, 'rg-1'), undefined)
  }
})
