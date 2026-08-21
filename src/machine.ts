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
        break
      case 'inboxAdded':
        this.inbox = [entryOf(frame), ...this.inbox]
        break
      case 'inboxRemoved': {
        const itemId = text(frame['itemId'])
        this.inbox = this.inbox.filter(entry => entry.itemId !== itemId)
        break
      }
      // Transfers and progress are conversation matter, handled by the bridge.
      //
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
    }
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
