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

/**
 * Steer one transfer: pause, resume or cancel.
 *
 * One endpoint with the verb in the payload rather than three: the Host does
 * the same thing for all three (parse an id, run one CLI verb, report the
 * outcome), and the verb is a closed three-value set — not a way to forward an
 * arbitrary command.
 */
export const ENDPOINT_TRANSFER_CONTROL = 'transfer.control'

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
  ENDPOINT_TRANSFER_CONTROL,
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

/**
 * One inbox entry, as the panel shows it.
 *
 * The panel carries a **few** of these, not the inbox: the whole list belongs to
 * the settings page, which has room for it. What the panel answers is "did
 * something arrive", and for that the newest few are the entire answer.
 */
export interface PanelInboxEntry {
  readonly itemId: string
  /** `files` or `text`. */
  readonly contentKind: string
  /** Device it came from — what the user will recognise. */
  readonly sourceName: string
  readonly itemCount: number
  readonly totalSize: number
  /** Unix milliseconds — what `new Date()` takes directly. */
  readonly receivedAt: number
}

/** How many inbox entries the panel carries. See {@link PanelInboxEntry}. */
export const PANEL_INBOX_LIMIT = 5

/**
 * One transfer in flight, as the panel shows it.
 *
 * The panel answers "is something moving right now, and how fast" — the full
 * list with history belongs to the settings page. So this carries the few
 * unfinished ones and nothing that has ended.
 */
export interface PanelTransfer {
  readonly sessionId: string
  /** `send` or `receive` — the panel draws it as an arrow. */
  readonly direction: string
  /** The other end, as the user will recognise it. */
  readonly peerName: string
  /** `offered` / `waiting_accept` / `active` / `suspended`. */
  readonly phase: string
  readonly transferredBytes: number
  readonly totalBytes: number
  readonly fileCount: number
  /** Whether an interrupted transfer can still be resumed. Half of `controlsOf`. */
  readonly recoverable: boolean
  /**
   * Bytes per second, or `null` when nothing can be said — a stall, a phase
   * with no bytes moving, or a CLI too old to report it.
   *
   * **Never `0`.** The Host normalises that away precisely so this side does not
   * have to remember that `0` means "cannot say" rather than "stopped"; drawing
   * "0 B/s" would report a stall that may not be happening.
   */
  readonly speed: number | null
  /** Seconds remaining, or `null` when the core cannot say. */
  readonly eta: number | null
}

/**
 * How many transfers the panel carries.
 *
 * Five, like the inbox: a machine with more than a handful in flight is not
 * something a side panel can usefully draw, and the settings page has the room.
 */
export const PANEL_TRANSFER_LIMIT = 5

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
  /**
   * Non-null when the machine subscription is down, in which case everything
   * else in this answer is the last thing it said rather than what is true now.
   *
   * Carried rather than left implicit because the two are indistinguishable
   * from the browser: a mirror that stopped updating answers exactly like a
   * machine where nothing is happening. The panel draws it as a band above the
   * facts it qualifies.
   */
  readonly subscription: string | null
  /** Whether a SwarmDrop node is running on the machine dsh runs on. */
  readonly nodeRunning: boolean
  readonly devices: readonly PanelDevice[]
  /** How many items the inbox holds, as far as the subscription has seen. */
  readonly inboxCount: number
  /**
   * The newest few, so the panel can expand the count in place.
   *
   * Carried on an answer that was being sent anyway rather than fetched: the
   * Host already holds them in the machine mirror, so this costs bytes rather
   * than a process. Expanding the row must not be the thing that spawns one —
   * that is exactly the polling the settings page is forbidden from doing.
   */
  readonly inboxRecent: readonly PanelInboxEntry[]
  /**
   * Transfers that have not finished, most recently touched first.
   *
   * Rides this answer for the same reason `inboxRecent` does — the Host already
   * holds them, so it costs bytes rather than a process. It is also the only
   * way the panel *can* show live progress: asking `transfer list` on a timer
   * is the polling this design is built to avoid, and the rate would be wrong
   * anyway (the CLI's own panel learnt that the hard way).
   */
  readonly transfers: readonly PanelTransfer[]
  /** The pairing desk. Rides the same answer because it shares the same clock. */
  readonly pairing: PairingSnapshot
  /** Feed straight back as the next request's `since`. */
  readonly version: number
}

/** What a caller may ask of a running transfer. */
export type TransferControlAction = 'pause' | 'resume' | 'cancel'

/** {@link ENDPOINT_TRANSFER_CONTROL} request. */
export interface TransferControlRequest {
  readonly transferId: string
  readonly action: TransferControlAction
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
