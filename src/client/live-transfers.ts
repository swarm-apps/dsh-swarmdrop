/**
 * The live view of a transfer, for a conversation row that may not have one.
 *
 * ## Why this seam exists
 *
 * A conversation row is registered **unconditionally** — its content comes from
 * the session log, which needs no channel — while the panel's RPC channel is
 * **optional** (`connection` may be absent in a headless or embedded
 * deployment). So the row cannot simply close over the port: at registration
 * time there may not be one, and one may appear later.
 *
 * This holder is the join. The row is handed a stable observable at
 * registration; what it answers changes from "nothing live" to "here is that
 * transfer" when a channel arrives, and back if it goes away.
 *
 * ## What each half is allowed to say
 *
 * | Source | Answers | Because |
 * |---|---|---|
 * | the session log | who, how many files, how it ended | it must rebuild identically on replay |
 * | this holder | how far, how fast, can it be paused | it is only true *right now* |
 *
 * A row with no live entry is not an error — it is the normal state of every
 * transfer that has already finished, and of every row anyone reads back later.
 * That is why the fallback is the log's own account rather than a spinner.
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

import type { PanelTransfer, TransferControlAction } from '../panel-wire.js'
import { transferKey } from './busy.js'
import type { PanelPort, PanelState } from './panel-port.js'

/** What a row can learn about a transfer that is still happening. */
export interface LiveTransfer {
  readonly phase: string
  readonly transferredBytes: number
  readonly totalBytes: number
  /** Bytes per second, or `null` when nothing can be said. **Never `0`.** */
  readonly speed: number | null
  /** Seconds remaining, or `null`. */
  readonly eta: number | null
  /** Whether an interrupted transfer can still be resumed. Half of `controlsOf`. */
  readonly recoverable: boolean
  /** True while a control this row sent is still in flight. */
  readonly busy: boolean
}

/** Every transfer the machine currently has in flight, by id. */
export type LiveSnapshot = Readonly<Record<string, LiveTransfer>>

/** Nothing is live — no channel, or nothing running. One frozen value, so
 * `getSnapshot` keeps returning the same reference and React sees no change. */
const NOTHING: LiveSnapshot = Object.freeze({})

/** What a conversation row is handed. */
export interface LiveTransfersFace {
  hooks: { live: HostObservable<LiveSnapshot> }
  onControl(transferId: string, action: TransferControlAction): void
}

/** The holder: one face, and a channel that comes and goes behind it. */
export interface LiveTransfers {
  /** Hand this to `slots.register`'s inject factory. Stable for the lifetime of the plugin. */
  readonly face: LiveTransfersFace
  /** A channel arrived. Returns the detach. */
  attach(port: PanelPort): () => void
}

/** Project the panel's state into the narrow thing a row needs. */
function project(state: PanelState): LiveSnapshot {
  if (state.transfers.length === 0) return NOTHING
  const live: Record<string, LiveTransfer> = {}
  for (const transfer of state.transfers) {
    live[transfer.sessionId] = entryOf(transfer, state.busy.includes(transferKey(transfer.sessionId)))
  }
  return live
}

/** One entry, so the projection reads as one thing rather than an inline literal. */
function entryOf(transfer: PanelTransfer, busy: boolean): LiveTransfer {
  return {
    phase: transfer.phase,
    transferredBytes: transfer.transferredBytes,
    totalBytes: transfer.totalBytes,
    speed: transfer.speed,
    eta: transfer.eta,
    recoverable: transfer.recoverable,
    busy,
  }
}

/**
 * Whether two snapshots say the same thing.
 *
 * Compared field by field rather than by reference: the panel state is rebuilt
 * on every answer, so reference equality would report a change every second and
 * re-render every transfer row in the transcript.
 */
function same(a: LiveSnapshot, b: LiveSnapshot): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every(id => {
    const left = a[id]
    const right = b[id]
    return left !== undefined && right !== undefined
      && left.phase === right.phase
      && left.transferredBytes === right.transferredBytes
      && left.totalBytes === right.totalBytes
      && left.speed === right.speed
      && left.eta === right.eta
      && left.recoverable === right.recoverable
      && left.busy === right.busy
  })
}

export function createLiveTransfers(): LiveTransfers {
  let snapshot: LiveSnapshot = NOTHING
  let port: PanelPort | undefined
  const listeners = new Set<() => void>()

  function publish(next: LiveSnapshot): void {
    if (same(snapshot, next)) return
    snapshot = next
    for (const listener of listeners) listener()
  }

  return {
    face: {
      hooks: {
        live: {
          getSnapshot: () => snapshot,
          subscribe(fn) {
            listeners.add(fn)
            return () => listeners.delete(fn)
          },
        },
      },
      // Silently ignored when no channel is attached. A row only offers the
      // control when it has a live entry, and a live entry can only come from
      // an attached port — so reaching here without one means the channel went
      // away between the render and the click, which is not the user's problem
      // to hear about.
      onControl(transferId, action) {
        void port?.controlTransfer(transferId, action)
      },
    },
    attach(next) {
      port = next
      const stop = next.state.subscribe(() => { publish(project(next.state.getSnapshot())) })
      publish(project(next.state.getSnapshot()))
      return () => {
        stop()
        port = undefined
        publish(NOTHING)
      }
    },
  }
}
