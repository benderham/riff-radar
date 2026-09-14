/**
 * A live smoke test against the model provider. Invoked by hand
 * (`npm run smoke:model`), never by the automated suite: the suite must not
 * depend on a network, a key or a bill.
 *
 * It exists to settle one question the trace depends on — whether the provider
 * reports a cached-token breakdown (ADR-0020) — and to prove the adapter's
 * request shape against the real endpoint rather than against our own fake.
 * It sends the same stable prefix and the same derived tool definitions a run
 * would, twice, because a cache hit needs something to hit.
 */

import process from 'node:process'

import { fireworksModel } from '../src/adapters/fireworks.ts'
import { tasteProfileSchema } from '../src/domain/taste-profile.ts'
import { runBrief, stablePrefix } from '../src/prompt/prompt.ts'
import { toolDefinitions } from '../src/tools.ts'
import { TASTE_PROFILE_PATH } from '../config.ts'
import { readFileSync } from 'node:fs'

const apiKey = process.env['FIREWORKS_API_KEY']
if (!apiKey) {
  console.error('FIREWORKS_API_KEY is not set')
  process.exit(2)
}

const profile = tasteProfileSchema.parse(JSON.parse(readFileSync(TASTE_PROFILE_PATH, 'utf8')))
const model = fireworksModel(apiKey)
const messages = [stablePrefix(profile), runBrief({ from: '2026-09-08', to: '2026-09-14' })]

for (const attempt of [1, 2]) {
  const response = await model.complete({ messages, tools: toolDefinitions })

  console.log(`\n── request ${attempt} ─────────────────────────────`)
  console.log('tool calls:', JSON.stringify(response.toolCalls, null, 2))
  console.log('content:', response.content.slice(0, 400))
  console.log('usage:', response.usage)
  console.log(
    response.cacheReported
      ? 'cached tokens ARE reported: cost accounting is a measurement'
      : 'cached tokens are NOT reported: cost accounting is an upper bound',
  )
}
