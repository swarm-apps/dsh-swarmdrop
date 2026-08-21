/**
 * `/swarmdrop` — the human-triggered half.
 *
 * ## Why a command *and* tools
 *
 * The tools are how the model acts. This is how the *person* acts, without
 * having to ask the model to do it for them ("send this to my phone" costs a
 * model round trip and can be misunderstood; `/swarmdrop send ./x.pdf phone`
 * cannot).
 *
 * ## `sourceEventSeq` is what makes the result rich
 *
 * The handler appends the durable domain event first and returns a result that
 * merely *points at* it. Presentation then belongs to that event's conversation
 * node, so the command and the tool grow the same row — one renderer, not two.
 * Returning prose here instead would fork the presentation immediately.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'

import type { SwarmDropBridge } from './bridge.js'
import { call, SwarmDropError } from './cli.js'

interface SendFilesResult {
  readonly sessionId: string
  readonly fileCount: number
  readonly totalBytes: number
}

interface DeviceRow {
  readonly peerId: string
  readonly name: string
  readonly online: boolean | null
}

/** Split `send ./a.pdf phone` into a verb and its words, tolerating extra spaces. */
function words(input: string): string[] {
  return input.trim().split(/\s+/u).filter(word => word !== '')
}

const USAGE = 'Usage: /swarmdrop send <path...> <device> | /swarmdrop devices'

export function registerCommand(ctx: Context, bridge: SwarmDropBridge): void {
  ctx.commands.register({
    name: 'swarmdrop',
    description: 'Send files to your own devices, or list them.',
    input: { hint: 'send <path...> <device> | devices' },
    async handler(invocation): Promise<CommandResult> {
      const [verb, ...rest] = words(invocation.rawInput)
      if (verb === undefined) return { kind: 'error', text: USAGE }

      try {
        if (verb === 'devices') return await listDevices()
        if (verb === 'send') return await send(rest)
        return { kind: 'error', text: USAGE }
      } catch (error) {
        if (error instanceof SwarmDropError) return { kind: 'error', text: error.message }
        throw error
      }
    },
  })

  async function listDevices(): Promise<CommandResult> {
    const rows = await call<DeviceRow[]>(['device', 'list'])
    if (rows.length === 0) {
      return { kind: 'success', text: 'No paired devices yet. Run `swarmdrop invite create` to pair one.' }
    }
    const text = rows
      // `null` is *unknown*, not offline: saying "offline" would send the user
      // to debug their network when the real answer is "no node is running".
      .map(row => `${row.name} — ${row.online === null ? 'unknown' : row.online ? 'online' : 'offline'}`)
      .join('\n')
    return { kind: 'success', text }
  }

  async function send(rest: readonly string[]): Promise<CommandResult> {
    // The device is the last word; everything before it is a path. Taking the
    // *last* rather than the first keeps `send a.pdf b.pdf phone` working.
    const to = rest.at(-1)
    const paths = rest.slice(0, -1)
    if (to === undefined || paths.length === 0) return { kind: 'error', text: USAGE }

    const agent = ctx.agents.requireInitiator()
    const result = await call<SendFilesResult>(['send', ...paths, '--to', to])
    bridge.claim(result.sessionId, agent)
    const event = agent.session.append('swarmdrop/sent', {
      version: 1,
      transferId: result.sessionId,
      peerName: to,
      contentKind: 'files',
      fileCount: result.fileCount,
      totalBytes: result.totalBytes,
    })
    // Point at the event rather than describing it: its conversation node owns
    // the presentation, and that node is the same one the tool path grows.
    return { kind: 'success', sourceEventSeq: event.seq }
  }
}
