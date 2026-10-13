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

import type { CSSProperties } from 'react'
import type {
  ConversationLocation, ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNodeKind, ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { formatDuration, formatSize } from './format.js'
import type { LiveSnapshot, LiveTransfer, LiveTransfersFace } from './live-transfers.js'
import type { TransferControlAction } from '../panel-wire.js'
import { controlsOf } from '../console-wire.js'
import type { SwarmDropKey } from './locales.js'

/**
 * A keyed chat renderer's props, with this plugin's own translator.
 *
 * ⚠️ **`ChatNodeViewProps` itself does not compile for a third-party plugin.**
 * That type bundles `t: TranslateNS<'conversation'>`, and the value first-party
 * code passes for it (`NS` from ui-conversation's `locales.ts`) is not
 * exported. So the bundled `t` is dropped and replaced with the one this
 * plugin's own namespace produces — which is what the registration passes
 * (`locale: NS` in `index.ts`), so the substitution matches what actually
 * arrives at runtime rather than papering over it with a cast.
 *
 * This used to omit `t` entirely, on the grounds that these rows render only
 * device names and byte counts. They no longer do: a direction, a file count,
 * an outcome and three control verbs are all copy, and they were all hardcoded
 * English.
 */
type NodeProps<K extends ChatNodeKind> = Omit<ChatNodeViewProps<K>, 't'> & {
  t: PropsLocale<'swarmdrop'>['t']
}

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

/** Outcome word for a finished transfer. The CLI's values are not read by people. */
const REASON_KEY: Readonly<Record<string, SwarmDropKey>> = {
  completed: 'reasonCompleted',
  cancelled: 'reasonCancelled',
  rejected: 'reasonRejected',
  expired: 'reasonExpired',
}

/** What the transfer row shows. */
export interface TransferChatData {
  /**
   * `send` | `receive`.
   *
   * Derived from which event opened the row, never carried on the update:
   * a transfer does not change direction, and a replayed log from before this
   * field existed opens through `swarmdrop/sent`, which can only mean `send`.
   */
  readonly direction: string
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

// 0.2.x moved the ChatNodeDataMap merge point from ui-conversation to the
// dedicated chat package; augmenting the old module would register the kinds
// against a table nothing reads.
declare module '@deepseek-ai/dsh-client-ui-chat/client' {
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
    // Two start events, one family: a send and an arrival are the same object
    // moving in opposite directions, and giving them separate node kinds would
    // mean two renderers to keep in step for one progress bar.
    if (event.type === 'swarmdrop/sent' || event.type === 'swarmdrop/receiving') {
      return { id: event.data.transferId, role: 'start' }
    }
    if (event.type === 'swarmdrop/transfer') {
      return { id: event.data.transferId, role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    const { event } = match
    if (event.type !== 'swarmdrop/sent' && event.type !== 'swarmdrop/receiving') {
      throw new Error('swarmdrop-transfer requires swarmdrop/sent or swarmdrop/receiving')
    }
    const data = event.data
    return {
      direction: event.type === 'swarmdrop/sent' ? 'send' : 'receive',
      peerName: data.peerName,
      fileCount: data.fileCount,
      totalBytes: data.totalBytes,
      transferredBytes: 0,
      // An arrival is already moving when this machine hears about it; a send
      // has been offered and not yet answered.
      phase: event.type === 'swarmdrop/sent' ? 'offered' : 'active',
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
export function TransferRow({ node, useLive, onControl, t }: TransferRowProps) {
  const { direction, peerName, fileCount, totalBytes, transferredBytes, phase, terminalReason } = node.data
  // Rows for both directions sit in one transcript, so the arrow is the first
  // thing that has to distinguish them — before the device name, which is the
  // same word whichever way the bytes went.
  const inbound = direction === 'receive'
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

  const progress = t('rowProgress', {
    done: formatSize(shown.transferredBytes),
    total: formatSize(total),
  })
  const outcomeKey = terminalReason === undefined ? undefined : REASON_KEY[terminalReason]
  const detail = done
    ? terminalReason === 'completed'
      ? [
          t(inbound ? 'rowReceived' : 'rowSent'),
          t('rowFiles', { count: fileCount }),
          formatSize(totalBytes),
        ].join(' · ')
      // An unknown reason falls through to the CLI's own word rather than to
      // "ended": a value this catalogue has not caught up with is still more
      // informative than a euphemism for it.
      : `${outcomeKey === undefined ? terminalReason ?? t('rowEnded') : t(outcomeKey)} · ${progress}`
    : [
        progress,
        shown.speed === null ? null : t('rowRate', { rate: formatSize(shown.speed) }),
        shown.eta === null ? null : t('rowLeft', { duration: formatDuration(shown.eta) }),
      ].filter(part => part !== null).join(' · ')

  return (
    <div className="swarmdrop-row" style={rowStyle}>
      <div style={headStyle}>
        <span>{inbound ? '←' : '→'} {peerName} · {detail}</span>
        {live !== undefined && !done && <Controls live={live} id={node.id} onControl={onControl} t={t} />}
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

const CONTROL_KEY: Readonly<Record<TransferControlAction, SwarmDropKey>> = {
  pause: 'ctrlPause',
  resume: 'ctrlResume',
  cancel: 'ctrlCancel',
}

/** The buttons for one live transfer. */
function Controls({ live, id, onControl, t }: {
  live: LiveTransfer
  t: PropsLocale<'swarmdrop'>['t']
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
          {t(CONTROL_KEY[action])}
        </button>
      ))}
    </span>
  )
}

/** Inline styles, for the reason `panel.tsx` gives at length: this bundle ships
 * no stylesheet, and dsh's own custom properties carry the theme. */
const rowStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 }

/** A quieter second line under a row's headline. */
const hintStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--dsw-alias-label-tertiary)',
}

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
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'transparent',
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
}

// ⚠️ dsh defines no `fill-*` alias and no `border-secondary`. These three
// declarations named tokens that do not exist, so the bar rendered fully
// transparent and the button lost its outline. See `panel.tsx` for the same
// fix and `dev-notes/dsh-seams.md` for how to catch this class of thing.
const trackStyle: CSSProperties = {
  height: 3,
  borderRadius: 2,
  background: 'var(--dsw-alias-border-l2)',
  overflow: 'hidden',
}

const fillStyle: CSSProperties = {
  height: '100%',
  background: 'var(--dsw-alias-state-business-primary)',
  transition: 'width 200ms linear',
}

/** One arrival from a paired device. */
export function ReceivedRow({ node, t }: NodeProps<'swarmdrop-received'>) {
  const { sourceName, itemCount, totalSize, contentKind } = node.data
  const what = contentKind === 'text'
    ? t('rowMessage')
    : `${t('rowFiles', { count: itemCount })} · ${formatSize(totalSize)}`

  return (
    <div className="swarmdrop-row" style={rowStyle}>
      <div style={headStyle}>
        <span>← {sourceName} · {what}</span>
      </div>
      {/* The one thing the transfer row above cannot say. Both rows describe
          the same arrival — same device, same size — and after the progress row
          landed, repeating that was all this one did. What is different about
          this moment is that the item is now *addressable*: it has an inbox id,
          so it can be pulled into the next message. Someone whose conversation
          opened midway through the transfer never saw the progress row at all,
          which is why this still states what arrived rather than only that it
          can be referenced. */}
      <div style={hintStyle}>{t('rowInInbox')}</div>
    </div>
  )
}
