/**
 * The Session event family this plugin owns.
 *
 * ## These are events, not a state mirror
 *
 * Each one records something that *happened during this conversation*, so that
 * replaying the log three months from now still explains it. The temptation is
 * to mirror SwarmDrop's state into the session instead — resist it: a mirror
 * has no time, and a session log that carries one cannot be replayed.
 *
 * The one apparent exception is {@link InboxBaselineData}, and it is not an
 * exception: "here is what you had at hand when this conversation started" is
 * exactly the context a reader needs, and it is the whole-value checkpoint the
 * conversation-node guide asks producers to emit when they can afford one.
 *
 * ## Every event carries a stable business id
 *
 * The Client assembler locates a Context by `(kind, id)` and must never guess
 * that an update belongs to "the most recent unfinished one". Transfers use the
 * SwarmDrop session id; received items use the inbox item id.
 *
 * ## `version` is not decoration
 *
 * These payloads are persisted into the user's session log, which outlives the
 * process and gets replayed. A format change that keeps parsing but shifts
 * meaning is the worst failure mode available, so every payload states its
 * version and the CLI's own `v` is carried through unchanged.
 */

import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import type { SessionEventMap } from '@deepseek-ai/dsh-session/types'

/** SwarmDrop transfer session id (uuid). Identity for the transfer node family. */
export type TransferId = string

/** SwarmDrop inbox item id (uuid). Identity for the received-item node family. */
export type InboxItemId = string

/** One inbox entry as this plugin records it. Never carries the item title. */
export interface InboxEntryData {
  readonly itemId: InboxItemId
  /** `files` or `text`. */
  readonly contentKind: string
  /** Display name of the device it came from. */
  readonly sourceName: string
  readonly itemCount: number
  readonly totalSize: number
  /** Unix milliseconds — what `new Date()` takes directly. */
  readonly receivedAt: number
}

/**
 * What was reachable from the inbox when this conversation began.
 *
 * ⚠️ **Bounded on purpose.** The inbox accumulates into the thousands, and
 * transcribing all of it into every new session log is both expensive and
 * useless — the CLI caps the baseline and says whether older items exist.
 * Reaching further back is a lookup, not a broadcast.
 */
export interface InboxBaselineData {
  readonly version: 1
  readonly items: readonly InboxEntryData[]
  /** True when older items exist beyond the ones listed. */
  readonly hasMore: boolean
  /** Whether a SwarmDrop node was running when this was taken. */
  readonly nodeRunning: boolean
}

/** A device sent something and it landed in the inbox. */
export interface InboxReceivedData {
  readonly version: 1
  readonly item: InboxEntryData
}

/**
 * The agent sent something. Opens one transfer node.
 *
 * ⚠️ **This is the `start` of the transfer family**, so it must carry enough to
 * render on its own: a terminal-only window (the user scrolled past the start)
 * still has to produce a usable row.
 */
export interface SentData {
  readonly version: 1
  readonly transferId: TransferId
  /** Device the agent sent to, as the user would name it. */
  readonly peerName: string
  /** `files` or `text`. */
  readonly contentKind: string
  readonly fileCount: number
  readonly totalBytes: number
}

/**
 * A transfer this conversation started moved on. Updates the node opened by
 * {@link SentData}.
 *
 * Carries the whole display state rather than a delta: the guide asks for a
 * whole-value checkpoint whenever the producer can afford one, and here it can
 * — the CLI already hands us the full projection on every change.
 */
export interface TransferChangedData {
  readonly version: 1
  readonly transferId: TransferId
  /** `offered` | `waiting_accept` | `active` | `suspended` | `terminal`. */
  readonly phase: string
  /** Present in the terminal phase: `completed` | `cancelled` | `rejected` | `expired`. */
  readonly terminalReason?: string
  readonly transferredBytes: number
  readonly totalBytes: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Records what the inbox held when this conversation began.
     * @mode emit
     * @param data - bounded whole-value checkpoint of the inbox.
     */
    'swarmdrop/inbox-baseline': InboxBaselineData
    /**
     * Records one item arriving from a paired device.
     * @mode emit
     * @param data - the new entry, identified by its inbox item id.
     */
    'swarmdrop/inbox-received': InboxReceivedData
    /**
     * Opens one transfer this conversation started.
     * @mode emit
     * @param data - stable transfer identity and initial display state.
     */
    'swarmdrop/sent': SentData
    /**
     * Records replayable progress for one transfer this conversation started.
     * @mode emit
     * @param data - the same transfer identity and its latest display state.
     */
    'swarmdrop/transfer': TransferChangedData
  }
}

/**
 * The event types this plugin owns, as strings.
 *
 * The two assertions below make this list impossible to get wrong: `satisfies`
 * rejects a typo, and `Exhaustive` rejects a *missing* entry by requiring the
 * list and the `swarmdrop/`-prefixed half of `SessionEventMap` to be mutually
 * assignable. The second one is the load-bearing half — a forgotten entry is
 * exactly the failure {@link announceEventTypes} exists to prevent, and it
 * would otherwise surface weeks later as a conversation that will not open.
 */
const OWNED_EVENT_TYPES = [
  'swarmdrop/inbox-baseline',
  'swarmdrop/inbox-received',
  'swarmdrop/sent',
  'swarmdrop/transfer',
] as const satisfies readonly (keyof SessionEventMap)[]

/** Every `SessionEventMap` key this plugin declared above. */
type DeclaredKeys = Extract<keyof SessionEventMap, `swarmdrop/${string}`>

/** `true` only when {@link OWNED_EVENT_TYPES} and {@link DeclaredKeys} agree. */
type Exhaustive =
  [DeclaredKeys] extends [typeof OWNED_EVENT_TYPES[number]]
    ? [typeof OWNED_EVENT_TYPES[number]] extends [DeclaredKeys] ? true : never
    : never

const _eventListIsComplete: Exhaustive = true
void _eventListIsComplete

/**
 * Teach this harness that these four types exist.
 *
 * ## Why this is necessary, and why it looks like a hack
 *
 * dsh refuses to read a session log containing an event type it does not know
 * (`PersistenceCoordinator.assertEventsSupported`), unless the event carries an
 * `ignorable: true` marker. The reasoning is sound — an unrecognized *required*
 * event may change how the rest of the log must be interpreted, so skipping it
 * would reconstruct a wrong session.
 *
 * The gap is that **neither escape applies to a third-party plugin**:
 *
 * - the known set is `KNOWN_SESSION_EVENT_TYPES`, generated from the types
 *   declared *inside the dsh repository*; and
 * - `Session.append()` builds the envelope itself and offers no way to set
 *   `ignorable`.
 *
 * dsh knows about this: `known-event-types.ts` says out-of-repo plugin events
 * are outside the list by construction and "a registration surface for them is
 * deferred until such a consumer exists". This plugin is that consumer.
 *
 * Without this call the failure is severe and delayed: sending one file writes
 * `swarmdrop/sent` into the session log, and from then on **that conversation
 * cannot be opened at all** — dsh reports "unknown to this harness" and refuses
 * the whole log rather than the one row.
 *
 * ## What this does not fix
 *
 * Announcing the types makes *this* harness read them. It does not put
 * `ignorable` on the events, so a harness **without** this plugin still refuses
 * a log that contains them: uninstalling makes those conversations unopenable.
 * Only dsh can close that half, by letting a writer mark an event ignorable.
 * Until then the README says to disable rather than uninstall.
 */
export function announceEventTypes(): void {
  // `ReadonlySet` is a compile-time face over a real `Set`; there is no
  // registration API to call instead.
  const known = KNOWN_SESSION_EVENT_TYPES as Set<string>
  for (const type of OWNED_EVENT_TYPES) known.add(type)
}
