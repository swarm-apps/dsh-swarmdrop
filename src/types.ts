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
  /** Unix seconds. */
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
