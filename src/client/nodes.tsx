/**
 * Conversation rows this plugin contributes.
 *
 * Two families, each with its own stable business identity — the assembler
 * locates a Context by `(kind, id)` and must never guess that an update belongs
 * to "the most recent unfinished one":
 *
 * | Family | id | start | update |
 * |---|---|---|---|
 * | `swarmdrop-transfer` | transfer id | `swarmdrop/sent` | `swarmdrop/transfer` |
 * | `swarmdrop-received` | inbox item id | `swarmdrop/inbox-received` | — |
 *
 * `swarmdrop/inbox-baseline` deliberately grows **no row**: "here is what you
 * had at hand" is context for a reader, not an event anyone wants rendered into
 * their transcript. It feeds the `@` menu through the projection instead.
 *
 * ## Both start events carry enough to render alone
 *
 * History pages backwards, so a window can hold the terminal update without its
 * start. The guide's answer is that terminal events must carry a complete
 * fallback — which is why `swarmdrop/transfer` ships the whole display state
 * rather than a delta, and why an update that arrives without its start leaves
 * the Context pending rather than inventing one.
 */

import { createElement } from 'react'
import type {
  ConversationLocation, ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeKind, ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * A keyed chat renderer's props, minus the locale.
 *
 * ⚠️ **`ChatNodeViewProps` itself does not compile for a third-party plugin**,
 * and the conversation-node cookbook's own snippet has the same problem: that
 * type bundles `t: TranslateNS<'conversation'>`, but the slot only injects `t`
 * when the registration passes `locale`, and the value first-party code passes
 * (`NS` from ui-conversation's `locales.ts`) is not exported. A plugin bringing
 * its own namespace would get `TranslateNS<'its-own'>`, which is a different
 * type again.
 *
 * Omitting `t` is the honest resolution rather than a cast: these rows render
 * device names and byte counts, so there is nothing here to translate. If that
 * changes, the answer is this plugin's own locale namespace — not borrowing
 * `conversation`'s.
 */
type NodeProps<K extends ChatNodeKind> = Omit<ChatNodeViewProps<K>, 't'>

/** What the transfer row shows. */
export interface TransferChatData {
  readonly peerName: string
  readonly fileCount: number
  readonly totalBytes: number
  readonly transferredBytes: number
  readonly phase: string
  readonly terminalReason?: string
}

/** What the "your phone sent this" row shows. */
export interface ReceivedChatData {
  readonly sourceName: string
  readonly itemCount: number
  readonly totalSize: number
  readonly contentKind: string
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    'swarmdrop-transfer': TransferChatData
    'swarmdrop-received': ReceivedChatData
  }
}

interface TransferState extends TransferChatData {}
interface ReceivedState extends ReceivedChatData {}

function locationOf(context: ConversationNodeContext<unknown>): ConversationLocation {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

/** Human-readable byte count. Pure — these run during replay too. */
function size(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  const units = ['KiB', 'MiB', 'GiB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${value.toFixed(1)} ${String(units[unit])}`
}

export const transferDefinition: ConversationNodeDefinition<TransferState> = {
  kind: 'swarmdrop-transfer',
  target: 'chat',
  match: (event) => {
    if (event.type === 'swarmdrop/sent') {
      return { id: event.data.transferId, role: 'start' }
    }
    if (event.type === 'swarmdrop/transfer') {
      return { id: event.data.transferId, role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'swarmdrop/sent') {
      throw new Error('swarmdrop-transfer requires swarmdrop/sent')
    }
    const data = match.event.data
    return {
      peerName: data.peerName,
      fileCount: data.fileCount,
      totalBytes: data.totalBytes,
      transferredBytes: 0,
      phase: 'offered',
    }
  },
  update: (context, match) => {
    if (match.event.type !== 'swarmdrop/transfer') return context.state
    const data = match.event.data
    return {
      ...context.state,
      phase: data.phase,
      transferredBytes: data.transferredBytes,
      // A transfer that has not ended has no reason, and carrying a stale one
      // would render "cancelled" onto a resumed transfer.
      ...data.terminalReason === undefined ? {} : { terminalReason: data.terminalReason },
    }
  },
  // Progress moves often and means nothing between frames; the phase change and
  // the terminal state are what a reader is actually waiting for.
  publication: match => match.event.type === 'swarmdrop/transfer'
    ? 'animation-frame'
    : 'immediate',
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'swarmdrop-transfer',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
      location: locationOf(context),
      visibility: 'visible',
      data: context.state,
    }
  },
}

export const receivedDefinition: ConversationNodeDefinition<ReceivedState> = {
  kind: 'swarmdrop-received',
  target: 'chat',
  match: (event) => event.type === 'swarmdrop/inbox-received'
    ? { id: event.data.item.itemId, role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'swarmdrop/inbox-received') {
      throw new Error('swarmdrop-received requires swarmdrop/inbox-received')
    }
    const item = match.event.data.item
    return {
      sourceName: item.sourceName,
      itemCount: item.itemCount,
      totalSize: item.totalSize,
      contentKind: item.contentKind,
    }
  },
  // Single-event family: there is nothing to update, and inventing an update
  // path would be a place for a future event to land silently.
  update: context => context.state,
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'swarmdrop-received',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start?.event.seq ?? 0,
      location: locationOf(context),
      visibility: 'visible',
      data: context.state,
    }
  },
}

/** One transfer, as a line in the conversation. */
export function TransferRow({ node }: NodeProps<'swarmdrop-transfer'>) {
  const { peerName, fileCount, totalBytes, transferredBytes, phase, terminalReason } = node.data
  const detail = phase === 'terminal'
    ? terminalReason === 'completed'
      ? `sent ${String(fileCount)} file(s) · ${size(totalBytes)}`
      : `${terminalReason ?? 'ended'} · ${size(transferredBytes)} of ${size(totalBytes)}`
    : `${size(transferredBytes)} of ${size(totalBytes)}`
  return createElement('p', { className: 'swarmdrop-row' }, `→ ${peerName} · ${detail}`)
}

/** One arrival from a paired device. */
export function ReceivedRow({ node }: NodeProps<'swarmdrop-received'>) {
  const { sourceName, itemCount, totalSize, contentKind } = node.data
  const what = contentKind === 'text' ? 'a message' : `${String(itemCount)} file(s) · ${size(totalSize)}`
  return createElement('p', { className: 'swarmdrop-row' }, `← ${sourceName} sent ${what}`)
}
