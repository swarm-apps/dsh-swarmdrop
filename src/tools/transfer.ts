/**
 * Transfers: watching one, and steering one that is already running.
 *
 * ## Why steering is a tool and pairing is not
 *
 * Both look like "an action with consequences", but the consequence is not the
 * same kind. Pausing a transfer affects something the model itself started, is
 * reversible, and the bytes are still there; pairing admits a device to this
 * machine for good. So the line is not "read versus write" — it is whether a
 * person has to be the one who decides.
 *
 * ## The rate is never computed here
 *
 * `speed` and `eta` arrive on the CLI's own rows, which get them from the core's
 * sliding window. Deriving them from two polls instead is exactly how
 * SwarmDrop's terminal panel came to report ten times the real speed for tens of
 * seconds — and a model quoting a fabricated rate to a user is worse than one
 * saying it cannot tell. See `shape.ts`.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

import { call } from '../cli.js'
import { rows, text } from '../coerce.js'
import { explain } from './explain.js'
import { completed, pending, shortId } from './present.js'
import { transferRow, TRANSFER_SCHEMA } from './shape.js'

/**
 * The three verbs that steer a running transfer.
 *
 * A table rather than three near-identical tool definitions: they differ only in
 * the CLI verb and the sentence describing when it applies, and writing that out
 * three times is how two of them end up with a stale description.
 */
const CONTROLS = [
  {
    tool: 'swarmdrop_pause_transfer',
    verb: 'pause',
    /** Card title, present tense. `done` is its past tense. */
    doing: 'Pause',
    done: 'Paused',
    when:
      'Pause a transfer that is currently moving bytes. Both ends stop at the same '
      + 'checkpoint and swarmdrop_resume_transfer picks it up from there. A transfer '
      + 'that has not started yet cannot be paused — cancel it instead.',
  },
  {
    tool: 'swarmdrop_resume_transfer',
    verb: 'resume',
    doing: 'Resume',
    done: 'Resumed',
    when:
      'Resume a paused or interrupted transfer from its checkpoint. Only works while '
      + 'the checkpoint is intact — check `recoverable` on the transfer first; when it '
      + 'is false the only way forward is to send again.',
  },
  {
    tool: 'swarmdrop_cancel_transfer',
    verb: 'cancel',
    doing: 'Cancel',
    done: 'Cancelled',
    when:
      'Cancel a transfer that has not finished, telling the other end. Use this rather '
      + 'than pause when the transfer should not continue at all.',
  },
] as const

/** What `swarmdrop transfer pause|resume|cancel --json` answers. */
interface ControlResult {
  readonly done?: unknown
  readonly failed?: unknown
}

/** What a control tool reports back. */
interface ControlOutcome {
  readonly applied: boolean
  readonly reason: string | null
}

/**
 * Read the CLI's control outcome.
 *
 * The CLI takes a list of ids and answers with two lists — the ones it acted on
 * and the ones it refused, each with a reason. These tools send exactly one id,
 * so the first entry of either list is the answer.
 *
 * ⚠️ **The common refusals never reach this function.** The CLI filters the
 * candidate set by `Control::applies` before acting, and an id that is not in it
 * becomes a *usage error* (exit 2), not an entry in `failed` — so "pause one
 * that is not active" and "resume one whose checkpoint is gone" arrive as a
 * thrown error, handled by `explain`'s hint for 2. What lands here is the race:
 * the session passed the filter and then the domain call failed anyway.
 *
 * ⚠️ **`done` holds id strings, not objects.** Reading it with `rows()` (which
 * keeps only objects) drops every entry, and the surrounding expression then
 * decided `applied` from `Array.isArray` alone — always true, including for a
 * verb that did nothing. Extracted into a named function so the rule is
 * testable rather than buried in a `.catch` chain.
 */
export function outcomeOf(result: ControlResult): ControlOutcome {
  const failure = rows(result.failed)[0]
  if (failure !== undefined) return { applied: false, reason: text(failure['reason']) }
  const done = Array.isArray(result.done) ? result.done.length : 0
  if (done > 0) return { applied: true, reason: null }
  // Neither list mentions the session: the CLI does that when the id is not
  // among the ones this verb can act on at all — already finished, or never
  // there. Saying so beats claiming success.
  return { applied: false, reason: 'that transfer is not in a state this action applies to' }
}

export const transferTools = [
  defineTool({
    name: 'swarmdrop_list_transfers',
    description:
      'List transfer sessions, most recent first — in flight and recently finished. '
      + 'Use it to see whether something the user sent got through, or what is running now.',
    parameters: {
      activeOnly: {
        type: 'boolean',
        description: 'Only sessions that have not finished. Default: false.',
      },
      limit: { type: 'integer', description: 'Maximum sessions to return. Default: all.' },
    },
    output: {
      schema: { type: 'array', items: TRANSFER_SCHEMA },
      render: (_args, value) => [{
        type: 'text',
        text: value.length === 0
          ? 'No transfers.'
          : value.map(row =>
            `${row.direction === 'send' ? '→' : '←'} ${row.peerName} · ${row.phase} · `
            + `${String(row.transferredBytes)}/${String(row.totalBytes)} bytes`).join('\n'),
      }],
    },
    async execute(args) {
      const list = await call<Record<string, unknown>[]>(['transfer', 'list']).catch(explain)
      const projected = list.map(transferRow)
      // Filtered here because `transfer list` has no flag for it. 'terminal' is
      // the CLI's own word for "this session is over", whatever the outcome.
      const filtered = args.activeOnly === true
        ? projected.filter(row => row.phase !== 'terminal')
        : projected
      return args.limit === undefined ? filtered : filtered.slice(0, args.limit)
    },
    presentCall: args => pending(
      args.activeOnly === true ? 'List transfers in flight' : 'List transfers',
      'read',
    ),
  }),

  defineTool({
    name: 'swarmdrop_transfer_status',
    description:
      'Check one transfer by id — the id swarmdrop_send_files returned. Reports the phase, '
      + 'how far it got, and how fast it is going.',
    parameters: {
      transferId: { type: 'string', required: true, description: 'Session id.' },
    },
    output: {
      schema: TRANSFER_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `${value.phase} · ${String(value.transferredBytes)}/${String(value.totalBytes)} bytes`
          + (value.speed === null ? '' : ` · ${String(Math.round(value.speed))} B/s`),
      }],
    },
    async execute(args) {
      const row = await call<Record<string, unknown>>(['transfer', 'show', args.transferId])
        .catch(explain)
      return transferRow(row)
    },
    presentCall: args => pending(
      `Check transfer ${shortId(args.transferId)}`,
      'read',
      args.transferId,
    ),
  }),

  ...CONTROLS.map(control => defineTool({
    name: control.tool,
    description: control.when,
    parameters: {
      transferId: { type: 'string', required: true, description: 'Session id.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          applied: {
            type: 'boolean',
            required: true,
            description: 'False when the session was not in a state this verb applies to.',
          },
          reason: {
            oneOf: [{ type: 'string' }, { type: 'null' }],
            required: true,
            description: 'Why it did not apply, when it did not.',
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.applied ? 'Done.' : `Not applied: ${value.reason ?? 'unknown reason'}`,
      }],
    },
    async execute(args) {
      const result = await call<ControlResult>(['transfer', control.verb, args.transferId])
        .catch(explain)
      // ⚠️ **A refused verb is not an error.** The CLI reports "that session was
      // not in a state you can pause" in the payload and still exits 0, because
      // for a batch of ids some may apply and some may not. Throwing here would
      // tell the model the machine failed, when what happened is that its
      // request no longer made sense — and the answer to that is to look again,
      // not to retry.
      return outcomeOf(result)
    },
    presentCall: args => pending(
      `${control.doing} transfer ${shortId(args.transferId)}`,
      'other',
      args.transferId,
    ),
    // ⚠️ **The completed title must not claim it worked.** A refused verb is a
    // successful call with `applied: false`, and `presentResult` only sees the
    // model-facing content — so a flat "Paused transfer abc" would be a lie in
    // exactly the case a reader most needs the truth. Naming the transfer and
    // leaving the outcome to the result content is the honest card.
    presentResult: args => completed(`${control.doing} transfer ${shortId(args.transferId)}`),
  })),
]
