/**
 * `swarmdrop watch` → Session events.
 *
 * ## Which session receives a machine-wide event
 *
 * SwarmDrop's subscription is per *machine*; `session.append` needs a *session*.
 * The mapping is not uniform, because the events are not the same kind of fact:
 *
 * | Event | Goes to | Why |
 * |---|---|---|
 * | inbox baseline | the session being started | it answers "what did you have at hand *here*" |
 * | inbox received | every **root** agent | a device sent you something; that is true of every open conversation |
 * | sent / transfer | only the session that started it | it is that conversation's action, not a fact about the machine |
 *
 * Roots rather than all agents: a sub-agent's log should not grow chat rows
 * meant for the top-level conversation, and `ctx.agents.list()` includes them.
 *
 * ## Transfers are attributed, not broadcast
 *
 * A transfer opened by `swarmdrop send` in another terminal is none of this
 * conversation's business — appending it would put a row in the transcript that
 * the reader cannot account for. So `swarmdrop/transfer` is only appended for
 * transfer ids this plugin itself started, and the attribution table is what
 * decides. Entries leave the table at the terminal phase; nothing else removes
 * them, because a transfer that never terminates is exactly the one still worth
 * showing.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

import { watch, type WatchFrame } from './cli.js'
import type { InboxEntryData, InboxBaselineData, TransferId } from './types.js'

/** How many inbox entries a session baseline carries. */
const BASELINE_LIMIT = 50

/** Terminal transfer phase, as the CLI names it. */
const PHASE_TERMINAL = 'terminal'

/** Read a string field off an untrusted frame. */
function str(frame: WatchFrame, key: string): string {
  const value = frame[key]
  return typeof value === 'string' ? value : ''
}

/** Read a numeric field off an untrusted frame. */
function num(frame: WatchFrame, key: string): number {
  const value = frame[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Build one inbox entry from a frame, tolerating a newer CLI's extra fields. */
function entryOf(frame: WatchFrame): InboxEntryData {
  return {
    itemId: str(frame, 'itemId'),
    contentKind: str(frame, 'contentKind'),
    sourceName: str(frame, 'sourceName'),
    itemCount: num(frame, 'itemCount'),
    totalSize: num(frame, 'totalSize'),
    receivedAt: num(frame, 'receivedAt'),
  }
}

/**
 * The live inbox, folded from the subscription.
 *
 * Kept in memory rather than re-queried per session start so that a new
 * conversation's baseline costs nothing: the subscription already told us
 * everything, and re-asking the CLI would race with it.
 */
class InboxView {
  /** Newest first, mirroring the CLI's own ordering contract. */
  private entries: InboxEntryData[] = []
  private truncated = false
  private nodeRunning = false

  /** Adopt a whole-value baseline from the stream. */
  replace(frame: WatchFrame): void {
    const items = Array.isArray(frame['inbox']) ? frame['inbox'] : []
    this.entries = items
      .filter((item): item is WatchFrame => typeof item === 'object' && item !== null)
      .map(entryOf)
    this.truncated = frame['inboxHasMore'] === true
    this.nodeRunning = frame['nodeRunning'] === true
  }

  add(entry: InboxEntryData): void {
    this.entries.unshift(entry)
  }

  remove(itemId: string): void {
    this.entries = this.entries.filter(entry => entry.itemId !== itemId)
  }

  /** Snapshot for one session baseline. */
  baseline(): InboxBaselineData {
    return {
      version: 1,
      items: this.entries.slice(0, BASELINE_LIMIT),
      // Either the CLI already told us there were older ones, or our own cap bit.
      hasMore: this.truncated || this.entries.length > BASELINE_LIMIT,
      nodeRunning: this.nodeRunning,
    }
  }

  /** Everything we know about, for the `@` source to fold against. */
  all(): readonly InboxEntryData[] {
    return this.entries
  }
}

/** Live bridge between the machine-wide subscription and per-session logs. */
export class SwarmDropBridge {
  private readonly inbox = new InboxView()
  /** transfer id → the agent whose conversation started it. */
  private readonly owners = new Map<TransferId, Agent>()
  private stop: (() => void) | undefined

  constructor(private readonly ctx: Context) {}

  /** Start the subscription. Safe to call before a SwarmDrop node exists. */
  start(): void {
    this.stop = watch(
      frame => { this.onFrame(frame) },
      message => { this.ctx.logger('swarmdrop').warn(message) },
    )
  }

  /** Tear the subscription down (SIGTERM; the CLI exits 0). */
  dispose(): void {
    this.stop?.()
    this.stop = undefined
  }

  /**
   * Claim a transfer this conversation just started.
   *
   * Called by the send tool with the agent that invoked it, so the subsequent
   * progress frames can be attributed. Claiming before the first frame arrives
   * is why this is a method and not an inference from the stream.
   */
  claim(transferId: TransferId, agent: Agent): void {
    this.owners.set(transferId, agent)
  }

  /** Record "here is what you had at hand" on one starting session. */
  recordBaseline(agent: Agent): void {
    agent.session.append('swarmdrop/inbox-baseline', this.inbox.baseline())
  }

  /** Everything the inbox holds right now. */
  entries(): readonly InboxEntryData[] {
    return this.inbox.all()
  }

  private onFrame(frame: WatchFrame): void {
    switch (frame.kind) {
      case 'baseline':
        this.inbox.replace(frame)
        return
      case 'inboxAdded': {
        const entry = entryOf(frame)
        this.inbox.add(entry)
        this.broadcast('swarmdrop/inbox-received', { version: 1, item: entry })
        return
      }
      case 'inboxRemoved':
        this.inbox.remove(str(frame, 'itemId'))
        return
      case 'transferChanged':
        this.onTransfer(frame)
        return
      // Everything else (progress, devices, truncation, node availability) is
      // machine state rather than something that happened in a conversation.
      // Recording it would put rows in the transcript that no reader can
      // account for. Deliberately dropped.
      default:
        return
    }
  }

  private onTransfer(frame: WatchFrame): void {
    const transferId = str(frame, 'sessionId')
    const agent = this.owners.get(transferId)
    if (agent === undefined) return

    const phase = str(frame, 'phase')
    const terminalReason = str(frame, 'terminalReason')
    this.append(agent, 'swarmdrop/transfer', {
      version: 1,
      transferId,
      phase,
      ...terminalReason === '' ? {} : { terminalReason },
      transferredBytes: num(frame, 'transferredBytes'),
      totalBytes: num(frame, 'totalBytes'),
    })
    // The terminal phase is the last thing this transfer will ever say.
    if (phase === PHASE_TERMINAL) this.owners.delete(transferId)
  }

  /** Append to every top-level conversation. */
  private broadcast(type: 'swarmdrop/inbox-received', data: { version: 1; item: InboxEntryData }): void {
    for (const agent of this.ctx.agents.roots()) this.append(agent, type, data)
  }

  /**
   * Append one event, tolerating a disposed agent.
   *
   * A conversation can end between the frame arriving and this call; that is
   * ordinary, not an error worth surfacing. Letting it throw would take down
   * the subscription for every other session too.
   */
  private append<T extends 'swarmdrop/inbox-received' | 'swarmdrop/transfer'>(
    agent: Agent,
    type: T,
    data: Parameters<Agent['session']['append']>[1] & object,
  ): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrowed by the union above
      agent.session.append(type as any, data as any)
    } catch (error) {
      this.ctx.logger('swarmdrop').debug('dropping event for a closed session: %o', error)
    }
  }
}
