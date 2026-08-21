/**
 * Generate `tsconfig.dev.json` — the config that can actually typecheck the
 * browser half.
 *
 * ## Why this exists
 *
 * The Node half compiles against the published `@deepseek-ai/*` packages. The
 * browser half cannot: `@deepseek-ai/dsh-client-runtime` depends on
 * `@deepseek-ai/dsh-compact`, which is **not on npm**, so its dependency chain
 * is unresolvable from the registry.
 *
 * The workable substitute is a dsh checkout — but its packages ship their types
 * from `lib/`, which only exists after a full monorepo build. dsh solves this
 * for itself with a 153-entry `paths` map pointing every specifier at `src/`.
 * This script rebases that same map onto an absolute checkout path, so we
 * inherit dsh's own resolution rather than inventing a second one that will
 * drift from it.
 *
 * ## Why generated instead of committed
 *
 * The map is anchored to wherever the checkout happens to live. Committing it
 * would put one machine's absolute paths into everyone else's repo.
 *
 * Usage: `DSH_REPO=/path/to/deepseek-harness node scripts/dev-tsconfig.mjs`
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

const repo = process.env['DSH_REPO'] ?? resolve('..', 'deepseek-harness')
const base = resolve(repo, 'tsconfig.base.json')

let source
try {
  source = readFileSync(base, 'utf8')
} catch {
  console.error(
    `No dsh checkout at ${repo}.\n`
    + 'Set DSH_REPO to one, or skip the browser half: `npx tsc --noEmit -p tsconfig.json`\n'
    + 'only covers the Node half, which compiles against published packages.',
  )
  process.exit(1)
}

// The file is JSONC (dsh comments it heavily). Strip line comments only —
// there are no block comments and no strings containing `//` in the paths map.
const stripped = source.replace(/^\s*\/\/.*$/gmu, '')
const paths = JSON.parse(stripped).compilerOptions.paths

const rebased = Object.fromEntries(
  Object.entries(paths).map(([specifier, targets]) => [
    specifier,
    targets.map(target => isAbsolute(target) ? target : resolve(repo, target)),
  ]),
)

writeFileSync('tsconfig.dev.json', `${JSON.stringify({
  extends: './tsconfig.client.json',
  compilerOptions: {
    // dsh's own sources use `.ts` import specifiers.
    allowImportingTsExtensions: true,
    // Their sources are not ours to lint.
    noUnusedLocals: false,
    noUnusedParameters: false,
    baseUrl: '.',
    paths: rebased,
  },
}, null, 2)}\n`)

console.log(`tsconfig.dev.json written (${String(Object.keys(rebased).length)} path entries from ${repo}).`)
