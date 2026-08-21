/**
 * The panel's browser half: one live view of the machine, and the actions on it.
 *
 * ## Two loops, because the two halves of the truth arrive differently
 *
 * `state` is a **long poll**: the Host parks the request until the machine
 * actually changes, so a phone coming online reaches the panel the moment the
 * CLI says so, with no timer anywhere. It runs whenever the plugin is loaded —
 * the sidebar badge has to be right before anyone opens anything, and a parked
 * request costs nothing.
 *
 * A long poll is not a preference here. dsh forwards Host events to the browser
 * from a **fixed allowlist** (`API_REMOTE_FORWARDED_EVENTS`), which a
 * third-party plugin cannot extend, so there is no way to be *pushed* to. What
 * a long poll buys back is the latency: the request is already parked when the
 * change happens, so the answer leaves the Host immediately rather than at the
 * next tick of a timer.
 *
 * `network` is a **timer**, and only while the panel is open. Nothing announces
 * a NAT re-classification or a relay reservation, so the only way to learn it
 * is to ask — and asking spawns a `swarmdrop status` process. Doing that on a
 * schedule nobody is watching would be a background process every few seconds,
 * forever, to keep a value warm that is not on screen.
 *
 * ## Failure is a state, not an exception
 *
 * Every outcome the user could act on lands in {@link PanelState}: no binary
 * installed, no node running, an action refused. The panel draws them. Throwing
 * would leave the sidebar showing whatever it had last, which is the one thing
 * a status indicator must never do.
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext, ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

import {
  ENDPOINT_DEVICE_FORGET, ENDPOINT_NETWORK, ENDPOINT_NODE_START, ENDPOINT_NODE_STOP,
  ENDPOINT_PAIR_BEGIN, ENDPOINT_PAIR_CANCEL, ENDPOINT_PAIR_RESPOND, ENDPOINT_STATE, PANEL_CHANNEL,
  IDLE_PAIRING,
  type ActionAnswer, type NetworkAnswer, type PairingSnapshot, type PanelDevice, type StateAnswer,
} from '../panel-wire.js'

/** How often the open panel re-asks for network posture. */
const NETWORK_INTERVAL_MS = 3_000

/** How long to wait before retrying a state poll that failed outright. */
const RETRY_DELAY_MS = 2_000

/** Which long-running action is in flight, if any. */
export type PanelBusy = 'node.start' | 'node.stop' | 'device.forget' | 'pair' | null

/** Everything the panel draws. */
export interface PanelState {
  /**
   * Whether the panel has ever heard back from the Host.
   *
   * Distinguishing "not yet known" from "known to be stopped" is what keeps the
   * badge from claiming a node is down during the first round trip.
   */
  readonly ready: boolean
  readonly nodeRunning: boolean
  readonly devices: readonly PanelDevice[]
  readonly inboxCount: number
  /** `null` until the panel has been opened once — see the module note. */
  readonly network: NetworkAnswer | null
  /** The pairing desk: whether a window is open and who is at it. */
  readonly pairing: PairingSnapshot
  readonly busy: PanelBusy
  /**
   * The channel itself is not working — no binary, Host unreachable, a 500.
   *
   * Cleared by any successful round, because a successful round *is* the
   * evidence that it is working again.
   */
  readonly error: string | null
  /**
   * The last action the user asked for did not happen, in the CLI's own words.
   *
   * **Separate from {@link error} on purpose.** They are cleared by different
   * things: "could not start the node" stays on screen until the user tries
   * something else, while a transport error is answered by the next poll. Folded
   * together, a state answer arriving a moment after a failed click would wipe
   * the only explanation the user had.
   */
  readonly actionError: string | null
}

const INITIAL: PanelState = {
  ready: false,
  nodeRunning: false,
  devices: [],
  inboxCount: 0,
  network: null,
  pairing: IDLE_PAIRING,
  busy: null,
  error: null,
  actionError: null,
}

/** What the panel component is handed. */
export interface PanelPort {
  /** The live state, in the shape dsh's hooks consume. */
  readonly state: ObservableSnapshot<PanelState>
  /** Start or stop the network timer as the panel opens and closes. */
  setOpen(open: boolean): void
  startNode(): Promise<void>
  stopNode(): Promise<void>
  forget(peerId: string): Promise<void>
  /** Open a pairing window: issue an invite and staff the desk. */
  beginPair(): Promise<void>
  /** Close it. The node goes back to refusing inbound requests. */
  cancelPair(): Promise<void>
  /** Answer the request the user is looking at. */
  respondPair(pendingId: number, accept: boolean): Promise<void>
  dispose(): void
}

/** Sleep that resolves early when the port is disposed. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(finish, ms)
    function finish(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    signal.addEventListener('abort', finish, { once: true })
  })
}

/** Whether two network answers say the same thing. */
function sameNetwork(a: NetworkAnswer | null, b: NetworkAnswer | null): boolean {
  if (a === null || b === null) return a === b
  return a.status === b.status
    && a.peerId === b.peerId
    && a.natStatus === b.natStatus
    && a.publicAddr === b.publicAddr
    && a.relayReady === b.relayReady
    && a.bootstrapConnected === b.bootstrapConnected
    && a.connectedPeers === b.connectedPeers
    && a.listenAddrs.length === b.listenAddrs.length
    && a.listenAddrs.every((addr, index) => addr === b.listenAddrs[index])
}

/**
 * Whether two device tables say the same thing.
 *
 * Needed because the table arrives as a freshly parsed array on every answer,
 * so a reference comparison is always "changed" — and the Host answers on the
 * 25 s poll ceiling even when nothing moved. Without this the panel re-renders
 * every 25 s on a completely idle machine, which is exactly what `patch` exists
 * to prevent.
 *
 * ⚠️ **`online` has to be in the comparison.** Leaving it out would swallow a
 * device coming online — the one change the panel exists to show.
 */
function sameDevices(a: readonly PanelDevice[], b: readonly PanelDevice[]): boolean {
  return a.length === b.length && a.every((device, index) => {
    const other = b[index]
    return other !== undefined
      && device.peerId === other.peerId
      && device.name === other.name
      && device.online === other.online
  })
}

/** Whether two pairing snapshots say the same thing. */
function samePairing(a: PairingSnapshot, b: PairingSnapshot): boolean {
  return a.phase === b.phase
    && a.invite === b.invite
    && a.inviteId === b.inviteId
    && a.pairedDevice === b.pairedDevice
    && a.error === b.error
    && a.request?.pendingId === b.request?.pendingId
}

/** The one error message a failure produces, whatever kind of failure it was. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createPanelPort(ctx: ClientContext): PanelPort {
  const connection = ctx.get('connection') as ConnectionHandle
  const store = createSnapshotStore<PanelState>(INITIAL)
  const life = new AbortController()
  let networkTimer: ReturnType<typeof setInterval> | undefined
  let panelOpen = false

  /**
   * Replace the fields that changed.
   *
   * `SnapshotStore.set` takes a whole value and always publishes, so the
   * network timer — which mostly reads back an identical answer — would
   * re-render the panel every few seconds for nothing. Comparing first is what
   * makes an unchanging machine cost zero renders.
   */
  function patch(next: Partial<PanelState>): void {
    const current = store.getSnapshot()
    const merged = { ...current, ...next }
    const changed = (Object.keys(next) as (keyof PanelState)[]).some(key => {
      if (key === 'network') return !sameNetwork(current.network, merged.network)
      if (key === 'pairing') return !samePairing(current.pairing, merged.pairing)
      if (key === 'devices') return !sameDevices(current.devices, merged.devices)
      return current[key] !== merged[key]
    })
    if (!changed) return
    store.set(merged)
  }

  /**
   * One call, with the transport's two failure shapes folded into one.
   *
   * `rpc.call` reports a refusal in its result and a transport fault by
   * throwing. A caller that had to handle both separately would write the same
   * three lines at every call site, and the panel treats them identically
   * anyway: something did not work, and here is what it said.
   */
  async function ask<T>(endpoint: string, payload: unknown): Promise<T> {
    const answer = await connection.rpc.call(PANEL_CHANNEL, endpoint, payload, life.signal)
    if (!answer.ok) throw new Error(`${answer.error.code}: ${answer.error.message}`)
    return answer.value as T
  }

  /**
   * Long-poll the machine mirror forever.
   *
   * `since` advances only on a real answer, so a failed round never skips a
   * version — the next successful call still returns everything that changed
   * while the transport was down.
   */
  async function followState(): Promise<void> {
    let since = 0
    while (!life.signal.aborted) {
      try {
        const answer = await ask<StateAnswer>(ENDPOINT_STATE, { since })
        since = answer.version
        const wasRunning = store.getSnapshot().nodeRunning
        patch({
          ready: true,
          nodeRunning: answer.nodeRunning,
          devices: answer.devices,
          inboxCount: answer.inboxCount,
          // A Host older than this bundle would not send it. Defaulting keeps
          // the panel drawing rather than throwing on a missing field.
          pairing: answer.pairing ?? IDLE_PAIRING,
          // A successful round means the channel is healthy; a stale transport
          // error would otherwise sit on screen until the next failure.
          error: null,
        })
        // A node started from a terminal must light the network section up
        // without the user closing and reopening the panel.
        if (answer.nodeRunning !== wasRunning) syncNetworkTimer()
      } catch (error) {
        if (life.signal.aborted) return
        patch({ error: reasonOf(error) })
        await delay(RETRY_DELAY_MS, life.signal)
      }
    }
  }

  async function readNetwork(): Promise<void> {
    try {
      patch({ network: await ask<NetworkAnswer>(ENDPOINT_NETWORK, {}) })
    } catch (error) {
      if (life.signal.aborted) return
      // Network detail failing does not invalidate what the state loop knows,
      // so this reports the error without clearing devices or node liveness.
      patch({ network: null, error: reasonOf(error) })
    }
  }

  /**
   * Start or stop the network timer to match what is on screen.
   *
   * The gate is `open && nodeRunning`, not just `open`. Every tick spawns a
   * `swarmdrop status` process, and while the node is stopped the section it
   * fills renders nothing at all — so an open panel over a stopped node would
   * otherwise spawn a process every three seconds, forever, for a value nobody
   * can see.
   *
   * The one-shot read on open is deliberately *not* gated: it is what fills
   * `peerId`, and one process is not a schedule.
   */
  function syncNetworkTimer(): void {
    const wanted = panelOpen && store.getSnapshot().nodeRunning
    if (wanted === (networkTimer !== undefined)) return
    if (!wanted) {
      clearInterval(networkTimer)
      networkTimer = undefined
      return
    }
    networkTimer = setInterval(() => { void readNetwork() }, NETWORK_INTERVAL_MS)
  }

  /**
   * Run one action and fold its outcome into the state.
   *
   * The Host answers a refusal *inside* a successful call ({@link
   * ActionAnswer}), because "no node is running" is a fact rather than a
   * transport failure. Both still end up in `error` here — the difference
   * matters to the wire, not to the person reading the panel.
   */
  async function act(
    busy: Exclude<PanelBusy, null>,
    endpoint: string,
    payload: unknown,
  ): Promise<void> {
    patch({ busy, actionError: null })
    try {
      const answer = await ask<ActionAnswer>(endpoint, payload)
      if (!answer.ok) {
        patch({ actionError: answer.message ?? 'the action was refused' })
        return
      }
      // Node liveness is the state loop's to report; asking for network detail
      // is not, and after a start or stop it is certainly stale.
      void readNetwork()
    } catch (error) {
      patch({ actionError: reasonOf(error) })
    } finally {
      patch({ busy: null })
    }
  }

  void followState()

  return {
    state: store,
    setOpen(open: boolean): void {
      panelOpen = open
      if (open) void readNetwork()
      syncNetworkTimer()
    },
    startNode: () => act('node.start', ENDPOINT_NODE_START, {}),
    stopNode: () => act('node.stop', ENDPOINT_NODE_STOP, {}),
    forget: (peerId: string) => act('device.forget', ENDPOINT_DEVICE_FORGET, { peerId }),
    // The pairing verbs return the moment the Host has noted them; what
    // actually happened arrives through the state loop, which is already parked.
    beginPair: () => act('pair', ENDPOINT_PAIR_BEGIN, {}),
    cancelPair: () => act('pair', ENDPOINT_PAIR_CANCEL, {}),
    respondPair: (pendingId: number, accept: boolean) =>
      act('pair', ENDPOINT_PAIR_RESPOND, { pendingId, accept }),
    dispose(): void {
      panelOpen = false
      syncNetworkTimer()
      life.abort()
    },
  }
}
