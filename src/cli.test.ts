import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Which `swarmdrop` gets run, and in what order the sources are tried.
 *
 * Imported fresh in every test: the `PATH` lookup caches a hit for the life of
 * the module, so a shared import would leak one test's answer into the next.
 */
async function resolveFresh() {
  vi.resetModules()
  const { resolvedBinary } = await import('./cli.js')
  return resolvedBinary()
}

/** A directory holding an executable named `swarmdrop`. */
function dirWithBinary(): string {
  const dir = mkdtempSync(join(tmpdir(), 'swarmdrop-path-'))
  const file = join(dir, process.platform === 'win32' ? 'swarmdrop.exe' : 'swarmdrop')
  writeFileSync(file, '')
  chmodSync(file, 0o755)
  return dir
}

describe('binary resolution', () => {
  const saved = { bin: process.env['SWARMDROP_BIN'], path: process.env['PATH'] }

  beforeEach(() => {
    delete process.env['SWARMDROP_BIN']
  })

  afterEach(() => {
    if (saved.bin === undefined) delete process.env['SWARMDROP_BIN']
    else process.env['SWARMDROP_BIN'] = saved.bin
    process.env['PATH'] = saved.path
  })

  it('lets SWARMDROP_BIN win over everything', async () => {
    process.env['SWARMDROP_BIN'] = '/somewhere/else/swarmdrop'
    process.env['PATH'] = dirWithBinary()
    expect(await resolveFresh()).toEqual({
      path: '/somewhere/else/swarmdrop',
      source: 'override',
    })
  })

  /**
   * **The point of the whole ordering.** The bundled copy is installed in this
   * repo's `node_modules` (it is an `optionalDependency`), so if it outranked
   * `PATH` this test would find it instead.
   *
   * Ranking the user's own install first is what keeps this plugin and the
   * user's terminal on one binary — and therefore one node. Flip it back and
   * the plugin starts a daemon their `swarmdrop` can no longer talk to, over a
   * local channel that has no version negotiation.
   */
  it('prefers the user’s own install over the bundled copy', async () => {
    // Assert the premise. Without a bundled copy actually installed there is
    // nothing for `PATH` to outrank, and this test would keep passing while
    // proving nothing — the exact way a guardrail rots into decoration.
    process.env['PATH'] = mkdtempSync(join(tmpdir(), 'empty-'))
    expect(
      (await resolveFresh()).source,
      'no bundled swarmdrop in node_modules; this test cannot prove an ordering',
    ).toBe('bundled')

    const dir = dirWithBinary()
    process.env['PATH'] = dir
    const resolved = await resolveFresh()
    expect(resolved.source).toBe('path')
    expect(resolved.path.startsWith(dir)).toBe(true)
  })

  it('ignores an empty SWARMDROP_BIN rather than spawning it', async () => {
    process.env['SWARMDROP_BIN'] = ''
    process.env['PATH'] = dirWithBinary()
    expect((await resolveFresh()).source).toBe('path')
  })

  it('searches every PATH entry, not just the first', async () => {
    const dir = dirWithBinary()
    process.env['PATH'] = [mkdtempSync(join(tmpdir(), 'empty-')), dir].join(delimiter)
    expect((await resolveFresh()).source).toBe('path')
  })
})
