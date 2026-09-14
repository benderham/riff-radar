/**
 * The one layering rule, mechanically checked: `domain/` imports nothing from
 * `clients/` or `adapters/`.
 *
 * This is what makes the layout load-bearing rather than decorative (ADR-0021).
 * The domain is the pure half — eligibility, deduplication, ranking arithmetic,
 * shortlist validation — and it stays testable without a seam only for as long
 * as nothing in it can reach the outside world.
 *
 * The check is textual on import specifiers rather than a full parse, since the
 * rule is about paths and taking a parser dependency to read them would cost
 * more than it is worth.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'

const FORBIDDEN = ['clients', 'adapters'] as const

export interface LayeringViolation {
  readonly file: string
  readonly importPath: string
}

// Catches all three forms that reach another module: `… from '…'`, a bare
// side-effect `import '…'`, and a dynamic `import('…')`. Only relative
// specifiers are judged, which is what keeps ordinary strings out of it.
const IMPORT_SPECIFIER = /\b(?:import|export)\b[^'"\n]*['"]([^'"]+)['"]/g

const typescriptFilesIn = (root: string): string[] =>
  readdirSync(root, { recursive: true })
    .map(String)
    .filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts'))
    .map((path) => join(root, path))

export const findLayeringViolations = (root: string): LayeringViolation[] => {
  const violations: LayeringViolation[] = []

  for (const file of typescriptFilesIn(root)) {
    const segments = relative(root, file).split(sep)
    if (segments[0] !== 'domain') continue

    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(IMPORT_SPECIFIER)) {
      const importPath = match[1]
      if (importPath === undefined || !importPath.startsWith('.')) continue

      // Resolve against the importing file rather than reading the specifier
      // literally, so a path that climbs out and back in — '../../src/clients/x'
      // — is judged by where it lands, not by how it is spelled.
      const landsIn = relative(resolve(root), resolve(dirname(file), importPath)).split(sep)
      if (FORBIDDEN.some((layer) => landsIn[0] === layer)) {
        violations.push({ file, importPath })
      }
    }
  }

  return violations
}

const invokedDirectly = process.argv[1]?.endsWith('check-layering.ts') === true

if (invokedDirectly) {
  const violations = findLayeringViolations('src')
  for (const { file, importPath } of violations) {
    console.error(`${file}: domain must not import "${importPath}"`)
  }
  if (violations.length > 0) {
    console.error(`\n${violations.length} layering violation(s): domain/ imports nothing from clients/ or adapters/`)
    process.exitCode = 1
  } else {
    console.log('layering ok: domain/ imports nothing from clients/ or adapters/')
  }
}
