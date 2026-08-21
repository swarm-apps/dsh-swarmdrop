/**
 * dsh-swarmdrop — the Node half.
 *
 * Gives a DeepSeek Harness agent a channel to the user's own devices: it can
 * push what it produced straight to their phone, and reference what the phone
 * sent back. No account, no public IP, end-to-end encrypted — the transport is
 * [SwarmDrop](https://github.com/swarm-apps/SwarmDrop), driven through its CLI.
 *
 * ## Shape
 *
 * ```
 * cli.ts         the `swarmdrop` binary (one-shot calls, watch, pairing)
 * machine.ts     what this machine looks like, folded from the subscription
 * pairing.ts     the pairing desk: one window, and who is standing at it
 * revision.ts    the shared "something changed" counter the panel parks on
 * bridge.ts      machine-wide happenings  →  per-session events
 * panel.ts       the browser panel's RPC channel (status, devices, pairing)
 * panel-wire.ts  the panel's wire contract, compiled by both halves
 * tools.ts       what the model can call
 * command.ts     what the person can type
 * types.ts       the Session event family this plugin owns
 * client/        the browser half (panel, conversation nodes, `@` source)
 * ```
 *
 * The fragile half is deliberately the *small* half: everything that depends on
 * harness internals lives here and in `client/`, while pairing, transport and
 * the inbox live in SwarmDrop's own repo behind a versioned CLI contract.
 *
 * ## One subscription, two readers
 *
 * `swarmdrop watch` is spawned once, here, and every frame is handed to both
 * readers. Neither owns the process, because their lifetimes are the same and
 * their concerns are not: {@link MachineState} folds state, {@link
 * SwarmDropBridge} routes conversation-worthy happenings. Letting the bridge
 * own the subscription (as it once did) meant the panel had to either grow a
 * second one or reach through it.
 *
 * ## It does not require SwarmDrop to be running
 *
 * `swarmdrop watch` emits a baseline from local records and waits for a node to
 * appear, so this plugin loads cleanly on a machine where the user has not
 * started SwarmDrop — or has not installed it, in which case the tools report
 * that rather than the plugin failing to activate.
 */

import type { Context } from '@deepseek-ai/cordis'

import { SwarmDropBridge } from './bridge.js'
import { warmBinary } from './cli.js'
import { registerCommand } from './command.js'
import { MachineState } from './machine.js'
import { PairingSession } from './pairing.js'
import { registerPanel } from './panel.js'
import { inboxProjectionDefinition } from './projection.js'
import { Revision } from './revision.js'
import { WatchSubscription } from './subscription.js'
import { registerTools } from './tools.js'
import { announceEventTypes } from './types.js'

export const name = 'swarmdrop'
export const inject = ['agents', 'commands', 'tools']

export function apply(ctx: Context): void {
  // First, before anything can read a session log: dsh refuses a log carrying
  // event types it does not know, and this plugin's four are not in its
  // generated set. See `announceEventTypes` for the whole story.
  announceEventTypes()

  // One counter, two writers: the panel parks on it and is woken by whichever
  // of them moved. See `revision.ts` for why it is shared rather than per-source.
  const revision = new Revision()
  const machine = new MachineState(revision)
  const pairing = new PairingSession(ctx, revision)
  const bridge = new SwarmDropBridge(ctx, machine)

  // Fetch the platform binary before anything spawns, if pnpm skipped the
  // postinstall hook that normally does it. Not for speed — until it has been
  // fetched, every spawn goes through a Node shim, and SIGTERM then reaches the
  // shim rather than the process it started. A pairing window has to close when
  // the user says so; see `bundledBinary`.
  //
  // Nothing waits on it: the subscription tolerates being a shim (it only ends
  // when the whole process tree does), and the calls that must not are the ones
  // a person triggers later.
  void warmBinary()

  const subscription = new WatchSubscription({
    onFrame: frame => {
      // The one frame neither reader folds. It means the CLI dropped events
      // because this consumer read too slowly — the mirror may now be missing
      // inbox entries, with nothing that repairs it. Logged rather than
      // swallowed so a report of "an item never showed up" is diagnosable.
      if (frame.kind === 'truncated') {
        ctx.logger('swarmdrop').warn(
          'the subscription dropped %o event(s); the inbox list may be incomplete until a node restarts',
          frame['dropped'],
        )
      }
      machine.accept(frame)
      bridge.accept(frame)
    },
    // Health is a fact about this machine like any other, so it rides the same
    // counter and reaches the panel through the request already parked on it.
    onHealth: trouble => {
      if (trouble !== null) ctx.logger('swarmdrop').warn(trouble)
      revision.bump()
    },
  })
  ctx.effect(() => () => {
    subscription.dispose()
    // The pairing window is a live process and an open door: leaving it running
    // past the plugin's life would keep the node accepting inbound requests
    // with nothing left to show them to.
    pairing.dispose()
  })

  registerTools(ctx, bridge)
  registerCommand(ctx, bridge)

  // Optional capability: a deployment with no browser (headless, TUI) has no
  // `connection` service and simply has no panel. Everything else still works.
  registerPanel(ctx, { machine, pairing, revision, subscription })

  // "What you had at hand when this conversation began" is context a reader
  // needs three months later, so it is recorded as a first-class event rather
  // than fetched on demand.
  ctx.on('agent/session-start', ({ agent }) => { bridge.recordBaseline(agent) })

  // The `@` menu's candidate list is a *projection* of those events, not a
  // browser-side fold: the framework drives the fold over committed events in
  // log order and pushes the finished value, so refresh, history paging and
  // replay cannot disagree. Optional capability — a deployment without it
  // simply has no `@swarmdrop` source, and everything else still works.
  ctx.inject(['sessionProjections'], projectionCtx => {
    projectionCtx.effect(() => projectionCtx.sessionProjections.register(inboxProjectionDefinition))
  })
}

export type * from './types.js'
export type * from './panel-wire.js'
export type { DeviceState, MachineSnapshot } from './machine.js'
export type { PairingSession } from './pairing.js'
export type { InboxReference, SwarmDropInboxProjection } from './inbox-projection.js'
