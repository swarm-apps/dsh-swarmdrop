/**
 * Print one version's section of CHANGELOG.md on stdout, or fail loudly.
 *
 * The changelog here is written by hand, and that is deliberate: the entries
 * that earn their place explain *why* something broke, which no tool can
 * derive from commit subjects. So rather than generate release notes from
 * commits, the release workflow reads them back out of the file the change was
 * already described in — one source of truth, written once.
 *
 * Exiting non-zero when a version has no section is the point as much as the
 * printing is. It runs before `npm publish`, so a release that nobody wrote
 * down stops at the gate instead of arriving on npm undocumented.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const version = process.argv[2]
if (!version) {
  console.error('usage: node scripts/changelog-section.mjs <version>')
  process.exit(2)
}

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const path = join(root, 'CHANGELOG.md')
const lines = (await readFile(path, 'utf8')).split('\n')

// `## [0.3.0] - 2026-08-21`, and tolerant of the brackets and date being absent.
const heading = /^##\s+\[?([^\]\s]+)\]?(?:\s|$)/u
// The link-reference block at the foot belongs to no version's section.
const reference = /^\[[^\]]+\]:\s/u

const start = lines.findIndex((line) => heading.exec(line)?.[1] === version)
if (start === -1) {
  console.error(
    `CHANGELOG.md has no section for ${version}.\n` +
      'Add one before tagging — the release notes are read from it.',
  )
  process.exit(1)
}

let end = start + 1
while (end < lines.length && !heading.test(lines[end]) && !reference.test(lines[end])) end++

// The heading itself is dropped: the release is already titled with its version.
const body = lines.slice(start + 1, end).join('\n').trim()
if (!body) {
  console.error(`CHANGELOG.md's section for ${version} is empty.`)
  process.exit(1)
}

console.log(body)
