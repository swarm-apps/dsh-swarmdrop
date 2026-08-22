/**
 * The panel's Host half: one RPC channel the browser asks about this machine.
 *
 * ## Why `handle` and not `intercept`
 *
 * dsh's Connection service offers both. `intercept` claims endpoints on the
 * shared `/api` channel and **only one interceptor may exist** — it is already
 * taken by the Typert gateway. `handle` mounts a channel prefix of its own,
 * which is the seat meant for a plugin. Trying `intercept('/api', …)` would
 * throw at load with "already has an interceptor", taking the plugin down.
 *
 * ## `trusted-host`, not `loopback`
 *
 * The panel can start a node and unpair a device, so the temptation is to lock
 * it to localhost. That would be a *different* fence than the one guarding
 * everything else: dsh's own `/api` — through which the agent runs arbitrary
 * shell commands — is `trusted-host`. Someone reaching their dsh from another
 * machine already commands far more than this channel exposes, and a panel that
 * silently 403s in that deployment is a bug report, not a safety win.
 *
 * ## The channel is optional
 *
 * A headless or TUI profile has no `connection` service. The registration is
 * therefore behind `ctx.inject`, and its absence costs exactly the panel —
 * tools, the command and the conversation rows all still work.
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the Connection plugin's `ctx.connection` Context merge into
// this program. A value import would put a real edge on a package this plugin
// only needs when a web UI happens to be present.
import type {} from '@deepseek-ai/dsh-client-connection'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'

import { call, SwarmDropError } from './cli.js'
import { count, flag, list, optional, text } from './coerce.js'
import { CONSOLE_ROUTES } from './console.js'
import type { MachineState } from './machine.js'
import type { PairingSession } from './pairing.js'
import type { WatchSubscription } from './subscription.js'
import {
  ENDPOINT_DEVICE_FORGET, ENDPOINT_NETWORK, ENDPOINT_NODE_START, ENDPOINT_NODE_STOP,
  ENDPOINT_PAIR_BEGIN, ENDPOINT_PAIR_CANCEL, ENDPOINT_PAIR_RESPOND, ENDPOINT_STATE,
  ENDPOINT_TRANSFER_CONTROL, PANEL_CHANNEL,
  PANEL_INBOX_LIMIT, PANEL_TRANSFER_LIMIT,
  type ActionAnswer, type ForgetRequest, type NetworkAnswer, type PairRespondRequest,
  type PanelEndpoint, type StateAnswer, type StateRequest,
  type TransferControlAction, type TransferControlRequest,
} from './panel-wire.js'
import type { Revision } from './revision.js'

/**
 * How long a state long-poll may park before answering anyway.
 *
 * Nothing on the Host side needs this — the handler would happily wait forever,
 * and the request signal already aborts when the browser goes away. It exists
 * because *something between them* will not: proxies and load balancers kill
 * idle connections, typically at 30 or 60 seconds, and they do it by dropping
 * the socket rather than answering. Returning first, unchanged, keeps that from
 * ever looking like a fault.
 */
const POLL_CEILING_MS = 25_000

/** What `swarmdrop status --json` returns, as far as this panel reads it. */
interface StatusRow {
  readonly status?: unknown
  readonly peerId?: unknown
  readonly natStatus?: unknown
  readonly listenAddrs?: unknown
  readonly publicAddr?: unknown
  readonly relayReady?: unknown
  readonly bootstrapConnected?: unknown
  readonly connectedPeers?: unknown
}

/**
 * Run one CLI action and report it as an outcome rather than an exception.
 *
 * "No node is running" is a *fact about the machine*, not a transport failure —
 * see {@link ActionAnswer}. Anything that is not a `SwarmDropError` (the binary
 * is missing, the process was killed) is re-thrown so it reaches the transport
 * as a genuine fault instead of being disguised as a refusal.
 */
async function attempt(args: readonly string[]): Promise<ActionAnswer> {
  try {
    await call<unknown>(args)
    return { ok: true }
  } catch (error) {
    if (error instanceof SwarmDropError) return { ok: false, message: error.message }
    throw error
  }
}

/** Everything the panel's routes read or drive. */
export interface PanelSources {
  readonly machine: MachineState
  readonly pairing: PairingSession
  /** Whether the mirror the machine state holds is still being fed. */
  readonly subscription: WatchSubscription
  /** The shared change counter all of the above bump. */
  readonly revision: Revision
}

/** Mount the panel's channel, if this deployment has a browser to serve it to. */
export function registerPanel(ctx: Context, sources: PanelSources): void {
  ctx.inject(['connection'], connectionCtx => {
    // `rpc.handle` binds the registration to the Context that read the service,
    // so the channel is torn down with this fiber. The returned disposer is the
    // effect's own; calling it here as well would unregister twice.
    connectionCtx.connection.rpc.handle(
      PANEL_CHANNEL,
      (endpoint, payload, signal) => dispatch(sources, endpoint, payload, signal),
      { authority: 'trusted-host' },
    )
  })
}

/**
 * Route one call.
 *
 * A lookup table rather than a chain of comparisons: adding an endpoint to
 * `panel-wire.ts` without handling it here should be a compile error, and with
 * `satisfies Record<Endpoint, …>` it is. A chain would just return "unknown
 * endpoint" at runtime, in a deployment nobody is watching.
 */
async function dispatch(
  sources: PanelSources,
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
): Promise<RpcResult<unknown>> {
  const route = ROUTES[endpoint]
  if (route === undefined) {
    return {
      ok: false,
      error: {
        code: 'bad-request',
        message: `unknown swarmdrop endpoint ${JSON.stringify(endpoint)}`,
        details: { issues: [] },
      },
    }
  }
  try {
    // Every route answers with a value; the two error shapes are built here and
    // nowhere else. A refused *action* is not one of them — it travels inside
    // `ActionAnswer`, because "no node is running" is a fact, not a fault.
    return { ok: true, value: await route({ ...sources, payload, signal }) }
  } catch (error) {
    // The transport turns a thrown value into a bare 500 with no code, which
    // the browser cannot tell apart from the server being down. Folding it here
    // keeps the panel able to say what went wrong.
    return {
      ok: false,
      error: { code: 'internal', message: String(error), details: {} },
    }
  }
}

/** Everything a route needs, so the table's rows all have one shape. */
interface RouteArgs extends PanelSources {
  readonly payload: unknown
  readonly signal: AbortSignal
}

type Route = (args: RouteArgs) => Promise<unknown>

/**
 * The panel's own routes.
 *
 * `satisfies` is what makes adding a constant to `panel-wire.ts` without
 * handling it here a compile error, rather than an "unknown swarmdrop endpoint"
 * at runtime in a deployment nobody is watching.
 */
const PANEL_ROUTES = {
  [ENDPOINT_STATE]: state,
  [ENDPOINT_NETWORK]: network,
  [ENDPOINT_NODE_START]: () => attempt(['start', '-d']),
  [ENDPOINT_NODE_STOP]: () => attempt(['stop']),
  [ENDPOINT_DEVICE_FORGET]: ({ payload }) => forget(payload),
  // The three pairing verbs answer from memory: opening a window spawns a
  // process, but nothing here waits for it — the caller learns what happened
  // through the state long poll, which is already parked.
  [ENDPOINT_PAIR_BEGIN]: async ({ pairing }) => {
    pairing.begin()
    return { ok: true } satisfies ActionAnswer
  },
  [ENDPOINT_PAIR_CANCEL]: async ({ pairing }) => {
    pairing.cancel()
    return { ok: true } satisfies ActionAnswer
  },
  [ENDPOINT_PAIR_RESPOND]: async ({ pairing, payload }) => respond(pairing, payload),
  [ENDPOINT_TRANSFER_CONTROL]: ({ payload }) => steer(payload),
} satisfies Record<PanelEndpoint, Route>

/**
 * Everything this channel serves.
 *
 * The console's two routes ride here rather than on a channel of their own: a
 * second channel would be a second registration, a second authority decision
 * and a second teardown path, for two more routes reaching the same binary on
 * the same machine. A channel is a transport seat, not a namespace.
 */
const ROUTES: Record<string, Route | undefined> = {
  ...PANEL_ROUTES,
  ...CONSOLE_ROUTES,
}

/**
 * Long-poll everything the panel watches. Costs nothing while nothing changes.
 *
 * The two sources share one counter, so "wait for anything" is a single park
 * rather than a race — see `revision.ts` for why that is the right shape here.
 */
async function state(
  { machine, pairing, subscription, revision, payload, signal }: RouteArgs,
): Promise<StateAnswer> {
  const since = count((payload as StateRequest | null)?.since)

  // The ceiling and the caller's own cancellation are the same kind of event to
  // the wait, so they are merged into one signal rather than raced separately.
  const ceiling = new AbortController()
  const timer = setTimeout(() => { ceiling.abort() }, POLL_CEILING_MS)
  try {
    await revision.wait(since, AbortSignal.any([signal, ceiling.signal]))
  } finally {
    clearTimeout(timer)
  }

  // Read *after* the wait, and read both: the counter says something moved, not
  // which one, and the answer carries both anyway.
  const snapshot = machine.snapshot()
  return {
    subscription: subscription.health(),
    nodeRunning: snapshot.nodeRunning,
    devices: snapshot.devices,
    inboxCount: snapshot.inbox.length,
    // Sliced here rather than in the browser: the mirror holds a session
    // baseline's worth, and shipping all of it on every state answer would
    // grow the parked response for content the panel has no room to draw.
    inboxRecent: snapshot.inbox.slice(0, PANEL_INBOX_LIMIT),
    // Same slice, same reason. The mirror holds every unfinished transfer;
    // the panel draws the few that fit.
    transfers: snapshot.transfers.slice(0, PANEL_TRANSFER_LIMIT),
    pairing: pairing.snapshot(),
    version: revision.current(),
  }
}

/**
 * Run one control verb against one transfer.
 *
 * The verb is validated against a closed set here rather than trusted from the
 * payload: this route reaches a `spawn`, and "whatever the browser sent" is not
 * something to put on a command line.
 *
 * ⚠️ **A refused verb is a usage error (exit 2), not a payload.** The CLI filters
 * the candidate set by `Control::applies` and an id outside it never reaches the
 * result — so "pause one that is not active" comes back as a non-zero exit with
 * the CLI's own explanation. `attempt` turns that into `{ ok: false, message }`,
 * which is what the panel wants: the CLI's sentence rather than a transport
 * error. Nothing extra is needed here, and the buttons rarely hit it anyway —
 * `controlsOf` only offers verbs that phase allows.
 */
async function steer(payload: unknown): Promise<ActionAnswer> {
  const request = payload as TransferControlRequest | null
  const transferId = typeof request?.transferId === 'string' ? request.transferId : ''
  // Shape-checked for the same reason the action is: it reaches `spawn`. A value
  // starting with `-` is read by clap as a flag — `--help` would print help,
  // exit 0, and this route would report success for a transfer nothing happened
  // to. Session ids are UUIDs; anything else is not one.
  if (!UUID.test(transferId)) return { ok: false, message: 'not a transfer id' }
  const action = request?.action
  // ⚠️ **`includes` on a frozen list, not a lookup in an object literal.** An
  // object literal carries `Object.prototype`, so `CONTROL_VERBS['toString']`
  // is a function rather than `undefined` — `toString`, `constructor`,
  // `valueOf`, `hasOwnProperty` and `__proto__` all passed the old
  // `=== undefined` gate and reached `spawn`, which then threw a TypeError this
  // route does not catch. Not a command injection (`spawn` has no shell), but
  // this file's own claim is that nothing outside the set reaches the command
  // line, and it did not hold.
  if (!isControlAction(action)) return { ok: false, message: 'not a transfer control action' }
  return attempt(['transfer', action, transferId])
}

/** A session id, as the CLI hands them out and parses them back. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The three verbs. The CLI's subcommand is the action's own name. */
const CONTROL_ACTIONS: readonly TransferControlAction[] = ['pause', 'resume', 'cancel']

/** Whether this is one of the three, with no prototype to fall through to. */
function isControlAction(value: unknown): value is TransferControlAction {
  return typeof value === 'string'
    && (CONTROL_ACTIONS as readonly string[]).includes(value)
}

/**
 * Answer one inbound pairing request.
 *
 * The Host checks the id against what it is actually holding (see
 * `PairingSession.respond`), so a stale click cannot admit a device the user
 * never saw. This layer only decodes.
 */
function respond(pairing: PairingSession, payload: unknown): ActionAnswer {
  const request = payload as PairRespondRequest | null
  const pendingId = count(request?.pendingId)
  if (typeof request?.accept !== 'boolean') return { ok: false, message: 'no decision was given' }
  pairing.respond(pendingId, request.accept)
  return { ok: true }
}

/** Ask the CLI for the node's network posture. */
async function network(): Promise<NetworkAnswer> {
  const row = await call<StatusRow>(['status'])
  return {
    status: text(row.status),
    peerId: optional(row.peerId),
    natStatus: text(row.natStatus),
    listenAddrs: list(row.listenAddrs),
    publicAddr: optional(row.publicAddr),
    relayReady: flag(row.relayReady),
    bootstrapConnected: flag(row.bootstrapConnected),
    connectedPeers: count(row.connectedPeers),
  }
}

/** Unpair one device, addressed by its node identity. */
async function forget(payload: unknown): Promise<ActionAnswer> {
  const peerId = text((payload as ForgetRequest | null)?.peerId)
  // Guarded rather than forwarded: `swarmdrop device forget` with no target
  // opens an interactive picker, and there is no terminal here to answer it.
  if (peerId === '') return { ok: false, message: 'no device was named' }
  return attempt(['device', 'forget', peerId])
}
