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

import { createElement, type CSSProperties } from 'react'
import type {
  ConversationLocation, ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeKind, ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { formatDuration, formatSize } from './format.js'
import type { LiveSnapshot, LiveTransfer, LiveTransfersFace } from './live-transfers.js'
import type { TransferControlAction } from '../panel-wire.js'
import { controlsOf } from '../console-wire.js'

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

/**
 * The transfer row's props: the log's node, plus the live face.
 *
 * `useLive` is what the slot machinery makes of the face's `hooks.live`
 * observable — a selector hook, exactly like the panel's `usePanel`.
 */
type TransferRowProps = NodeProps<'swarmdrop-transfer'> & {
  useLive: <T>(select: (snapshot: LiveSnapshot) => T) => T
  onControl: LiveTransfersFace['onControl']
}

/** A count and its noun, without the "1 files" that gives away a machine. */
function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`
}

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

/**
 * One transfer, as a row in the conversation.
 *
 * ## Two sources, and which one wins
 *
 * The log says who and how it ended; the live channel says how far and how
 * fast. **The live entry wins while it exists** — it is the same transfer, seen
 * a moment later — and when it is gone the log's account is the whole answer.
 * That is not a fallback for an error case: it is what every finished transfer
 * looks like, and what every row looks like when the transcript is read back
 * three months from now.
 *
 * ## Controls appear only when they would work
 *
 * A button is offered when the live phase says the CLI will accept it — pause
 * while bytes move, resume while paused, cancel until it is over. Offering all
 * three always and letting the CLI refuse would teach the user that these
 * buttons sometimes do nothing.
 */
export function TransferRow({ node, useLive, onControl }: TransferRowProps) {
  const { peerName, fileCount, totalBytes, transferredBytes, phase, terminalReason } = node.data
  const live = useLive(snapshot => snapshot[node.id])

  const shown = live ?? {
    phase, transferredBytes, totalBytes, speed: null, eta: null, recoverable: false, busy: false,
  }
  // ⚠️ **The log decides that it ended, and the log alone.** `machine.ts` drops a
  // session from the live table the moment it reaches `terminal`, so the live
  // phase is *never* `terminal` — reading `done` off it would mean a row that
  // has a live entry can never show its own ending. The two paths also have
  // different latencies (a local append versus a long-poll answer), so for a
  // window after the log records the outcome the row would still be drawing a
  // progress bar over a transfer that is over.
  const done = phase === 'terminal' || shown.phase === 'terminal'
  // Totals from the same source as the phase, for the same reason: the log's
  // total comes from `swarmdrop/sent`, the wire's from `TransferProjection`, and
  // mixing them makes the number jump when the channel attaches.
  const total = done ? totalBytes : shown.totalBytes
  const percent = total > 0
    ? Math.min(100, Math.floor((shown.transferredBytes / total) * 100))
    : 0

  const detail = done
    ? terminalReason === 'completed'
      ? `sent ${plural(fileCount, 'file')} · ${formatSize(totalBytes)}`
      : `${terminalReason ?? 'ended'} · ${formatSize(shown.transferredBytes)} of ${formatSize(total)}`
    : [
        `${formatSize(shown.transferredBytes)} of ${formatSize(total)}`,
        shown.speed === null ? null : `${formatSize(shown.speed)}/s`,
        shown.eta === null ? null : `${formatDuration(shown.eta)} left`,
      ].filter(part => part !== null).join(' · ')

  return (
    <div className="swarmdrop-row" style={rowStyle}>
      <div style={headStyle}>
        <span>→ {peerName} · {detail}</span>
        {live !== undefined && !done && <Controls live={live} id={node.id} onControl={onControl} />}
      </div>
      {/* The bar is for the live half only: a finished transfer's bar is either
          a full one nobody needs or, worse, a partial one implying it is still
          going. The sentence above already says how it ended. */}
      {!done && (
        <div style={trackStyle}>
          <div style={{ ...fillStyle, width: `${String(percent)}%` }} />
        </div>
      )}
    </div>
  )
}

/** English labels; a conversation row has no locale (see {@link NodeProps}). */
const CONTROL_LABEL: Readonly<Record<TransferControlAction, string>> = {
  pause: 'Pause',
  resume: 'Resume',
  cancel: 'Cancel',
}

/** The buttons for one live transfer. */
function Controls({ live, id, onControl }: {
  live: LiveTransfer
  id: string
  onControl: (transferId: string, action: TransferControlAction) => void
}) {
  // ⚠️ **The rule is `controlsOf`, not a table written here.** This row had its
  // own copy for one commit and got two of the three phases wrong — it offered
  // Cancel on a suspended transfer (the CLI refuses: there is no live actor)
  // and Resume without checking the checkpoint survived. The settings page has
  // read the shared rule all along; so does this row now.
  const offered = controlsOf({ phase: live.phase, recoverable: live.recoverable })
  if (offered.length === 0) return null
  return (
    <span style={controlsStyle}>
      {offered.map(action => (
        <button
          key={action}
          type="button"
          // Disabled while one of this row's controls is in flight — not while
          // any is: two transfers running is normal, and one busy row must not
          // grey out the other's buttons (see `transferKey`).
          disabled={live.busy}
          aria-busy={live.busy}
          onClick={() => { onControl(id, action) }}
          // A `disabled` button that looks identical to an enabled one teaches
          // the user to click it again.
          style={live.busy ? { ...buttonStyle, opacity: 0.5, cursor: 'default' } : buttonStyle}
        >
          {CONTROL_LABEL[action]}
        </button>
      ))}
    </span>
  )
}

/** Inline styles, for the reason `panel.tsx` gives at length: this bundle ships
 * no stylesheet, and dsh's own custom properties carry the theme. */
const rowStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 }

const headStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
}

const controlsStyle: CSSProperties = { display: 'flex', gap: 4, flexShrink: 0 }

const buttonStyle: CSSProperties = {
  font: 'inherit',
  fontSize: 11,
  padding: '2px 8px',
  borderRadius: 4,
  border: '1px solid var(--dsw-alias-border-secondary)',
  background: 'transparent',
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
}

const trackStyle: CSSProperties = {
  height: 3,
  borderRadius: 2,
  background: 'var(--dsw-alias-fill-tertiary)',
  overflow: 'hidden',
}

const fillStyle: CSSProperties = {
  height: '100%',
  background: 'var(--dsw-alias-fill-brand)',
  transition: 'width 200ms linear',
}

/** One arrival from a paired device. */
export function ReceivedRow({ node }: NodeProps<'swarmdrop-received'>) {
  const { sourceName, itemCount, totalSize, contentKind } = node.data
  const what = contentKind === 'text' ? 'a message' : `${String(itemCount)} file(s) · ${formatSize(totalSize)}`
  return createElement('p', { className: 'swarmdrop-row' }, `← ${sourceName} sent ${what}`)
}
