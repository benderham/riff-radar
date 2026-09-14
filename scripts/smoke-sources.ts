/**
 * A live smoke test against the three configured sources. Invoked by hand
 * (`npm run smoke:sources`), never by the automated suite: the suite must not
 * depend on three websites staying up or staying the same shape.
 *
 * It is what checks the recorded fixtures against reality. Extraction is not
 * byte-reproducible and a site redesign degrades it quietly (ADR-0003), so this
 * is the thing that fires first when a page changes: a source that normally
 * yields candidates and suddenly yields none says so here.
 */

import process from 'node:process'

import { SOURCES } from '../config.ts'
import type { SourceId } from '../config.ts'
import { fireworksModel } from '../src/adapters/fireworks.ts'
import { httpAdapter } from '../src/adapters/http.ts'
import { fetchSource } from '../src/clients/sources.ts'
import { estimateCost } from '../src/domain/cost.ts'
import { resolveWindow } from '../src/domain/window.ts'
import type { Ports } from '../src/ports.ts'

const apiKey = process.env['FIREWORKS_API_KEY']
if (!apiKey) {
  console.error('FIREWORKS_API_KEY is not set')
  process.exit(2)
}

const ports: Ports = {
  clock: { now: () => new Date() },
  http: httpAdapter(),
  model: fireworksModel(apiKey),
}

// The same window a default run resolves, so the smoke test asks the sources
// the question a run asks them.
const window = resolveWindow(new Date(), 7)
console.log(`window ${window.from} to ${window.to}`)

let spent = 0

for (const sourceId of Object.keys(SOURCES) as SourceId[]) {
  const started = Date.now()
  const result = await fetchSource(ports, sourceId, window)
  spent += estimateCost(result.usage)

  console.log(`\n── ${sourceId} ───────────────────────────────`)
  // Fetching and extracting, together: the two are one action from the loop's
  // point of view, and timing only the request would flatter the step.
  console.log(`${result.url} → HTTP ${result.status}, fetched and extracted in ${Date.now() - started}ms`)
  console.log(
    `${result.rawBody.length} bytes raw, ${result.cleanedText.length} cleaned${
      result.truncated ? ' (truncated)' : ''
    }`,
  )
  console.log(
    `${result.candidates.length} candidates in window, ${result.outsideWindow} outside it, ${result.droppedRows} rows dropped`,
  )
  if (result.warning !== undefined) console.log(`WARNING: ${result.warning}`)

  for (const candidate of result.candidates.slice(0, 8)) {
    console.log(
      `  ${candidate.releaseDates.join('/')}  ${candidate.artist} — ${candidate.title}${
        candidate.label === undefined ? '' : ` (${candidate.label})`
      }`,
    )
  }
  if (result.candidates.length > 8) console.log(`  … and ${result.candidates.length - 8} more`)
}

console.log(`\nextraction cost: $${spent.toFixed(4)}`)
