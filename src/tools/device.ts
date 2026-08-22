/**
 * The machine itself: which devices exist, and whether this node can reach them.
 *
 * ## Why "can I reach it" is a tool at all
 *
 * Every failure to send has two very different causes — the node here is not
 * running, or the device there is asleep — and they need opposite responses.
 * Without a way to ask, a model faced with a failed send has to guess, and the
 * guess a user pays for is "your network is broken" when the answer was "start
 * SwarmDrop".
 *
 * ## Not here: pairing
 *
 * Nothing in this file can pair a device, and nothing ever should. Accepting an
 * inbound request is a person's decision at the panel — a tool that could pair
 * would be a tool that could hand a stranger a channel into this machine. The
 * same line SwarmDrop's own MCP server draws.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

import { call, type DeviceRow } from '../cli.js'
import { count, flag, list, presenceLabel, text } from '../coerce.js'
import { explain } from './explain.js'
import { pending } from './present.js'

/** What `swarmdrop status --json` reports, as far as these tools read it. */
type StatusRow = Readonly<Record<string, unknown>>

/** Devices and node status. */
export const deviceTools = [
    defineTool({
      name: 'swarmdrop_list_devices',
      description:
        "List the user's paired devices. `presence` is 'unknown' when no SwarmDrop "
        + "node is running to probe with — that is not the same as 'offline'. "
        + 'Pass onlineOnly to narrow it to the devices that can be sent to right now.',
      // One tool with a filter rather than two (SwarmDrop's MCP server splits them
      // into list_available/list_paired). A model choosing between tools pays for
      // every extra name in the list, and "only the reachable ones" is a narrowing
      // of one question, not a second question. The unfiltered call is still the
      // one that explains *why* a device cannot be reached, which is why the
      // parameter defaults to off.
      parameters: {
        onlineOnly: {
          type: 'boolean',
          description: 'Only devices known to be online. Default: false (all paired devices).',
        },
      },
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
      async execute(args) {
        const list = await call<DeviceRow[]>(['device', 'list']).catch(explain)
        const projected = list.map(row => ({
          peerId: text(row.peerId),
          name: text(row.name),
          presence: presenceLabel(row.online),
        }))
        // Filtered here rather than by a CLI flag: `device list` has none, and
        // 'unknown' must not survive the filter — a device nobody has probed is
        // not one that can be sent to right now.
        return args.onlineOnly === true
          ? projected.filter(device => device.presence === 'online')
          : projected
      },
      presentCall: args => pending(
        args.onlineOnly === true ? 'List reachable devices' : 'List paired devices',
        'read',
      ),
    }),

  defineTool({
    name: 'swarmdrop_node_status',
    description:
      'Check the local SwarmDrop node: whether it is running, how it is reachable, '
      + 'and how many peers it is connected to. Call this first when a send fails — '
      + 'it distinguishes "no node is running here" from "that device is unreachable".',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          running: {
            type: 'boolean',
            required: true,
            description: 'False means nothing can be sent or received until the user starts it.',
          },
          nodeId: { type: 'string', required: true, description: "This machine's node identity." },
          natStatus: {
            type: 'string',
            required: true,
            description: 'How this machine sits behind NAT; affects whether peers can reach it directly.',
          },
          relayReady: {
            type: 'boolean',
            required: true,
            description: 'Whether a relay reservation is held — the fallback path when direct fails.',
          },
          bootstrapConnected: {
            type: 'boolean',
            required: true,
            description: 'Whether the node reached the bootstrap network. False means it is isolated.',
          },
          connectedPeers: { type: 'integer', required: true },
          listenAddrs: {
            type: 'array',
            required: true,
            items: { type: 'string' },
            description: 'Addresses this node listens on.',
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.running
          ? `Node running · ${String(value.connectedPeers)} peer(s) · NAT ${value.natStatus}`
          : 'No SwarmDrop node is running on this machine.',
      }],
    },
    async execute() {
      // ⚠️ `status` answers on a machine with no node — that is the whole point
      // of asking — so this must not treat "stopped" as a failure. The CLI
      // reports it in the payload rather than the exit code, and `explain` only
      // sees genuine faults (no binary, unreadable records).
      const row = await call<StatusRow>(['status']).catch(explain)
      return {
        running: text(row['status']) === 'running',
        nodeId: text(row['peerId']),
        natStatus: text(row['natStatus']),
        relayReady: flag(row['relayReady']),
        bootstrapConnected: flag(row['bootstrapConnected']),
        connectedPeers: count(row['connectedPeers']),
        listenAddrs: [...list(row['listenAddrs'])],
      }
    },
    presentCall: () => pending('Check the SwarmDrop node', 'read'),
  }),
]
