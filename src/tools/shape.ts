/**
 * What the CLI said, in the shape this plugin promises.
 *
 * ## Projection, not forwarding
 *
 * `swarmdrop --json` carries everything its own terminal output needs — a dozen
 * fields on an inbox entry, twenty-odd on a transfer. Forwarding one would make
 * every one of them part of this plugin's contract, including the ones that
 * exist for the terminal and the ones that will change. Each function here names
 * the handful the tools promise, and the schema beside it *is* that promise —
 * Code Mode reaches these as `await tools.swarmdrop_list_inbox(...)`, so it has
 * to be exact rather than "whatever the CLI happened to include".
 *
 * ## One place, because the rules are subtle
 *
 * Three-valued presence, a rate of `0` meaning "cannot say", a root path that
 * must never be joined with a relative one — each is a rule a reader has to
 * remember, and a rule remembered in four files is a rule that will be
 * forgotten in one of them.
 *
 * ## Not the same thing as `machine.ts`'s projections, and not to be merged
 *
 * `entryOf` there also turns an inbox entry into an object, which makes these
 * look like two copies of one idea. They are not: that one reads a **watch
 * frame** (`itemId`, and only what a panel row draws), this one reads an
 * **`inbox list` payload** (`id`, plus everything an agent needs to act). The
 * field names differ because the sources differ, and the field *sets* differ
 * because a panel and a model are asking different questions. Merging them
 * would produce one shape that is wrong for both.
 */

import { count, flag, optional, rows, text } from '../coerce.js'

/**
 * "A string, or nothing" — dsh's schema DSL has no nullable type, so absence is
 * spelled as a union.
 *
 * Spelled out rather than left off the schema entirely: a model that sees
 * `rootPath` on some entries and not others has to guess whether the field is
 * missing or the value is unknown, and it guesses wrong in the direction that
 * invents a path.
 */
const NULLABLE_STRING = { oneOf: [{ type: 'string' }, { type: 'null' }] } as const

/** Same, for a number. */
const NULLABLE_NUMBER = { oneOf: [{ type: 'number' }, { type: 'null' }] } as const

/**
 * One inbox entry, projected for a model.
 *
 * **`rootPath` is the fix for "I cannot tell where anything is".** Without it a
 * listing answers "you received 3 files from your phone" and nothing a model
 * can act on; with it, the entry has a location on this machine.
 *
 * ⚠️ **Do not join `rootPath` with a file's `relativePath`.** The CLI resolves a
 * root by agreement between the files and *falls back to the storage root* when
 * they disagree, so the joined path can name something that does not exist —
 * and it looks perfectly plausible. Per-file paths come from
 * `swarmdrop_inbox_item`, which reports what the record actually holds.
 *
 * `title` is carried even though the session-event half deliberately does not:
 * for a text entry it is the first 160 bytes of the body. The difference is who
 * asked — an event is pushed into a transcript that will be kept for months,
 * while this is the answer to a question the model just asked, and without it
 * the model cannot tell two entries from the same device apart.
 */
export function inboxEntry(row: Readonly<Record<string, unknown>>) {
  return {
    itemId: text(row['id']),
    contentKind: text(row['contentKind']),
    title: text(row['title']),
    sourceName: text(row['sourceName']),
    itemCount: count(row['itemCount']),
    totalSize: count(row['totalSize']),
    receivedAt: count(row['receivedAt']),
    rootPath: optional(row['rootPath']),
    missing: flag(row['missing']),
  }
}

/** The schema {@link inboxEntry} produces. Written out because it is the API. */
export const INBOX_ENTRY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    itemId: { type: 'string', required: true },
    // **Not an `enum`.** `online` gets narrowed to three values because true /
    // false / null is a closed set the CLI cannot grow; this one is an open
    // string from another process, and pinning it would mean a future entry
    // kind reads as a type error here — or worse, gets quietly coerced into
    // 'files' and sends a model looking for files that do not exist.
    contentKind: {
      type: 'string',
      required: true,
      description: "'files' or 'text'. A 'text' entry holds a message, not files.",
    },
    title: {
      type: 'string',
      required: true,
      description: 'Primary file name, or the start of the message for a text entry.',
    },
    sourceName: { type: 'string', required: true, description: 'Device it came from.' },
    itemCount: { type: 'integer', required: true },
    totalSize: { type: 'integer', required: true },
    receivedAt: {
      type: 'integer',
      required: true,
      description: 'Unix milliseconds (not seconds).',
    },
    rootPath: {
      ...NULLABLE_STRING,
      required: true,
      description:
        'Directory on this machine holding the entry, or null. Do not join it with a '
        + "file's relativePath — use swarmdrop_inbox_item for per-file paths.",
    },
    missing: {
      type: 'boolean',
      required: true,
      description: 'True when the files are gone from disk; the entry is a record only.',
    },
  },
} as const

/**
 * One transfer session, projected for a model.
 *
 * `speed` and `eta` come straight from the CLI, which gets them from the core's
 * own sliding window. **Nothing here re-derives them from two polls** — that is
 * exactly how SwarmDrop's terminal panel came to report ten times the real
 * rate, and a model quoting a fabricated speed to a user is worse than a model
 * saying it does not know.
 */
export function transferRow(row: Readonly<Record<string, unknown>>) {
  const speed = row['speed']
  const eta = row['eta']
  return {
    transferId: text(row['sessionId']),
    direction: text(row['direction']),
    peerName: text(row['peerName']),
    phase: text(row['phase']),
    transferredBytes: count(row['transferredBytes']),
    totalBytes: count(row['totalSize']),
    fileCount: rows(row['files']).length,
    // `0` from the CLI means "no new bytes within a window" — a stall, not a
    // measured zero. Both collapse to null so a model never quotes "0 B/s".
    speed: typeof speed === 'number' && Number.isFinite(speed) && speed >= 1 ? speed : null,
    eta: typeof eta === 'number' && Number.isFinite(eta) && eta >= 0 ? eta : null,
    recoverable: flag(row['recoverable']),
    failure: failureCodeOf(row['failure']),
  }
}

/**
 * The machine-readable failure code, out of the CLI's tagged object.
 *
 * ⚠️ **Not a string.** `FailureCode` is an internally tagged enum, so the wire
 * carries `{"code":"offerFailed"}` — sometimes with parameters beside it
 * (`{"code":"sessionExpired","retentionDays":7}`). Reading it as a string gives
 * `null` for every failed transfer, which is exactly when a model needs to be
 * able to say why. The parameters are dropped on purpose: the code is what a
 * model branches on, and the CLI's own message already carries the numbers.
 */
function failureCodeOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const code = (value as Record<string, unknown>)['code']
  return typeof code === 'string' ? code : null
}

/** The schema {@link transferRow} produces. */
export const TRANSFER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    transferId: { type: 'string', required: true },
    // Same reasoning as `contentKind` above: a closed `enum` here is an
    // assertion about another process's vocabulary, and this side gains nothing
    // from it that the description does not already say.
    direction: {
      type: 'string',
      required: true,
      description: "'send' or 'receive', from this machine's point of view.",
    },
    peerName: { type: 'string', required: true },
    phase: {
      type: 'string',
      required: true,
      description:
        "'offered' / 'waiting_accept' / 'active' / 'suspended' / 'terminal'. Only 'active' "
        + "is moving bytes. 'offered' means this machine was offered something and has not "
        + "answered yet; 'waiting_accept' means the other end has not.",
    },
    transferredBytes: { type: 'integer', required: true },
    totalBytes: { type: 'integer', required: true },
    fileCount: { type: 'integer', required: true },
    speed: {
      ...NULLABLE_NUMBER,
      required: true,
      description:
        'Bytes per second, or null when nothing can be said — stalled, not active, or a '
        + 'CLI too old to report it. Never 0.',
    },
    eta: {
      ...NULLABLE_NUMBER,
      required: true,
      description: 'Seconds remaining, or null when it cannot be estimated.',
    },
    recoverable: {
      type: 'boolean',
      required: true,
      description: 'For an interrupted transfer, whether swarmdrop_resume_transfer can pick it up.',
    },
    failure: {
      ...NULLABLE_STRING,
      required: true,
      description: 'Machine-readable failure code when it ended badly.',
    },
  },
} as const
