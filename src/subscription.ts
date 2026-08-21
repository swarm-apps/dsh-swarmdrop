/**
 * One `swarmdrop watch`, kept alive.
 *
 * ## Why this exists at all
 *
 * The subscription is the *only* thing that tells this plugin what the machine
 * looks like: devices, inbox, node liveness. It used to be spawned once at load
 * and never looked at again, which meant that the moment its process ended —
 * killed by a user, replaced by a `swarmdrop` upgrade, gone with a crash — the
 * mirror froze at whatever it happened to hold and **stayed there for the life
 * of the dsh process**. Nothing said so. The panel went on answering
 * confidently with facts that were minutes or hours old, which is the one thing
 * a status surface must never do; a panel that admits it does not know is
 * strictly better than one that quietly makes something up.
 *
 * So: restart it, and while it is down, say so.
 *
 * ## The backoff resets on a frame, not on a connect
 *
 * A spawn that succeeds and then dies immediately — the binary is there but the
 * CLI is broken, a `--json` flag it does not understand — would otherwise reset
 * the delay on every attempt and turn into a hot loop that spawns a process a
 * second, forever. A *frame* is the only evidence that the attempt actually
 * produced a working subscription, so that is what earns the reset.
 *
 * ## What a restart cannot repair
 *
 * The CLI replays a fresh `baseline` on every connect, so {@link MachineState}
 * heals completely: it adopts the baseline as a whole value. The conversation
 * side does not. Files that arrived during the outage are in the new baseline
 * but were never announced as `inboxAdded`, so no `swarmdrop/inbox-received`
 * row is appended for them — they show up in the panel and in the `@` menu, and
 * not in the transcript. Repairing that would mean diffing two baselines and
 * inventing events the CLI never sent, which is a larger claim than "you missed
 * some rows while SwarmDrop was not running".
 */

import { watch, type WatchFrame } from './cli.js'

/** How long to wait before the first retry. */
const FIRST_RETRY_MS = 1_000

/**
 * The longest the plugin will go without a subscription.
 *
 * Bounded rather than growing forever: the usual reason to be here is that the
 * binary is momentarily missing (an upgrade replacing it), and a half-hour
 * backoff would outlast the cause by a wide margin.
 */
const MAX_RETRY_MS = 30_000

/** What the supervisor reports upward. */
export interface SubscriptionHooks {
  /** One frame off the subscription. */
  onFrame(frame: WatchFrame): void
  /**
   * The subscription's health changed: a sentence while it is down, `null` the
   * moment frames flow again. Called only on a change, so a consumer can treat
   * it as an edge rather than filtering duplicates.
   */
  onHealth(trouble: string | null): void
}

/** The two seams a test replaces; production passes neither. */
export interface SubscriptionDeps {
  /** Spawn one subscription. Signature of {@link watch}. */
  readonly start: typeof watch
  /** Schedule a retry. Returns a handle {@link SubscriptionDeps.cancel} accepts. */
  readonly schedule: (fn: () => void, ms: number) => unknown
  readonly cancel: (handle: unknown) => void
}

const LIVE: SubscriptionDeps = {
  start: watch,
  schedule: (fn, ms) => setTimeout(fn, ms),
  cancel: handle => { clearTimeout(handle as ReturnType<typeof setTimeout>) },
}

/** A subscription that survives its own process dying. */
export class WatchSubscription {
  private stopCurrent: (() => void) | undefined
  private retry: unknown
  private wait = FIRST_RETRY_MS
  private trouble: string | null = null
  private disposed = false

  constructor(
    private readonly hooks: SubscriptionHooks,
    private readonly deps: SubscriptionDeps = LIVE,
  ) {
    this.open()
  }

  /** Non-null while the subscription is down. */
  health(): string | null {
    return this.trouble
  }

  /** Stop for good. Further exits are ours and are not reported. */
  dispose(): void {
    this.disposed = true
    if (this.retry !== undefined) {
      this.deps.cancel(this.retry)
      this.retry = undefined
    }
    this.stopCurrent?.()
    this.stopCurrent = undefined
  }

  private open(): void {
    if (this.disposed) return
    this.stopCurrent = this.deps.start(
      frame => {
        // Evidence that this attempt produced a working subscription.
        this.wait = FIRST_RETRY_MS
        this.report(null)
        this.hooks.onFrame(frame)
      },
      message => { this.ended(message) },
    )
  }

  private ended(message: string): void {
    if (this.disposed) return
    // The handle belongs to a process that is gone; calling its stop() later
    // would SIGTERM a pid this plugin no longer owns.
    this.stopCurrent = undefined
    this.report(message)
    const wait = this.wait
    this.wait = Math.min(this.wait * 2, MAX_RETRY_MS)
    this.retry = this.deps.schedule(() => {
      this.retry = undefined
      this.open()
    }, wait)
  }

  private report(trouble: string | null): void {
    if (this.trouble === trouble) return
    this.trouble = trouble
    this.hooks.onHealth(trouble)
  }
}
