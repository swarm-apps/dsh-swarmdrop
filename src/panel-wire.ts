/**
 * The panel's wire contract — the one file both halves compile.
 *
 * ## Why the panel needs a channel of its own
 *
 * `src/client/index.ts` used to state that dsh gives third-party plugins no
 * Client→Node RPC. That is **wrong**, and the correction matters: dsh's
 * Connection service exposes `ctx.connection.rpc.handle(channel, …)` on the Host
 * and `rpc.call(channel, …)` in the browser, and a channel prefix outside
 * `/api` is exactly what a third-party plugin is meant to mount there.
 *
 * The old sentence *was* right about session data: the conversation transcript
 * must rebuild from the persisted log, so a side channel that fed it would
 * break on refresh. Nothing here touches the transcript. What travels on this
 * channel is machine state — "is a node running", "is that phone online" —
 * which is not a conversation fact, has no place in a replayable log, and is
 * *supposed* to be re-fetched after a refresh.
 *
 * ## Two endpoints, two different clocks
 *
 * | Endpoint | Shape | Because |
 * |---|---|---|
 * | {@link ENDPOINT_STATE} | long poll | devices and node liveness arrive as *events* on the CLI subscription, so the browser can be told the moment they change |
 * | {@link ENDPOINT_NETWORK} | plain request | NAT class, listen addresses and relay readiness are *state*: nothing announces them, so someone has to ask |
 *
 * Collapsing them into one would force the worse half onto both — either the
 * panel polls for device changes it could have been told about, or every device
 * change spawns a `swarmdrop status` process nobody asked for.
 *
 * ## Every payload is plain JSON
 *
 * dsh validates the transport envelope and hands the handler `unknown`; the
 * payload itself is this plugin's business. Both halves are versioned together
 * inside one npm package, so there is no skew to negotiate — but the values
 * still have to survive `JSON.stringify`, which is why nothing here is a class,
 * a `Date`, or a `Map`.
 */

/** The logical channel this plugin mounts. Must not be `/api`, which is reserved. */
export const PANEL_CHANNEL = '/swarmdrop'

/** Long poll: what this machine looks like, once it differs from `since`. */
export const ENDPOINT_STATE = 'state'

/** Plain request: the node's network posture, which nothing announces. */
export const ENDPOINT_NETWORK = 'network'

/** Start a node in the background. */
export const ENDPOINT_NODE_START = 'node.start'

/** Stop the running node. */
export const ENDPOINT_NODE_STOP = 'node.stop'

/** Drop this machine's record of a paired device. */
export const ENDPOINT_DEVICE_FORGET = 'device.forget'

/** Open a pairing window: issue an invite and staff the desk. */
export const ENDPOINT_PAIR_BEGIN = 'pair.begin'

/** Close the pairing window. The node goes back to refusing inbound requests. */
export const ENDPOINT_PAIR_CANCEL = 'pair.cancel'

/** Answer the inbound request the user is looking at. */
export const ENDPOINT_PAIR_RESPOND = 'pair.respond'

/**
 * Every endpoint this channel serves.
 *
 * The Host's route table is `satisfies Record<PanelEndpoint, Route>`, so adding
 * a constant above without handling it there is a compile error rather than a
 * runtime "unknown swarmdrop endpoint" in a deployment nobody is watching.
 */
export const PANEL_ENDPOINTS = [
  ENDPOINT_STATE,
  ENDPOINT_NETWORK,
  ENDPOINT_NODE_START,
  ENDPOINT_NODE_STOP,
  ENDPOINT_DEVICE_FORGET,
  ENDPOINT_PAIR_BEGIN,
  ENDPOINT_PAIR_CANCEL,
  ENDPOINT_PAIR_RESPOND,
] as const

/** One of {@link PANEL_ENDPOINTS}. */
export type PanelEndpoint = typeof PANEL_ENDPOINTS[number]

/** The pairing desk before anything has been said about it. */
export const IDLE_PAIRING: PairingSnapshot = {
  phase: 'idle',
  invite: null,
  inviteId: null,
  request: null,
  pairedDevice: null,
  error: null,
}

/** One paired device, as the panel shows it. */
export interface PanelDevice {
  readonly peerId: string
  readonly name: string
  /** `null` is **unknown** — no node has been running to probe with. */
  readonly online: boolean | null
}

/** {@link ENDPOINT_STATE} request. */
export interface StateRequest {
  /**
   * The version the caller already has; `0` asks for the current value at once.
   *
   * The Host answers immediately when it has something newer, and otherwise
   * parks until it does. So a caller that loops `since = answer.version` gets a
   * push, and a caller that always sends `0` gets a poll — without the Host
   * needing to know which one it is talking to.
   */
  readonly since: number
}

/** Where the pairing flow is. */
export type PairingPhase =
  /** No window open. */
  | 'idle'
  /** An invite exists and the desk is staffed; nobody has shown up yet. */
  | 'waiting'
  /** Someone is at the desk and the user has to decide. */
  | 'deciding'
  /** A device was paired. Terminal — the CLI exits after a success. */
  | 'paired'

/** One inbound pairing request, as the panel shows it. */
export interface PairingRequestView {
  readonly pendingId: number
  /**
   * Full node identity, **never truncated**.
   *
   * The display name is whatever the far side chose to call itself and can be
   * copied exactly; the node id is a hash of its public key and is what the
   * transport actually authenticates. Reading the first characters back to the
   * person holding the other device is the only defence against someone who
   * grabbed the invite link first — so the panel shows all of it.
   */
  readonly peerId: string
  readonly device: string
  readonly os: string
  readonly arch: string
  /** `lan` | `relay` | `direct`, as the CLI classifies the link. */
  readonly connection: string
}

/** What the panel draws for pairing. */
export interface PairingSnapshot {
  readonly phase: PairingPhase
  /** The canonical invite link. Opening it in a browser shows a QR code. */
  readonly invite: string | null
  /** Identity of the invite, for `swarmdrop invite revoke`. */
  readonly inviteId: string | null
  /** Present only in the `deciding` phase. */
  readonly request: PairingRequestView | null
  /** Name of the device that just paired, in the `paired` phase. */
  readonly pairedDevice: string | null
  /** The CLI's own words when the window could not open, or closed badly. */
  readonly error: string | null
}

/** {@link ENDPOINT_STATE} answer. */
export interface StateAnswer {
  /** Whether a SwarmDrop node is running on the machine dsh runs on. */
  readonly nodeRunning: boolean
  readonly devices: readonly PanelDevice[]
  /** How many items the inbox holds, as far as the subscription has seen. */
  readonly inboxCount: number
  /** The pairing desk. Rides the same answer because it shares the same clock. */
  readonly pairing: PairingSnapshot
  /** Feed straight back as the next request's `since`. */
  readonly version: number
}

/** {@link ENDPOINT_PAIR_RESPOND} request. */
export interface PairRespondRequest {
  /**
   * Which request is being answered.
   *
   * Carried rather than implied, and checked against what the Host is actually
   * holding: a click that raced an expiry would otherwise answer a *different*
   * request that arrived in between — admitting a device the user never saw.
   */
  readonly pendingId: number
  readonly accept: boolean
}

/**
 * {@link ENDPOINT_NETWORK} answer — a projection of `swarmdrop status`.
 *
 * **Projected, not forwarded.** The CLI's status object carries two dozen
 * fields, most of which exist for its own terminal output. Forwarding it would
 * make every one of them part of this panel's contract, so the panel names the
 * seven it actually draws and lets the rest change freely.
 */
export interface NetworkAnswer {
  /** `running` | `stopped` | `starting`, as the CLI reports it. */
  readonly status: string
  /** This machine's node identity, once it has one. */
  readonly peerId: string | null
  /** `unknown` | `public` | `private`, as the CLI reports it. */
  readonly natStatus: string
  /** Addresses this node listens on. Empty while stopped. */
  readonly listenAddrs: readonly string[]
  /** The address other devices can reach directly, if any. */
  readonly publicAddr: string | null
  /** Whether a relay reservation is held — the cross-network fallback path. */
  readonly relayReady: boolean
  /** Whether at least one bootstrap node is connected. */
  readonly bootstrapConnected: boolean
  /** How many peers are connected right now. */
  readonly connectedPeers: number
}

/** {@link ENDPOINT_DEVICE_FORGET} request. */
export interface ForgetRequest {
  /**
   * Full node identity, never the display name.
   *
   * Two devices may share a name; unpairing the wrong one is not something the
   * user can undo without physical access to the other device.
   */
  readonly peerId: string
}

/**
 * What every action endpoint answers.
 *
 * A refused action is **not** an RPC error: "no node is running" is a fact
 * about the machine, and making the caller distinguish it from a transport
 * failure would put a `try`/`catch` around a normal outcome. Transport errors
 * stay for transport problems.
 */
export interface ActionAnswer {
  readonly ok: boolean
  /** The CLI's own words when it refused. Present only when `ok` is false. */
  readonly message?: string
}
