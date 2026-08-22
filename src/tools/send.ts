/**
 * Sending: the two tools that put something on another device.
 *
 * These are the only tools that **write to the conversation**. A send is the one
 * thing here a reader will want to find three months later ("where did that file
 * go"), so it grows a durable row through {@link SwarmDropBridge} rather than
 * living only in a tool result. Everything else — listing, searching, steering a
 * transfer — is a question whose answer is already on screen.
 *
 * That is also the whole reason these are native tools rather than MCP: an MCP
 * result is text, and text cannot become a row.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

import type { SwarmDropBridge } from '../bridge.js'
import { call, TRANSFER_TIMEOUT_MS, type SendFilesResult } from '../cli.js'
import { explain } from './explain.js'
import { completed, pending, plural } from './present.js'

/** `swarmdrop send --text` structured result. */
interface SendTextResult {
  readonly deliveryId: string
  readonly peerName: string
  readonly bytes: number
}

/**
 * The sending tools.
 *
 * A factory rather than a constant because these two need the bridge, and
 * reaching for it through a module-level mutable would make the dependency
 * invisible at the one place that has to know about it.
 */
export function sendTools(bridge: SwarmDropBridge) {
  return [
    defineTool({
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
        const result = await call<SendFilesResult>(
          ['send', ...args.paths, '--to', args.to],
          TRANSFER_TIMEOUT_MS,
        ).catch(explain)
    
        // ⚠️ `exec.agent` is optional: a nested Code-Mode dispatch has no agent.
        // The send still happened, so the tool still succeeds — but there is no
        // conversation to attribute it to, so no event and no claim. Pretending
        // otherwise would put a row in someone else's transcript.
        const agent = exec.agent
        if (agent !== undefined) bridge.recordSend(agent, args.to, result)
    
        return {
          transferId: result.sessionId,
          fileCount: result.fileCount,
          totalBytes: result.totalBytes,
        }
      },
      // The paths go in `rawInput` rather than the title: one long path would
      // push the destination — the part a reader is scanning for — off the card.
      presentCall: args => pending(
        `Send ${plural(args.paths.length, 'file')} to ${args.to}`,
        'other',
        args.paths,
      ),
      // A send blocks until the transfer ends, so the pending card is on screen
      // for the whole of it. Past tense is how a reader tells "still going" from
      // "done" at a glance.
      presentResult: args => completed(`Sent to ${args.to}`),
    }),

    defineTool({
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
        // Text is capped at 64 KiB by the core, so the query timeout is right —
        // what it waits for is the peer's acceptance window, not a transfer.
        const result = await call<SendTextResult>(['send', '--text', args.body, '--to', args.to])
          .catch(explain)
        return { deliveryId: result.deliveryId, peerName: result.peerName, bytes: result.bytes }
      },
      // ⚠️ **The body is not in the card.** It is the user's own text, the card
      // sits in a transcript, and a message worth sending privately is not one
      // to reprint in a header. The tool result carries what the model needs.
      presentCall: args => pending(`Send a message to ${args.to}`, 'other'),
      presentResult: args => completed(`Delivered to ${args.to}`),
    })
  ]
}
