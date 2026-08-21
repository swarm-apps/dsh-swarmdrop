/**
 * Machine-wide facts → per-session events.
 *
 * This is the *routing* half. The folding half is {@link MachineState}, which
 * holds what this machine looks like right now; this class decides which of
 * those happenings deserve a durable row in which conversation, and appends it.
 * Neither keeps a copy of the other's data.
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
 *
 * ## Node and device state deliberately produce no events
 *
 * "The node stopped" is not something that happened *in a conversation*, and a
 * transcript that grows rows the reader cannot account for is worse than one
 * that is quiet. Those frames stop at {@link MachineState}, where the panel
 * reads them.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

import type { SendFilesResult, WatchFrame } from './cli.js'
import { count, text } from './coerce.js'
import { entryOf, type MachineState } from './machine.js'
import type { InboxEntryData, TransferId } from './types.js'

/** Terminal transfer phase, as the CLI names it. */
const PHASE_TERMINAL = 'terminal'

/** Routes machine-wide happenings into the conversations they belong to. */
export class SwarmDropBridge {
  /** transfer id → the agent whose conversation started it. */
  private readonly owners = new Map<TransferId, Agent>()

  constructor(private readonly ctx: Context, private readonly machine: MachineState) {}

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

  /**
   * Record a send this conversation just started, and claim its frames.
   *
   * **One place, because the payload is persisted.** `swarmdrop/sent` lands in
   * the user's session log and is replayed months later; a six-field literal
   * written in both the tool and the command is a format edited in two places
   * with nothing linking them. The command's own docblock argues for exactly
   * this ("one renderer, not two") — this is the same argument one layer down.
   *
   * Claiming happens *before* the append: progress frames for this transfer are
   * already arriving on the subscription.
   */
  recordSend(agent: Agent, peerName: string, result: SendFilesResult) {
    this.claim(result.sessionId, agent)
    return agent.session.append('swarmdrop/sent', {
      version: 1,
      transferId: result.sessionId,
      peerName,
      contentKind: 'files',
      fileCount: result.fileCount,
      totalBytes: result.totalBytes,
    })
  }

  /** Record "here is what you had at hand" on one starting session. */
  recordBaseline(agent: Agent): void {
    agent.session.append('swarmdrop/inbox-baseline', this.machine.baseline())
  }

  /**
   * Route one subscription frame.
   *
   * Called for every frame, including the ones this class ignores: the
   * assembly point fans each frame out to both readers rather than deciding
   * for them what is interesting.
   */
  accept(frame: WatchFrame): void {
    switch (frame.kind) {
      case 'inboxAdded':
        this.broadcast(entryOf(frame))
        return
      case 'transferChanged':
        this.onTransfer(frame)
        return
      default:
        return
    }
  }

  private onTransfer(frame: WatchFrame): void {
    const transferId = text(frame['sessionId'])
    const agent = this.owners.get(transferId)
    if (agent === undefined) return

    const phase = text(frame['phase'])
    const terminalReason = text(frame['terminalReason'])
    this.append(agent, 'swarmdrop/transfer', {
      version: 1,
      transferId,
      phase,
      ...terminalReason === '' ? {} : { terminalReason },
      transferredBytes: count(frame['transferredBytes']),
      totalBytes: count(frame['totalBytes']),
    })
    // The terminal phase is the last thing this transfer will ever say.
    if (phase === PHASE_TERMINAL) this.owners.delete(transferId)
  }

  /** Append to every top-level conversation. */
  private broadcast(item: InboxEntryData): void {
    for (const agent of this.ctx.agents.roots()) {
      this.append(agent, 'swarmdrop/inbox-received', { version: 1, item })
    }
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
