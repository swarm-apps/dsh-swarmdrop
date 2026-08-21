/**
 * dsh-swarmdrop — the browser half.
 *
 * Everything here is a *contribution to dsh's own surfaces*: two conversation
 * rows and one `@` source. There is no bypass channel to the Node half, and
 * that is the design rather than a limitation — dsh gives third-party plugins
 * no Client→Node RPC by construction (event sourcing: UI state must rebuild
 * from the persisted log), so anything that reached around it would break the
 * moment the user refreshed, paged history, or opened the same session twice.
 *
 * The upside is that this half is carrier-agnostic. Someone reaching a dsh
 * running at home from their phone gets the same `@` menu, because the data
 * travels with the session rather than with localhost.
 */

// ⚠️ `ClientContext` rather than cordis's bare `Context`: the client-side
// service surface (`slots`, `sessions`, `conversationEvents`) reaches `Context`
// through this module's declaration merging. Importing the bare type compiles
// against the *Node* augmentation instead, and the mismatch shows up as
// "Property 'scope' does not exist on type 'SessionStore'" — a confusing error
// for what is really a wrong import.
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { InputTriggerService } from '@deepseek-ai/dsh-client-ui-input-trigger/client'

import { createInboxSource } from './inbox-source.js'
import {
  ReceivedRow, TransferRow, receivedDefinition, transferDefinition,
} from './nodes.js'

export const name = 'swarmdrop-client'
export const inject = ['conversationEvents', 'sessions', 'slots']

export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(transferDefinition)
  ctx.conversationEvents.register(receivedDefinition)

  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'swarmdrop-transfer' },
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
}
