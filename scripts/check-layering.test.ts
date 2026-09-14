import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { findLayeringViolations } from './check-layering.ts'

const tree = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), 'riff-radar-layering-'))
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, contents)
  }
  return root
}

test('the real source tree has no layering violations', () => {
  assert.deepEqual(findLayeringViolations('src'), [])
})

test('a domain file importing a client is a violation naming the file', () => {
  const root = tree({
    'domain/eligibility.ts': "import { lookup } from '../clients/musicbrainz.ts'\n",
    'clients/musicbrainz.ts': 'export const lookup = () => {}\n',
  })
  const violations = findLayeringViolations(root)

  assert.equal(violations.length, 1)
  assert.match(violations[0]!.file, /domain\/eligibility\.ts$/)
  assert.match(violations[0]!.importPath, /clients\/musicbrainz/)
})

test('a domain file importing an adapter is a violation', () => {
  const root = tree({ 'domain/window.ts': "import { systemClock } from '../adapters/clock.ts'\n" })
  assert.equal(findLayeringViolations(root).length, 1)
})

test('a deeply nested domain file is checked too', () => {
  const root = tree({ 'domain/ranking/score.ts': "import x from '../../adapters/http.ts'\n" })
  assert.equal(findLayeringViolations(root).length, 1)
})

test('type-only imports are violations as well', () => {
  const root = tree({ 'domain/rules.ts': "import type { Page } from '../clients/sources.ts'\n" })
  assert.equal(findLayeringViolations(root).length, 1)
})

test('a dynamic import is a violation', () => {
  const root = tree({
    'domain/rules.ts': "export const f = async () => (await import('../adapters/model.ts')).call()\n",
  })
  assert.equal(findLayeringViolations(root).length, 1)
})

test('a side-effect import with no bindings is a violation', () => {
  const root = tree({ 'domain/rules.ts': "import '../adapters/model.ts'\n" })
  assert.equal(findLayeringViolations(root).length, 1)
})

test('reaching a forbidden layer by a longer path is a violation', () => {
  // '../../src/clients/x.ts' resolves back into clients/ and must not slip past.
  const root = tree({ 'src/domain/rules.ts': "import x from '../../src/clients/musicbrainz.ts'\n" })
  assert.equal(findLayeringViolations(join(root, 'src')).length, 1)
})

test('domain importing domain is allowed', () => {
  const root = tree({
    'domain/rules.ts': "import { resolveWindow } from './window.ts'\n",
    'domain/window.ts': 'export const resolveWindow = () => {}\n',
  })
  assert.deepEqual(findLayeringViolations(root), [])
})

test('code outside domain may import clients and adapters freely', () => {
  const root = tree({
    'agents/riff-radar.ts': "import { fetchSource } from '../clients/sources.ts'\n",
    'cli.ts': "import { systemClock } from './adapters/clock.ts'\n",
  })
  assert.deepEqual(findLayeringViolations(root), [])
})

test('the word clients inside a string or comment is not an import', () => {
  const root = tree({
    'domain/rules.ts': "// clients/musicbrainz is deliberately not imported here\nexport const note = 'see adapters/model.ts'\n",
  })
  assert.deepEqual(findLayeringViolations(root), [])
})
