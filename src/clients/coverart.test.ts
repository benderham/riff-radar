import { test } from 'node:test'
import assert from 'node:assert/strict'

import { NO_ANSWER } from '../domain/http-outcome.ts'
import type { HttpPort, Ports } from '../ports.ts'
import { coverArtUrl } from './coverart.ts'

const serving = (answer: Partial<{ status: number; body: string }>) => {
  const calls: { url: string; followed: boolean | undefined }[] = []
  const http: HttpPort = {
    get: async (url, _headers, options) => {
      calls.push({ url, followed: options?.followRedirects })
      return { status: 200, body: '', headers: {}, attempts: 1, ...answer }
    },
    post: async () => {
      throw new Error('cover art never posts')
    },
    patch: async () => {
      throw new Error('cover art never patches')
    },
  }
  return { calls, ports: { http, clock: { now: () => new Date() } } as Ports }
}

test('a redirect means there is art, and the archive its stable address', async () => {
  const { ports, calls } = serving({ status: 307 })

  assert.equal(
    await coverArtUrl(ports, 'rg-1'),
    'https://coverartarchive.org/release-group/rg-1/front',
  )
  // Not followed: the status line is the answer, and following it would
  // download an image through this process to learn what it already knew.
  assert.deepEqual(calls, [
    { url: 'https://coverartarchive.org/release-group/rg-1/front', followed: false },
  ])
})

test('no art, a refusal, an answered request and a dead connection all mean no cover', async () => {
  for (const answer of [
    { status: 404 },
    { status: 503 },
    { status: NO_ANSWER, body: 'fetch failed' },
    // A 200 would mean the archive served an image body rather than pointing
    // at one, which is not a contract this relies on.
    { status: 200, body: 'an image, served rather than pointed at' },
  ]) {
    const { ports } = serving(answer)
    assert.equal(await coverArtUrl(ports, 'rg-1'), undefined)
  }
})
