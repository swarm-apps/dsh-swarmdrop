/**
 * Turning a CLI failure into something the model can act on.
 *
 * Separate from `shape.ts` because it translates a different thing: that file
 * turns *output* into this plugin's contract, this one turns *failure* into a
 * next move. They change for different reasons — a new field belongs there, a
 * new exit code belongs here — and the tools import both.
 */

import { SwarmDropError, isUnknownToCli } from '../cli.js'

/**
 * Turn a CLI failure into something the model can act on.
 *
 * The exit code is a *classification*, not a failure flag, and saying which one
 * it is decides the model's next move: 3 means "ask the user to start a node",
 * 4 means "the device is asleep, try later", 6 means "stop retrying".
 */
export function explain(error: unknown, since?: string): never {
  if (!(error instanceof SwarmDropError)) throw error
  // "That CLI has never heard of this verb" reaches us as clap's usage error,
  // whose text is about argument parsing — relayed as-is, a model reads it as
  // its own mistake and retries with different arguments, forever. Naming the
  // version turns a loop into one actionable sentence.
  if (since !== undefined && isUnknownToCli(error)) {
    throw new Error(
      `this needs swarmdrop ${since} or newer; the installed one does not have that command`,
    )
  }
  const hint = error.exitCode === null ? '' : EXIT_HINTS[error.exitCode] ?? ''
  throw new Error(`${error.message}${hint}`)
}

/**
 * What each exit code means for the model's next move.
 *
 * A table rather than a ternary chain, which also makes the gap visible: the CLI
 * documents six codes and three of them (2 usage, 5 transfer failed) have no
 * hint because the CLI's own message already says everything actionable.
 */
const EXIT_HINTS: Readonly<Record<number, string>> = {
  3: ' — no SwarmDrop node is running; the user can start one with `swarmdrop start -d`',
  4: ' — that device is not reachable right now; it may be asleep',
  6: ' — the peer refused; retrying will be refused again',
}

/**
 * The `swarmdrop` version a capability first appeared in.
 *
 * ⚠️ **Raising a floor means raising `optionalDependencies.swarmdrop` too.**
 * That range is what `dsh plugin add` installs as the bundled binary, and
 * `^0.6.0` does not match 0.7.0 — leave it behind and the copy this package
 * ships can never satisfy the floor this file declares. Every user who does not
 * already have their own SwarmDrop gets a tool that reports "needs a newer
 * version" forever, which reads as the plugin being broken rather than as a
 * dependency nobody bumped.
 */
export const INBOX_SEARCH_SINCE = '0.7.0'
