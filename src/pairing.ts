/**
 * The pairing desk: one window at a time, and who is standing at it.
 *
 * ## Why pairing needs UI at all
 *
 * Until now the only way to pair a device from a dsh session was to leave it,
 * open a terminal, and run `swarmdrop invite create` — which is a strange thing
 * to ask of someone whose whole reason for installing a plugin was not to.
 *
 * The reason it was ever like that is real, though, and survives here: pairing
 * **must** have a person looking at the far side's identity. An invite is a
 * one-shot capability that travels as a link; whoever presents it first
 * consumes it. So SwarmDrop's node refuses every inbound request unless someone
 * is at the desk, and `invite create` running *is* the desk being staffed.
 *
 * This class moves the desk into the browser without weakening any of that. The
 * request still reaches a human, who still sees the peer's node id before
 * saying yes. What changed is only *where* they are standing.
 *
 * ## One window, and closing it means closing it
 *
 * There is at most one session because there is at most one desk: two open
 * invites would mean two processes racing to answer the same inbound request.
 * {@link PairingSession.begin} on an already-open window is therefore a no-op
 * rather than a second process.
 *
 * Cancelling kills the process, which is what shuts the window — the node goes
 * back to refusing everything. That matters more than it looks: it is the only
 * thing standing between a leaked invite link and a stranger's device.
 */

import type { Context } from '@deepseek-ai/cordis'

import { pair, type PairFrame, type PairSession } from './cli.js'
import { count, text } from './coerce.js'
import { IDLE_PAIRING, type PairingRequestView, type PairingSnapshot } from './panel-wire.js'
import type { Revision } from './revision.js'

/** Build a request view from an untrusted frame, tolerating a newer CLI. */
function requestOf(frame: PairFrame): PairingRequestView {
  return {
    pendingId: count(frame['pendingId']),
    peerId: text(frame['peerId']),
    device: text(frame['device']),
    os: text(frame['os']),
    arch: text(frame['arch']),
    connection: text(frame['connection']),
  }
}

/** The desk. */
export class PairingSession {
  private state: PairingSnapshot = IDLE_PAIRING
  private session: PairSession | undefined

  /**
   * @param ctx - for logging only; this class registers nothing.
   * @param revision - the shared change counter the panel parks on.
   */
  constructor(private readonly ctx: Context, private readonly revision: Revision) {}

  snapshot(): PairingSnapshot {
    return this.state
  }

  /**
   * Open a window, unless one is already open.
   *
   * Idempotent on purpose: the button that calls this is in a panel that can be
   * open in two browser tabs, and the second click must not start a second
   * process racing the first for the same inbound request.
   */
  begin(): void {
    if (this.session !== undefined) return

    this.set({ ...IDLE_PAIRING, phase: 'waiting' })
    this.session = pair(
      frame => { this.accept(frame) },
      message => {
        this.ctx.logger('swarmdrop').warn('pairing: %s', message)
        // The window is gone whatever the reason, so the phase goes back to
        // idle rather than staying on a "waiting" that nothing is serving.
        this.session = undefined
        this.set({ ...IDLE_PAIRING, error: message })
      },
    )
  }

  /** Close the window. The node goes back to refusing inbound pairing. */
  cancel(): void {
    this.session?.stop()
    this.session = undefined
    this.set(IDLE_PAIRING)
  }

  /**
   * Answer the request the user is looking at.
   *
   * The id is checked against what we are actually holding: a click that raced
   * an expiry would otherwise answer a *different* request that arrived in
   * between — accepting a device the user never saw.
   */
  respond(pendingId: number, accept: boolean): void {
    if (this.state.request?.pendingId !== pendingId) return
    this.session?.respond(pendingId, accept)
    // Back to waiting either way. A decline does not consume the invite, so the
    // window stays open for the device the user is actually expecting.
    this.set({ ...this.state, phase: 'waiting', request: null })
  }

  /** Tear down with the plugin. */
  dispose(): void {
    this.session?.stop()
    this.session = undefined
  }

  /**
   * Fold one line of the CLI's pairing stream.
   *
   * Unknown events are ignored rather than treated as errors: a newer CLI may
   * add them, and none of them can invalidate what this already holds.
   */
  private accept(frame: PairFrame): void {
    switch (frame.event) {
      case 'inviteCreated':
        this.set({
          ...this.state,
          phase: 'waiting',
          invite: text(frame['invite']),
          inviteId: text(frame['id']),
        })
        return
      case 'pairingRequest':
        this.set({ ...this.state, phase: 'deciding', request: requestOf(frame) })
        return
      case 'pairingDeclined':
      case 'pairingRequestExpired':
        // Both mean "back to waiting": the invite was not consumed either way.
        // `respond` has usually moved us already; this covers the expiry case,
        // where nobody clicked anything.
        this.set({ ...this.state, phase: 'waiting', request: null })
        return
      case 'paired':
        // The CLI exits after a successful pairing, so the window is closed
        // whether or not anyone presses cancel.
        this.session = undefined
        this.set({
          ...this.state,
          phase: 'paired',
          request: null,
          pairedDevice: text(frame['device']),
        })
        return
      default:
        return
    }
  }

  private set(next: PairingSnapshot): void {
    this.state = next
    this.revision.bump()
  }
}
