/**
 * The tools the model can call.
 *
 * ## Native, not proxied through MCP
 *
 * `swarmdrop mcp` would give the model the same capabilities, but a native tool
 * can do the one thing that matters here: append a Session event as it runs, so
 * the send grows a rich row in the conversation instead of a line of text. It
 * also drops a process hop and the `mcp__swarmdrop__` name prefix.
 *
 * ## The canonical value is a shape this plugin owns
 *
 * Tools **project** the CLI's output instead of forwarding it. Two reasons, and
 * the second is the load-bearing one:
 *
 * 1. `output.schema` is the programmatic API — Code Mode reaches these as
 *    `await tools.swarmdrop_send_files(...)`, so it has to be exact, not
 *    "whatever the CLI happened to include".
 * 2. Forwarding would make every CLI field an accidental part of this plugin's
 *    contract, including ones that exist for the terminal and ones that will
 *    change. Projecting keeps the blast radius of a CLI change inside this file.
 *
 * Online state is projected to a three-valued string on purpose: the CLI's
 * `null` means *unknown* (no node running to probe with), and a model handed a
 * nullable boolean reliably reads it as "offline" — which sends the user to
 * debug their network when the real answer is "start SwarmDrop".
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { SwarmDropBridge } from './bridge.js'
import { call, SwarmDropError } from './cli.js'

/** `swarmdrop send` structured result for files. */
interface SendFilesResult {
  readonly sessionId: string
  readonly fileCount: number
  readonly totalBytes: number
}

/** `swarmdrop send --text` structured result. */
interface SendTextResult {
  readonly deliveryId: string
  readonly peerName: string
  readonly bytes: number
}

/** One row of `swarmdrop device list`. */
interface DeviceRow {
  readonly peerId?: unknown
  readonly name?: unknown
  readonly online?: unknown
}

/** One row of `swarmdrop inbox list`. */
interface InboxRow {
  readonly id?: unknown
  readonly sourceName?: unknown
  readonly itemCount?: unknown
  readonly totalSize?: unknown
  readonly receivedAt?: unknown
}

/** One file inside an inbox entry, as `swarmdrop inbox show` reports it. */
interface InboxFileRow {
  readonly name?: unknown
  readonly relativePath?: unknown
  readonly localPath?: unknown
  readonly missing?: unknown
}

const text = (value: unknown): string => typeof value === 'string' ? value : ''
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

/**
 * Turn a CLI failure into something the model can act on.
 *
 * The exit code is a *classification*, not a failure flag, and saying which one
 * it is decides the model's next move: 3 means "ask the user to start a node",
 * 4 means "the device is asleep, try later", 6 means "stop retrying".
 */
function explain(error: unknown): never {
  if (error instanceof SwarmDropError) {
    const hint = error.exitCode === 3
      ? ' — no SwarmDrop node is running; the user can start one with `swarmdrop start -d`'
      : error.exitCode === 4
        ? ' — that device is not reachable right now; it may be asleep'
        : error.exitCode === 6
          ? ' — the peer refused; retrying will be refused again'
          : ''
    throw new Error(`${error.message}${hint}`)
  }
  throw error
}

export function registerTools(ctx: Context, bridge: SwarmDropBridge): void {
  ctx.tools.register(defineTool({
    name: 'swarmdrop_send_files',
    description:
      "Send local files or directories to one of the user's own paired devices "
      + '(phone, laptop) over an end-to-end encrypted peer-to-peer link. '
      + 'Call swarmdrop_list_devices first to learn the target names. '
      + 'Blocks until the transfer reaches a terminal state.',
    parameters: {
      paths: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: 'Absolute paths of the files or directories to send.',
      },
      to: {
        type: 'string',
        required: true,
        description: 'Target device: its name, or its full node id when names are ambiguous.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          transferId: { type: 'string', required: true, description: 'Use it with swarmdrop_transfer_status.' },
          fileCount: { type: 'integer', required: true },
          totalBytes: { type: 'integer', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Sent ${String(value.fileCount)} file(s) to ${args.to}.`,
      }],
    },
    async execute(args, exec) {
      const result = await call<SendFilesResult>(['send', ...args.paths, '--to', args.to])
        .catch(explain)

      // ⚠️ `exec.agent` is optional: a nested Code-Mode dispatch has no agent.
      // The send still happened, so the tool still succeeds — but there is no
      // conversation to attribute it to, so no event and no claim. Pretending
      // otherwise would put a row in someone else's transcript.
      const agent = exec.agent
      if (agent !== undefined) {
        // Claim *before* returning: progress frames for this transfer are
        // already arriving on the subscription.
        bridge.claim(result.sessionId, agent)
        agent.session.append('swarmdrop/sent', {
          version: 1,
          transferId: result.sessionId,
          peerName: args.to,
          contentKind: 'files',
          fileCount: result.fileCount,
          totalBytes: result.totalBytes,
        })
      }

      return {
        transferId: result.sessionId,
        fileCount: result.fileCount,
        totalBytes: result.totalBytes,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'swarmdrop_send_text',
    description:
      "Send a short piece of text to one of the user's own paired devices. "
      + "It lands in that device's inbox. Blocks until the peer has stored it.",
    parameters: {
      body: { type: 'string', required: true, description: 'UTF-8 text, at most 64 KiB.' },
      to: { type: 'string', required: true, description: 'Target device name or node id.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          deliveryId: { type: 'string', required: true },
          peerName: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Delivered ${String(value.bytes)} bytes to ${value.peerName}.`,
      }],
    },
    async execute(args) {
      const result = await call<SendTextResult>(['send', '--text', args.body, '--to', args.to])
        .catch(explain)
      return { deliveryId: result.deliveryId, peerName: result.peerName, bytes: result.bytes }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'swarmdrop_list_devices',
    description:
      "List the user's paired devices. `presence` is 'unknown' when no SwarmDrop "
      + "node is running to probe with — that is not the same as 'offline'.",
    parameters: {},
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            peerId: { type: 'string', required: true },
            name: { type: 'string', required: true },
            presence: {
              type: 'string',
              required: true,
              enum: ['online', 'offline', 'unknown'],
              description: "'unknown' means no node was running to probe with.",
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.length === 0
          ? 'No paired devices. The user can pair one with `swarmdrop invite create`.'
          : value.map(row => `${row.name} (${row.presence}) — ${row.peerId}`).join('\n'),
      }],
    },
    async execute() {
      const rows = await call<DeviceRow[]>(['device', 'list']).catch(explain)
      return rows.map(row => ({
        peerId: text(row.peerId),
        name: text(row.name),
        presence: row.online === true ? 'online' as const
          : row.online === false ? 'offline' as const
            : 'unknown' as const,
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'swarmdrop_list_inbox',
    description:
      "List what the user's devices have sent to this machine, newest first. "
      + 'Call swarmdrop_inbox_files afterwards to get the local paths of one entry.',
    parameters: {
      limit: { type: 'integer', description: 'Maximum entries to return. Default: all.' },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            itemId: { type: 'string', required: true },
            sourceName: { type: 'string', required: true, description: 'Device it came from.' },
            itemCount: { type: 'integer', required: true },
            totalSize: { type: 'integer', required: true },
            receivedAt: { type: 'integer', required: true, description: 'Unix seconds.' },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.length === 0
          ? 'Inbox is empty.'
          : value.map(row => `${row.itemId} — ${String(row.itemCount)} item(s) from ${row.sourceName}`).join('\n'),
      }],
    },
    async execute(args) {
      const rows = await call<InboxRow[]>(['inbox', 'list']).catch(explain)
      const limited = args.limit === undefined ? rows : rows.slice(0, args.limit)
      return limited.map(row => ({
        itemId: text(row.id),
        sourceName: text(row.sourceName),
        itemCount: count(row.itemCount),
        totalSize: count(row.totalSize),
        receivedAt: count(row.receivedAt),
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'swarmdrop_inbox_files',
    description:
      'Get the local paths of the files in one inbox entry, so they can be read or copied. '
      + 'Entries whose file is gone are reported with missing=true rather than a path that will not open.',
    parameters: {
      itemId: { type: 'string', required: true, description: 'Entry id from swarmdrop_list_inbox.' },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            relativePath: { type: 'string', required: true },
            localPath: { type: 'string', required: true },
            missing: { type: 'boolean', required: true },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.length === 0
          ? 'That entry holds no files (it may be a text message — use swarmdrop_list_inbox to check its kind).'
          : value.map(file => `${file.localPath}${file.missing ? ' (missing)' : ''}`).join('\n'),
      }],
    },
    async execute(args) {
      const detail = await call<{ files?: unknown }>(['inbox', 'show', args.itemId]).catch(explain)
      const files = Array.isArray(detail.files) ? detail.files as InboxFileRow[] : []
      return files.map(file => ({
        name: text(file.name),
        relativePath: text(file.relativePath),
        localPath: text(file.localPath),
        missing: file.missing === true,
      }))
    },
  }))
}
