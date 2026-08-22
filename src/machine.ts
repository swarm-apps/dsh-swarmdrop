/**
 * What SwarmDrop reports about *this machine*, folded from one subscription.
 *
 * ## Why a state mirror lives here and nowhere else
 *
 * `src/types.ts` argues at length that a *session log* must never carry a state
 * mirror. That argument is about the log, not about the process: something has
 * to know whether a node is running right now, and re-asking the CLI on every
 * question would both cost a process spawn and race with the subscription that
 * already knows the answer.
 *
 * So the mirror is explicitly *here*, outside the session, and it is the single
 * place that folds `swarmdrop watch` frames. Two consumers read it and neither
 * keeps a second copy:
 *
 * | Consumer | Reads | Because |
 * |---|---|---|
 * | {@link SwarmDropBridge} | the inbox | a starting session needs "what you had at hand" |
 * | the panel's RPC face | everything | the browser asks what this machine looks like |
 *
 * ## What is *not* here
 *
 * Network detail — NAT class, listen addresses, relay reservation — is **state,
 * not events**, so the subscription does not carry it and this class does not
 * invent it. The panel asks `swarmdrop status` for that, on demand. Putting a
 * network snapshot in here would mean polling the CLI forever to keep a mirror
 * warm that nobody is looking at.
 */

import type { WatchFrame } from './cli.js'
import { count, presence, rows, text } from './coerce.js'
import type { Revision } from './revision.js'
import type { InboxBaselineData, InboxEntryData } from './types.js'

/** How many inbox entries a session baseline carries. */
const BASELINE_LIMIT = 50

/** One paired device, as the subscription reports it. */
export interface DeviceState {
  /** Stable node identity. The only thing safe to address a device by. */
  readonly peerId: string
  /** Display name the device chose for itself. */
  readonly name: string
  /**
   * `null` is **unknown**, not offline.
   *
   * The CLI is emphatic about this and the distinction survives all the way to
   * the panel: "offline" sends the user to debug their network, when the real
   * answer is usually "no node is running, so nothing has been probed".
   */
  readonly online: boolean | null
}

/**
 * One transfer that has not finished, folded from two frame kinds.
 *
 * `transferChanged` carries who and what phase; `transferProgress` carries how
 * far and how fast. Neither is enough alone, which is why this is a fold rather
 * than a projection of one frame.
 */
export interface TransferState {
  readonly sessionId: string
  /** `send` or `receive`. */
  readonly direction: string
  /** The other end, as the user will recognise it. */
  readonly peerName: string
  /** `offered` / `waiting_accept` / `active` / `suspended` — never `terminal`, see below. */
  readonly phase: string
  readonly transferredBytes: number
  readonly totalBytes: number
  readonly fileCount: number
  /**
   * Whether an interrupted transfer can still be resumed.
   *
   * Carried because it is half of the rule for offering a Resume button — a
   * suspension whose checkpoint is gone can only be sent again. See
   * `controlsOf`.
   */
  readonly recoverable: boolean
  /**
   * Bytes per second, or `null` when nothing can be said.
   *
   * The CLI reports `0` for "no new bytes within a sliding window" — a stall,
   * which is what publishing a finished file looks like — and that is not the
   * same claim as "the rate is zero". Normalised here rather than at each
   * consumer, exactly like {@link DeviceState.online}: a number a reader has to
   * remember a rule about is a rule that will eventually be forgotten.
   */
  readonly speed: number | null
  /** Seconds remaining, or `null` when the core cannot say. */
  readonly eta: number | null
  /** Unix milliseconds, from the last frame that touched this session. */
  readonly updatedAt: number
}

/** Everything the subscription knows, as one value. */
export interface MachineSnapshot {
  /** Whether a SwarmDrop node is running on this machine. */
  readonly nodeRunning: boolean
  /** Paired devices, in the order the CLI reports them. */
  readonly devices: readonly DeviceState[]
  /** Inbox entries, newest first. */
  readonly inbox: readonly InboxEntryData[]
  /** True when the CLI told us older inbox entries exist beyond the ones listed. */
  readonly inboxHasMore: boolean
  /** Transfers that have not finished, newest activity first. */
  readonly transfers: readonly TransferState[]
}

/** Build one inbox entry from a frame, tolerating a newer CLI's extra fields. */
export function entryOf(frame: Readonly<Record<string, unknown>>): InboxEntryData {
  return {
    itemId: text(frame['itemId']),
    contentKind: text(frame['contentKind']),
    sourceName: text(frame['sourceName']),
    itemCount: count(frame['itemCount']),
    totalSize: count(frame['totalSize']),
    receivedAt: count(frame['receivedAt']),
  }
}

/** The phase a finished transfer reports. Such a session leaves the table. */
const PHASE_TERMINAL = 'terminal'

/** The only phase in which bytes are actually moving. */
const PHASE_ACTIVE = 'active'

/**
 * Build one transfer from a `transferChanged` frame.
 *
 * **Rate is not on this frame** and is deliberately not invented: it arrives on
 * `transferProgress` alone. A caller merging this over an existing row must
 * carry the old rate across — see {@link MachineState.acceptTransfer}.
 */
function transferOf(frame: Readonly<Record<string, unknown>>): TransferState {
  return {
    sessionId: text(frame['sessionId']),
    direction: text(frame['direction']),
    peerName: text(frame['peerName']),
    phase: text(frame['phase']),
    transferredBytes: count(frame['transferredBytes']),
    totalBytes: count(frame['totalBytes']),
    fileCount: count(frame['fileCount']),
    recoverable: frame['recoverable'] === true,
    speed: null,
    eta: null,
    updatedAt: count(frame['updatedAt']),
  }
}

/**
 * Read a rate off a `transferProgress` frame.
 *
 * `0` becomes `null` on purpose — see {@link TransferState.speed}. An absent
 * field does too: a CLI older than 0.7.0 does not send it, and a panel that
 * drew "0 B/s" there would be reporting a stall that is not happening.
 */
function rateOf(frame: Readonly<Record<string, unknown>>): number | null {
  const speed = frame['speed']
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 1) return null
  return speed
}

/** Same, for the seconds remaining. `null` covers absent, null and nonsense alike. */
function etaOf(frame: Readonly<Record<string, unknown>>): number | null {
  const eta = frame['eta']
  if (typeof eta !== 'number' || !Number.isFinite(eta) || eta < 0) return null
  return eta
}

/** Build one device from a frame, tolerating a newer CLI's extra fields. */
function deviceOf(frame: Readonly<Record<string, unknown>>): DeviceState {
  return {
    peerId: text(frame['peerId']),
    name: text(frame['name']),
    online: presence(frame['online']),
  }
}

/**
 * The live mirror.
 *
 * Not a `SnapshotStore` in dsh's sense: this is the *Node* half, where nothing
 * renders. Change notification is delegated to a shared {@link Revision} rather
 * than owned here, because the panel watches this *and* the pairing session
 * through one parked request — see that module for why one counter.
 */
export class MachineState {
  private nodeRunning = false
  private devices: DeviceState[] = []
  private inbox: InboxEntryData[] = []
  private inboxHasMore = false
  private transfers: TransferState[] = []

  /**
   * @param revision - the shared change counter this mirror bumps. Injected
   *   rather than created so the pairing session can share it.
   */
  constructor(private readonly revision: Revision) {}

  /**
   * Fold one subscription frame.
   *
   * ⚠️ **Unknown kinds are ignored, not rejected.** A newer CLI may add frame
   * kinds; treating those as an error would take the mirror down over something
   * that by construction cannot affect what it already holds.
   *
   * @param frame - one line off `swarmdrop watch --json`.
   */
  accept(frame: WatchFrame): void {
    switch (frame.kind) {
      case 'baseline':
        // A baseline is a whole value: adopt it wholesale rather than merging.
        // It arrives on subscribe *and every time a node reappears*, which is
        // precisely when a merge would be wrong.
        this.nodeRunning = frame['nodeRunning'] === true
        this.devices = rows(frame['devices']).map(deviceOf)
        this.inbox = rows(frame['inbox']).map(entryOf)
        this.inboxHasMore = frame['inboxHasMore'] === true
        // The baseline lists *unfinished* transfers, so the filter is a
        // belt-and-braces reading of the contract rather than a correction —
        // but a finished row here would never leave again, because the
        // `transferChanged` that retires it has already been and gone.
        this.transfers = rows(frame['transfers'])
          .map(transferOf)
          .filter(transfer => transfer.phase !== PHASE_TERMINAL)
        break
      case 'devicesChanged':
        // The CLI sends the whole device table rather than a diff, precisely so
        // consumers need not maintain a mirror that can fork from the truth.
        this.devices = rows(frame['devices']).map(deviceOf)
        break
      case 'nodeUnavailable':
        this.nodeRunning = false
        // Online state was a claim about a node that is now gone. Keeping it
        // would leave the panel showing devices as "online" indefinitely.
        this.devices = this.devices.map(device => ({ ...device, online: null }))
        // Transfers go further than that: they are not *unknown* now, they are
        // not happening. The actors died with the node, and the next baseline
        // brings back whatever survived as resumable — with a fresh phase.
        this.transfers = []
        break
      case 'inboxAdded':
        this.inbox = [entryOf(frame), ...this.inbox]
        break
      case 'inboxRemoved': {
        const itemId = text(frame['itemId'])
        this.inbox = this.inbox.filter(entry => entry.itemId !== itemId)
        break
      }
      case 'transferChanged':
        this.acceptTransfer(transferOf(frame))
        break
      case 'transferProgress':
        this.acceptProgress(frame)
        break
      // ⚠️ `truncated` is deliberately *not* folded, and that is a known gap
      // rather than a decision the mirror can make: it means the CLI dropped
      // edge events because this consumer read too slowly, so the inbox list
      // here may be missing entries with nothing to repair it — the CLI has no
      // "resend the baseline" verb, and re-spawning the subscription to force
      // one would drop every other consumer's continuity to fix a list. The
      // subscription only truncates under sustained pressure, and this consumer
      // folds in memory, so it should not happen; `index.ts` logs it if it does.
      default:
        return
    }
    this.revision.bump()
  }

  /** Everything, as one value. */
  snapshot(): MachineSnapshot {
    return {
      nodeRunning: this.nodeRunning,
      devices: this.devices,
      inbox: this.inbox,
      inboxHasMore: this.inboxHasMore,
      transfers: this.transfers,
    }
  }

  /**
   * A transfer changed phase, or a new one appeared.
   *
   * **Merges rather than replaces**: the rate lives only on progress frames, so
   * overwriting the row wholesale would blank the rate on every phase change —
   * and a phase change is exactly when a transfer becomes interesting to look
   * at. The one case that *does* clear it is leaving `active`: a paused or
   * waiting transfer has no bytes moving, and a rate left over from a minute
   * ago is a claim about a machine state that no longer exists.
   */
  private acceptTransfer(next: TransferState): void {
    if (next.phase === PHASE_TERMINAL) {
      this.transfers = this.transfers.filter(row => row.sessionId !== next.sessionId)
      return
    }
    const previous = this.transfers.find(row => row.sessionId === next.sessionId)
    const merged: TransferState = previous === undefined || next.phase !== PHASE_ACTIVE
      ? next
      : { ...next, speed: previous.speed, eta: previous.eta }
    this.transfers = [
      merged,
      ...this.transfers.filter(row => row.sessionId !== next.sessionId),
    ]
  }

  /**
   * A progress sample landed.
   *
   * **A sample for a session this mirror has never heard of is dropped.** It can
   * only happen when the `transferChanged` that would have introduced it was
   * truncated (progress is a sample and never dropped; phase changes are edges
   * and can be), and a row built from a progress frame alone has no peer and no
   * phase — the panel would draw "— 42%", which is worse than drawing nothing
   * for the second it takes the next phase change to arrive.
   */
  private acceptProgress(frame: Readonly<Record<string, unknown>>): void {
    const sessionId = text(frame['sessionId'])
    const index = this.transfers.findIndex(row => row.sessionId === sessionId)
    if (index < 0) return
    const previous = this.transfers[index]
    if (previous === undefined) return
    this.transfers = this.transfers.map((row, at) => at === index
      ? {
          ...row,
          transferredBytes: count(frame['transferredBytes']),
          // ⚠️ **Fall back to what the row already holds.** This is a merge, and
          // `count()` answers 0 for a missing field — a progress frame that
          // omits the total would zero it permanently, because `transferChanged`
          // does not come again while a transfer is active. The percentage would
          // sit at 0 for the rest of the transfer.
          totalBytes: count(frame['totalBytes']) || row.totalBytes,
          speed: rateOf(frame),
          eta: etaOf(frame),
        }
      : row)
  }

  /** The bounded checkpoint one starting session records. */
  baseline(): InboxBaselineData {
    return {
      version: 1,
      items: this.inbox.slice(0, BASELINE_LIMIT),
      // Either the CLI already told us there were older ones, or our own cap bit.
      hasMore: this.inboxHasMore || this.inbox.length > BASELINE_LIMIT,
      nodeRunning: this.nodeRunning,
    }
  }
}
