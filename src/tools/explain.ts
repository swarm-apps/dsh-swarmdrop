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
  // Must come before the exit-code hint: both codes this can arrive under
  // already have a hint, and both are wrong for it. See {@link versionSkew}.
  const skew = versionSkew(error)
  if (skew !== null) throw new Error(skew)
  const hint = error.exitCode === null ? '' : EXIT_HINTS[error.exitCode] ?? ''
  throw new Error(`${error.message}${hint}`)
}

/**
 * "The daemon and the binary are different versions", in English, or `null`.
 *
 * ## Why this needs its own branch
 *
 * SwarmDrop's data directory is per user, and at most one process holds the
 * node for it; everything else becomes a client over a local channel with no
 * version negotiation. So a binary talking to a daemon built from other code is
 * a real, ordinary state — `swarmdrop update` alone produces it, since it
 * replaces the executable while the daemon keeps running the old one.
 *
 * The CLI already says so, well, in both directions. The problem is the exit
 * code each arrives under, because **both already have a hint and both are
 * wrong**:
 *
 * - the daemon rejecting a verb it cannot parse is a *usage* error (2), so the
 *   hint tells the model to check its arguments — it has none to fix;
 * - the client failing to parse a *response* is "node unavailable" (3), so the
 *   hint says to start a node — one is running, that is the whole problem.
 *
 * Either way the model's next move is a retry that cannot work.
 *
 * ## Why match on the text
 *
 * The wording is the only thing that distinguishes these from the ordinary
 * failures sharing their exit codes. Matching Chinese source strings is
 * admittedly brittle, but the failure mode is benign — an unmatched message
 * falls through and is relayed as before — and the alternative is a dedicated
 * exit code for a case the CLI treats as a variant of two it already has.
 * The same trade is already made in `explainPairingExit`.
 *
 * The message is rewritten rather than relayed because the CLI speaks Chinese
 * and this plugin's surface is English, for a model as much as for a person.
 */
function versionSkew(error: SwarmDropError): string | null {
  // The daemon could not parse our request: it is older than this binary.
  if (error.message.includes('常驻节点无法解析这条请求')) {
    return 'the running SwarmDrop node is older than the `swarmdrop` this plugin'
      + ' runs, and does not have that command. Restart it — `swarmdrop stop`'
      + ' then `swarmdrop start -d` — so it picks up the current version.'
  }
  // We could not parse the daemon's response: it is newer than this binary.
  if (error.message.includes('多半是常驻节点比这条命令新')) {
    return 'the running SwarmDrop node is newer than the `swarmdrop` this plugin'
      + ' runs — there are two different versions installed on this machine.'
      + ' Check the About section for which binary is in use.'
  }
  return null
}

/**
 * What each exit code means for the model's next move.
 *
 * A table rather than a ternary chain, which also makes the gap visible: the CLI
 * documents six codes and three of them (2 usage, 5 transfer failed) have no
 * hint because the CLI's own message already says everything actionable.
 */
const EXIT_HINTS: Readonly<Record<number, string>> = {
  // 2 is clap's usage error, and for the transfer verbs it is also how the CLI
  // reports "that session is not in a state this action applies to": the picker
  // filters candidates by `Control::applies` first and a miss becomes a usage
  // error, not an entry in the result's `failed` list. Without this line a model
  // reads the (Chinese) usage text as its own mistake and retries with different
  // arguments forever — the loop this function exists to prevent.
  2: ' — check the arguments; for a transfer verb it also means the session is'
    + ' not in a state that action applies to (look it up with'
    + ' swarmdrop_transfer_status)',
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
 *
 * ⚠️ And run `npm install` after: `npm ci` refuses a lock file that does not
 * satisfy `package.json`, so the release workflow fails on its first step. The
 * range and the lock are one change.
 */
export const INBOX_SEARCH_SINCE = '0.7.0'
