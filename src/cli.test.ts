import { EventEmitter } from 'node:events'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { inviteQr, isUnknownToCli, SwarmDropError } from './cli.js'

/**
 * What the last spawn was given, and what it should answer.
 *
 * `vi.hoisted` because the mock factory below is hoisted above every other
 * statement in this file — a plain `const` would not exist yet when it runs.
 */
const spawned = vi.hoisted(() => ({
  args: [] as string[],
  stdout: '',
  stderr: '',
  code: 0 as number | null,
}))

/**
 * A `swarmdrop` that answers from `spawned` instead of existing.
 *
 * The tests below are about the **command line** — argument order, and the
 * `--json` that keeps progress off stdout. A real binary would test the CLI's
 * behaviour rather than this file's, and the binary-resolution tests above
 * never spawn, so nothing else here notices the mock.
 */
vi.mock('node:child_process', () => ({
  spawn: (_binary: string, args: readonly string[]) => {
    spawned.args = [...args]
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter & { setEncoding(encoding: string): void }
      stderr: EventEmitter & { setEncoding(encoding: string): void }
      kill(signal?: string): void
    }
    const pipe = () => Object.assign(new EventEmitter(), { setEncoding: () => {} })
    child.stdout = pipe()
    child.stderr = pipe()
    child.kill = () => {}
    queueMicrotask(() => {
      if (spawned.stdout !== '') child.stdout.emit('data', spawned.stdout)
      if (spawned.stderr !== '') child.stderr.emit('data', spawned.stderr)
      child.emit('close', spawned.code)
    })
    return child
  },
}))

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

describe('explainWatchExit', () => {
  /**
   * The likeliest subscription failure now that `PATH` outranks the bundled
   * copy: an old install is the one that gets used, and clap answers `watch`
   * with a usage error about arguments the panel never typed.
   */
  it('names the version when the binary predates `watch`', async () => {
    const { explainWatchExit } = await import('./cli.js')
    expect(explainWatchExit("error: unrecognized subcommand 'watch'", 2))
      .toContain('0.4.0')
  })

  it('falls back to the exit code for anything else', async () => {
    const { explainWatchExit } = await import('./cli.js')
    expect(explainWatchExit('some other trouble', 3)).toContain('3')
  })

  /** A real usage error on a modern binary must not be blamed on the version. */
  it('does not claim an old binary for an unrelated exit 2', async () => {
    const { explainWatchExit } = await import('./cli.js')
    expect(explainWatchExit('error: the node refused', 2)).not.toContain('0.4.0')
  })
})


/**
 * The QR call's command line.
 *
 * Pinned because every part of it is load-bearing and none of it is visible
 * from the browser: the invite is a positional argument (a flag position would
 * silently render nothing), `--size` is the encoder's address budget rather
 * than a display hint, and `--json` is what keeps the SVG out of the progress
 * stream.
 */
describe('inviteQr', () => {
  const INVITE = 'https://swarmapp.cn/p/#AAAA'

  beforeEach(() => {
    spawned.args = []
    spawned.stdout = ''
    spawned.stderr = ''
    spawned.code = 0
  })

  it('passes the invite positionally, with the face size and --json', async () => {
    spawned.stdout = JSON.stringify({ svg: '<svg />' })
    expect(await inviteQr(INVITE, 240)).toBe('<svg />')
    expect(spawned.args).toEqual(['invite', 'qr', INVITE, '--size', '240', '--json'])
  })

  /**
   * An answer without the field is a CLI speaking a shape this does not know —
   * not a code that happens to be empty. Handing the browser a blank `<svg>`
   * would draw an empty white card and call it a success.
   */
  it('refuses an answer that carries no code', async () => {
    spawned.stdout = JSON.stringify({ id: 'abc' })
    await expect(inviteQr(INVITE, 240)).rejects.toThrow(/no code/)
  })

  /** A refusal keeps the CLI's own sentence — the dialog shows it verbatim. */
  it('relays what the CLI said when it failed', async () => {
    spawned.stdout = ''
    spawned.code = 2
    await expect(inviteQr(INVITE, 240)).rejects.toThrow(/swarmdrop invite qr/)
  })

  /**
   * A `swarmdrop` that predates `invite qr` must be recognisable as *old*,
   * rather than as a code that would not render.
   *
   * This pins a chain with three links and no type to hold it together: clap's
   * wording, `isUnknownToCli`'s pattern, and the `tooOld` flag `panel.ts` sets
   * from it. Break any one and the dialog silently regresses from "upgrade
   * swarmdrop" to a paragraph of usage text about a subcommand the user never
   * typed — still technically a stated failure, and useless.
   *
   * The fixture is verbatim from `swarmdrop 0.8.0`, the last release without it.
   */
  it('lets an old swarmdrop be told apart from a failure to render', async () => {
    spawned.stderr = [
      "error: unrecognized subcommand 'qr'",
      '',
      'Usage: swarmdrop invite [OPTIONS] <COMMAND>',
      '',
      "For more information, try '--help'.",
    ].join('\n')
    spawned.code = 2

    const error = await inviteQr('https://swarmapp.cn/p/#AAAA', 240).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SwarmDropError)
    expect(isUnknownToCli(error as SwarmDropError)).toBe(true)
  })
})

