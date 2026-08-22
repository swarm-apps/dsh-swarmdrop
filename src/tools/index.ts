/**
 * What the model can call.
 *
 * ## Native, not proxied through MCP
 *
 * `swarmdrop mcp` would give the model the same capabilities, but a native tool
 * can do the one thing that matters here: append a Session event as it runs, so
 * a send grows a rich row in the conversation instead of a line of text. It also
 * drops a process hop and the `mcp__swarmdrop__` name prefix.
 *
 * ## Split by what the model is asking about, not by shape
 *
 * The four modules match the questions a model actually has — *put this
 * somewhere* (`send`), *what came in* (`inbox`), *is it getting there*
 * (`transfer`), *can this machine reach anything* (`device`) — which is also how
 * the CLI's own verbs are grouped, so a change on that side lands in one file
 * here. Two more sit underneath: `shape` turns the CLI's output into this
 * plugin's contract, `explain` turns its failures into a next move.
 *
 * ## Everything here is a projection
 *
 * No tool forwards a `--json` object. `output.schema` is a programmatic API —
 * Code Mode reaches these as `await tools.swarmdrop_send_files(...)` — so it has
 * to be exact rather than "whatever the CLI happened to include", and forwarding
 * would make every CLI field an accidental part of this plugin's contract.
 *
 * ## Where the surface stops
 *
 * Nothing here can pair a device. Accepting an inbound request is a person's
 * decision at the panel, and a tool that could pair would be a tool that could
 * hand a stranger a channel into this machine — the same line SwarmDrop's own
 * MCP server draws.
 */

import type { Context } from '@deepseek-ai/cordis'

import type { SwarmDropBridge } from '../bridge.js'
import { deviceTools } from './device.js'
import { inboxTools } from './inbox.js'
import { sendTools } from './send.js'
import { transferTools } from './transfer.js'

/**
 * Register every tool.
 *
 * One loop rather than a `register` call per tool: registration is one concern,
 * and spreading it across four modules would mean four places that could
 * silently stop registering.
 */
export function registerTools(ctx: Context, bridge: SwarmDropBridge): void {
  for (const tool of [...sendTools(bridge), ...deviceTools, ...inboxTools, ...transferTools]) {
    ctx.tools.register(tool)
  }
}
