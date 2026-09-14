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

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'

const FORBIDDEN = ['clients', 'adapters'] as const

export interface LayeringViolation {
  readonly file: string
  readonly importPath: string
}

// Three forms reach another module: `... from '…'`, a bare side-effect
// `import '…'`, and a dynamic `import('…')`. All three count.
const IMPORT_SPECIFIER =
  /(?:^|\s)(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|\s)import\s*['"]([^'"]+)['"]|(?:^|[^.\w])import\s*\(\s*['"]([^'"]+)['"]\s*\)/gm

const typescriptFilesIn = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return typescriptFilesIn(path)
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : []
  })

export const findLayeringViolations = (root: string): LayeringViolation[] => {
  const violations: LayeringViolation[] = []

  for (const file of typescriptFilesIn(root)) {
    const segments = relative(root, file).split(sep)
    if (segments[0] !== 'domain') continue

    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(IMPORT_SPECIFIER)) {
      const importPath = match[1] ?? match[2] ?? match[3]
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
