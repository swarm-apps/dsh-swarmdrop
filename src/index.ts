/**
 * dsh-swarmdrop — the Node half.
 *
 * Gives a DeepSeek Harness agent a channel to the user's own devices: it can
 * push what it produced straight to their phone, and reference what the phone
 * sent back. No account, no public IP, end-to-end encrypted — the transport is
 * [SwarmDrop](https://github.com/yexiyue/SwarmDrop), driven through its CLI.
 *
 * ## Shape
 *
 * ```
 * cli.ts      the `swarmdrop` binary (one-shot calls + the watch subscription)
 * bridge.ts   machine-wide subscription  →  per-session events
 * tools.ts    what the model can call
 * command.ts  what the person can type
 * types.ts    the Session event family this plugin owns
 * client/     the browser half (conversation nodes, `@` source, device panel)
 * ```
 *
 * The fragile half is deliberately the *small* half: everything that depends on
 * harness internals lives here and in `client/`, while pairing, transport and
 * the inbox live in SwarmDrop's own repo behind a versioned CLI contract.
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
import { registerCommand } from './command.js'
import { inboxProjectionDefinition } from './projection.js'
import { registerTools } from './tools.js'

import './types.js'

export const name = 'swarmdrop'
export const inject = ['agents', 'commands', 'tools']

export function apply(ctx: Context): void {
  const bridge = new SwarmDropBridge(ctx)
  bridge.start()
  ctx.effect(() => () => { bridge.dispose() })

  registerTools(ctx, bridge)
  registerCommand(ctx, bridge)

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
export type { InboxReference, SwarmDropInboxProjection } from './inbox-projection.js'
