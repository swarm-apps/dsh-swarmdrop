/**
 * dsh-swarmdrop — the browser half.
 *
 * Everything here is a *contribution to dsh's own surfaces*: a panel at the
 * sidebar foot, two conversation rows, and one `@` source.
 *
 * ## Two kinds of data, two carriers
 *
 * This file used to state that dsh gives third-party plugins no Client→Node
 * RPC. That was **wrong** — `ctx.connection.rpc` mounts a channel of this
 * plugin's own, and `panel-wire.ts` explains the shape. What the old sentence
 * was reaching for is still true and still load-bearing, so it is worth saying
 * precisely:
 *
 * | Data | Carrier | Why |
 * |---|---|---|
 * | conversation rows, `@` candidates | the session log | they must rebuild identically after a refresh, a history page, or a replay three months later |
 * | node liveness, devices, network | the RPC channel | they are facts about *now*; putting them in a replayable log would make the log lie |
 *
 * A side channel feeding the transcript would break the moment the user
 * refreshed. A session event carrying "the node is up" would be a claim about a
 * moment, persisted forever, and read back as though it were still true.
 *
 * The transcript half stays carrier-agnostic either way: someone reaching a dsh
 * running at home from their phone gets the same `@` menu, because that data
 * travels with the session. The panel reaches the same Host over the same
 * origin, so it works there too.
 */

// ⚠️ `ClientContext` rather than cordis's bare `Context`: the client-side
// service surface (`slots`, `sessions`, `conversationEvents`) reaches `Context`
// through this module's declaration merging. Importing the bare type compiles
// against the *Node* augmentation instead, and the mismatch shows up as
// "Property 'scope' does not exist on type 'SessionStore'" — a confusing error
// for what is really a wrong import.
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (`ctx.locale`).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { InputTriggerService } from '@deepseek-ai/dsh-client-ui-input-trigger/client'

import { SwarmDropConsole, type SwarmDropConsoleFace } from './console.js'
import { createLiveTransfers } from './live-transfers.js'
import { createConsolePort } from './console-port.js'
import { createInboxSource } from './inbox-source.js'
import { en, NS, zh } from './locales.js'
import {
  ReceivedRow, TransferRow, receivedDefinition, transferDefinition,
} from './nodes.js'
import { SwarmDropPanel, type SwarmDropPanelFace } from './panel.js'
import { createPanelPort } from './panel-port.js'

export const name = 'swarmdrop-client'
export const inject = ['conversationEvents', 'sessions', 'slots']

export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(transferDefinition)
  ctx.conversationEvents.register(receivedDefinition)

  // The transfer row wants two things the session log cannot give it — how far
  // a running transfer has got, and a way to pause it — but the row itself is
  // registered unconditionally, because everything else it draws comes from the
  // log. This holder bridges that: a stable face now, a live channel later if
  // one appears. See `live-transfers.ts`.
  const live = createLiveTransfers()

  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    {
      name: 'conversation.chat.node',
      key: 'swarmdrop-transfer',
      // The factory takes the session id (this slot is session-scoped) and
      // ignores it: transfers belong to the machine, not to a conversation, and
      // the row is identified by transfer id.
      inject: () => live.face,
    },
    TransferRow,
  ))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'swarmdrop-received' },
    ReceivedRow,
  ))

  // The `@` source is optional: a deployment without the input-trigger service
  // still gets the conversation rows. Failing to activate over a missing
  // optional service would take the whole plugin down with it.
  ctx.inject(['inputTriggers'], triggerCtx => {
    const inputTriggers = triggerCtx.get('inputTriggers') as InputTriggerService
    triggerCtx.effect(
      () => inputTriggers.registerSource(createInboxSource(triggerCtx)),
      'swarmdrop: @ inbox source',
    )
  })

  // The panel is optional for the same reason and one more: `connection` is
  // what carries its channel, and a deployment serving this bundle without it
  // is not one this plugin should refuse to load into.
  ctx.inject(['connection', 'locale'], panelCtx => {
    panelCtx.effect(() => panelCtx.locale.register(NS, { zh, en }), 'swarmdrop: panel dictionaries')
    // The nav label is registrant-owned copy: the settings shell keeps none of
    // its own, and re-registers on locale change through the ledger bump.
    const t = panelCtx.locale.bind(NS)

    const port = createPanelPort(panelCtx)
    panelCtx.effect(() => () => { port.dispose() }, 'swarmdrop: panel port')
    // Now the conversation rows can show live progress and offer controls. The
    // detach runs with this fiber, so a deployment that tears the channel down
    // leaves the rows rendering from the log rather than from a dead port.
    panelCtx.effect(() => live.attach(port), 'swarmdrop: live transfers')

    // The settings page shares this port for the live half — node liveness and
    // the device table are already arriving on the panel's subscription, and
    // fetching them a second time would spawn a process to learn what the
    // browser already knows.
    const consolePort = createConsolePort(panelCtx)
    panelCtx.effect(() => () => { consolePort.dispose() }, 'swarmdrop: console port')

    panelCtx.slots.inject('settings.section', () => panelCtx.slots.register({
      name: 'settings.section',
      id: 'swarmdrop',
      // After dsh's own entries (General is 0, Plugins is 15): this is a
      // feature page, and pushing it above the shell's own would be a plugin
      // claiming the top of a nav it does not own.
      order: 40,
      label: () => t('name'),
      locale: NS,
      inject: (): SwarmDropConsoleFace => ({
        hooks: { panel: port.state, console: consolePort.state },
        onOpenSection: section => { consolePort.load(section) },
        onRefresh: section => { consolePort.refresh(section) },
        onAct: action => { consolePort.act(action) },
        onDismiss: () => { consolePort.dismiss() },
        onStartNode: () => { void port.startNode() },
        onStopNode: () => { void port.stopNode() },
        onForget: (peerId: string) => { void port.forget(peerId) },
        // Pairing from Settings drives the *same* desk as the sidebar panel:
        // one `port`, and `PairingSession` is a machine-level singleton, so
        // two open desks — two processes racing one inbound request — is not
        // something this can produce.
        //
        // Answering a request is deliberately absent. That dialog belongs to
        // the panel alone (it is always mounted); a second copy here would put
        // two masks over one decision.
        onBeginPair: () => { void port.beginPair() },
        onCancelPair: () => { void port.cancelPair() },
        onQr: (invite: string, size: number) => port.qr(invite, size),
      }),
    }, SwarmDropConsole))

    panelCtx.slots.inject('sidebar.footer.action', () => panelCtx.slots.register({
      name: 'sidebar.footer.action',
      id: 'swarmdrop-panel',
      locale: NS,
      // The component never sees ctx (dsh's hard rule): everything it can read
      // or do arrives through this face.
      inject: (): SwarmDropPanelFace => ({
        hooks: { panel: port.state },
        onOpenChange: (open: boolean) => { port.setOpen(open) },
        onStartNode: () => { void port.startNode() },
        onStopNode: () => { void port.stopNode() },
        onForget: (peerId: string) => { void port.forget(peerId) },
        onBeginPair: () => { void port.beginPair() },
        onCancelPair: () => { void port.cancelPair() },
        onRespondPair: (pendingId: number, accept: boolean) => {
          void port.respondPair(pendingId, accept)
        },
        onQr: (invite: string, size: number) => port.qr(invite, size),
      }),
    }, SwarmDropPanel))
  })
}

export type { PanelState, PanelPort } from './panel-port.js'
export type { SwarmDropPanelFace, SwarmDropPanelProps } from './panel.js'
export type { ConsoleState, ConsolePort } from './console-port.js'
export type { SwarmDropConsoleFace, SwarmDropConsoleProps } from './console.js'
export type { SwarmDropKey } from './locales.js'
