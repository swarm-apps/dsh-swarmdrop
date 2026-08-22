/**
 * The console's judgements, tested where they are made.
 *
 * Everything here is a **pure** function that decides something the user then
 * sees as a button, a path, or a sentence. The routes around them only spawn a
 * process and hand the result over, which is not something a unit test can say
 * anything useful about.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { SwarmDropError } from './cli.js'
import { isUnknownToCli } from './cli.js'
import { resolveDir, updateCheck } from './console.js'
import {
  ACTION_RELOADS, CONSOLE_SECTIONS, actionKey, controlsOf, type ConsoleAction,
} from './console-wire.js'

describe('controlsOf', () => {
  /**
   * **The page must offer only buttons the CLI will accept.**
   *
   * This mirrors `Control::applies` in the CLI. Drifting apart is silent on
   * this side: the button renders, the click is refused, and the refusal reads
   * as a bug in SwarmDrop rather than a row that had already finished.
   */
  it('mirrors the CLI rule for every phase', () => {
    expect(controlsOf({ phase: 'active' })).toEqual(['pause', 'cancel'])
    expect(controlsOf({ phase: 'offered' })).toEqual(['cancel'])
    expect(controlsOf({ phase: 'waiting_accept' })).toEqual(['cancel'])
    expect(controlsOf({ phase: 'terminal' })).toEqual([])
  })

  /** Resume needs the checkpoint intact; an unrecoverable break can only be re-sent. */
  it('offers resume only for a recoverable suspension', () => {
    expect(controlsOf({ phase: 'suspended', recoverable: true })).toEqual(['resume'])
    expect(controlsOf({ phase: 'suspended', recoverable: false })).toEqual([])
  })

  /**
   * A suspended transfer has no live actor to cancel and the CLI refuses.
   * Tempting to offer anyway, which is why it is pinned.
   */
  it('never offers cancel for a suspended transfer', () => {
    expect(controlsOf({ phase: 'suspended', recoverable: true })).not.toContain('cancel')
  })

  /** A newer CLI's phase reads as "nothing applies", not as a crash. */
  it('offers nothing for a phase it does not know', () => {
    expect(controlsOf({ phase: 'something-new' })).toEqual([])
    expect(controlsOf({})).toEqual([])
  })
})

describe('resolveDir', () => {
  /**
   * **`~` must be expanded here.** The CLI is spawned directly, with no shell
   * in between — a literal `~/Downloads` makes it create a directory actually
   * named `~`, and the files land somewhere the user cannot find.
   */
  it('expands a leading tilde', () => {
    expect(resolveDir('~/Downloads')).toBe(join(homedir(), 'Downloads'))
    expect(resolveDir('~')).toBe(homedir())
  })

  /** An absolute path is the user's own answer and is left alone. */
  it('leaves an absolute path untouched', () => {
    expect(resolveDir('/tmp/out')).toBe('/tmp/out')
  })

  /**
   * A relative path is resolved against home rather than against a working
   * directory: this page has none the user could reason about, and the Host's
   * cwd is wherever dsh happened to start.
   */
  it('resolves a relative path against home', () => {
    expect(resolveDir('out')).toBe(join(homedir(), 'out'))
  })

  /** Spaces are part of the path, not separators. */
  it('keeps a path with spaces whole', () => {
    expect(resolveDir('/tmp/My Files')).toBe('/tmp/My Files')
  })

  /** Empty is refused rather than forwarded — the CLI would open a picker. */
  it('refuses an empty destination', () => {
    expect(() => resolveDir('  ')).toThrow(SwarmDropError)
  })
})

describe('updateCheck', () => {
  /**
   * **Read from `status`, never from the exit code.** The CLI is explicit that
   * "a new version exists" is not a failure, so the code is 0 either way —
   * using it would make "no network" and "there is an update" the same event.
   */
  it('distinguishes the two normal outcomes', () => {
    expect(updateCheck({ status: 'upToDate', currentVersion: '0.6.0' }))
      .toEqual({ outcome: 'upToDate', current: '0.6.0', latest: null })
    expect(updateCheck({ status: 'updateAvailable', currentVersion: '0.6.0', latestVersion: '0.7.0' }))
      .toEqual({ outcome: 'updateAvailable', current: '0.6.0', latest: '0.7.0' })
  })

  /**
   * **A status this build does not know must not be forced into one of the two.**
   *
   * An externally managed install is not "up to date" — it is "ask the thing
   * that installed it", and saying the former sends the user to a command that
   * will refuse.
   */
  it('reports an unfamiliar status as unknown rather than guessing', () => {
    expect(updateCheck({ status: 'managedExternally', currentVersion: '0.6.0' }).outcome)
      .toBe('unknown')
    expect(updateCheck({}).outcome).toBe('unknown')
  })
})

describe('isUnknownToCli', () => {
  /**
   * The whole point: turn clap's argument-parsing error into "your CLI is too
   * old" instead of showing usage text to someone who typed nothing.
   */
  it('recognises clap refusing a command it has never heard of', () => {
    expect(isUnknownToCli(new SwarmDropError("error: unrecognized subcommand 'config'", 2)))
      .toBe(true)
    expect(isUnknownToCli(new SwarmDropError("error: unexpected argument '--json' found", 2)))
      .toBe(true)
  })

  /**
   * **A real usage error must not be disguised as version skew.** Telling
   * someone to upgrade when the address they pasted is malformed sends them
   * down the wrong path entirely.
   */
  it('leaves an ordinary usage error alone', () => {
    expect(isUnknownToCli(new SwarmDropError('引导节点地址被拒: 缺少 /p2p/ 段', 2))).toBe(false)
  })

  /** Only exit 2 is clap's; anything else is the command having run and failed. */
  it('ignores failures that are not usage errors', () => {
    expect(isUnknownToCli(new SwarmDropError('unrecognized subcommand', 3))).toBe(false)
    expect(isUnknownToCli(new SwarmDropError('unrecognized subcommand', null))).toBe(false)
  })
})

describe('the wire contract', () => {
  /**
   * **Every action says which section it invalidated.**
   *
   * A missing entry is silent and looks like the action failed: the row the
   * user just deleted stays on screen because nothing re-read the list.
   */
  it('maps every action kind to a section that exists', () => {
    const kinds: ConsoleAction['kind'][] = [
      'invite.revoke', 'invite.revokeAll', 'inbox.export', 'transfer.control',
      'setting.write', 'bootstrap.add', 'bootstrap.remove', 'cli.checkUpdate',
    ]
    for (const kind of kinds) {
      expect(CONSOLE_SECTIONS).toContain(ACTION_RELOADS[kind])
    }
    // Both directions: an entry for an action that no longer exists would
    // otherwise sit here forever, and the list above would stop being a check.
    expect(Object.keys(ACTION_RELOADS).sort()).toEqual([...kinds].sort())
  })

  /**
   * **Busy is per control, not per surface.**
   *
   * Two rows of the same kind must produce two keys, or a slow revoke on one
   * invite greys out every other revoke button on the page.
   */
  it('keys an action by its target, not only its verb', () => {
    expect(actionKey({ kind: 'invite.revoke', id: 'a' }))
      .not.toBe(actionKey({ kind: 'invite.revoke', id: 'b' }))
    expect(actionKey({ kind: 'bootstrap.remove', addr: '/ip4/1.1.1.1' }))
      .not.toBe(actionKey({ kind: 'bootstrap.remove', addr: '/ip4/2.2.2.2' }))
    expect(actionKey({ kind: 'setting.write', key: 'device-name', value: 'x' }))
      .not.toBe(actionKey({ kind: 'setting.write', key: 'receive-dir', value: 'x' }))
  })

  /**
   * Two controls on the *same* transfer are still two buttons — pausing must
   * not disable cancel on the same row.
   */
  it('keys two controls on one transfer apart', () => {
    const session = '00000000-0000-4000-8000-000000000000'
    expect(actionKey({ kind: 'transfer.control', control: 'pause', sessionId: session }))
      .not.toBe(actionKey({ kind: 'transfer.control', control: 'cancel', sessionId: session }))
  })

  /** An action with no target keys on the verb: there is only one such button. */
  it('keys a targetless action on its verb alone', () => {
    expect(actionKey({ kind: 'invite.revokeAll' })).toBe('invite.revokeAll')
    expect(actionKey({ kind: 'cli.checkUpdate' })).toBe('cli.checkUpdate')
  })
})
