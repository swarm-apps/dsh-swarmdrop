/**
 * Formatting the browser half shares.
 *
 * Separate from `coerce.ts` by concern, not by dependency: that file reads what
 * another process said (defensively, field by field), this one turns a number
 * into something a person reads. Both are dependency-free and safe in a page —
 * an earlier version of this note claimed `coerce` pulled `cli.ts` behind it,
 * which was never true.
 */

import type { DaemonVersion } from '../console-wire.js'

/**
 * Human-readable byte count.
 *
 * **Pure — these run during replay too.** A conversation row is rebuilt from the
 * log every time the session is opened, so anything here that read a clock, a
 * locale, or a preference would render differently on the second read of the
 * same event.
 *
 * The `@` menu row and the conversation row both call it, on the same item: two
 * copies would eventually disagree about the same file's size in two places on
 * one screen.
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  const units = ['KiB', 'MiB', 'GiB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${value.toFixed(1)} ${String(units[unit])}`
}

/**
 * Human-readable duration, from seconds.
 *
 * Pure, for the same reason {@link formatSize} is. Coarse on purpose: a
 * remaining time is an estimate that moves, and "1m 20s" ticking down digit by
 * digit reads as precision the number does not have. Anything over an hour
 * rounds to hours, because at that scale the minutes are noise.
 */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  if (whole < 60) return `${String(whole)}s`
  if (whole < 3600) {
    const minutes = Math.floor(whole / 60)
    const rest = whole % 60
    return rest === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(rest)}s`
  }
  const hours = Math.floor(whole / 3600)
  const minutes = Math.round((whole % 3600) / 60)
  return minutes === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(minutes)}m`
}

/**
 * Whether the running node and the binary this plugin runs are out of step.
 *
 * A judgement, not a formatter, but it belongs with them for the same reason:
 * it is pure, and it is the shape the About page renders. Split out from the
 * component so the three arms can be tested — two of them are conditions the
 * page cannot easily be put into by hand, and getting one backwards produces a
 * confident sentence about the wrong thing.
 */
export type VersionSkew =
  | { readonly kind: 'aligned' }
  /** A node is running but predates the version field: it is older. */
  | { readonly kind: 'silent' }
  | { readonly kind: 'differs'; readonly daemon: string }

/**
 * The `swarmdrop` version whose daemon started reporting itself in `status`.
 *
 * Needed because "reports no version" is only evidence of an *older* node when
 * the binary asking is new enough to expect an answer. Two 0.7.1s agree with
 * each other perfectly, and neither says a version — read without this floor,
 * that reads as skew and the page warns about a machine that is fine.
 */
const DAEMON_VERSION_SINCE = '0.8.0'

export function versionSkew(cli: string | null, daemon: DaemonVersion): VersionSkew {
  // No node: there is nothing for the binary to be out of step *with*. Saying
  // anything here is how a page tells someone who has not started SwarmDrop
  // that their node is out of date.
  if (daemon.state === 'none') return { kind: 'aligned' }
  // The binary could not be run at all. That is already its own row on the
  // page, and a version comparison with one side missing is not a second
  // finding — it is the same one, said worse.
  if (cli === null) return { kind: 'aligned' }
  if (daemon.state === 'silent') {
    return atLeast(cli, DAEMON_VERSION_SINCE) ? { kind: 'silent' } : { kind: 'aligned' }
  }
  return daemon.version === cli ? { kind: 'aligned' } : { kind: 'differs', daemon: daemon.version }
}

/**
 * The oldest `swarmdrop` this plugin can do anything with.
 *
 * 0.4.0 added `swarmdrop watch`, which the panel subscribes to; 0.5.0 added
 * `invite create --decide-from-stdin`, which is what lets the panel run the
 * pairing desk. Below that the plugin is not degraded, it is inert.
 *
 * It matters more now that `PATH` outranks the bundled copy: someone whose
 * Homebrew install has been sitting at an old version gets *that* one, and the
 * failures it produces (a subscription that exits, tools refusing verbs) do not
 * look like "your swarmdrop is old" from the outside. Saying it on the About
 * page is what turns them into one action.
 */
export const MINIMUM_CLI = '0.5.0'

/** Whether the binary in use is too old for this plugin to work. */
export function isTooOld(cli: string | null): boolean {
  // `null` is "could not be run at all" — its own row on the page, and not a
  // version claim we have any evidence for.
  return cli !== null && !atLeast(cli, MINIMUM_CLI)
}

/**
 * Whether `version` is at least `floor`, comparing `x.y.z` numerically.
 *
 * **Unparsable input answers `false`.** Every caller uses this to decide
 * whether to warn, so the conservative direction is "stay quiet": a version
 * string this does not understand is a reason to say nothing, not a reason to
 * tell someone their setup is broken.
 */
function atLeast(version: string, floor: string): boolean {
  const parts = (value: string) => value.split('.').map(part => Number.parseInt(part, 10))
  const left = parts(version)
  const right = parts(floor)
  if (left.length < right.length || left.some(Number.isNaN)) return false
  for (const [index, want] of right.entries()) {
    const have = left[index] ?? 0
    if (have !== want) return have > want
  }
  return true
}
