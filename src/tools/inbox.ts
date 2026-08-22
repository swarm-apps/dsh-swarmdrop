/**
 * The inbox: what the user's devices have sent to this machine.
 *
 * ## The three tools answer three different questions
 *
 * | Question | Tool |
 * |---|---|
 * | "what came in recently" | `swarmdrop_list_inbox` |
 * | "where is the thing about X" | `swarmdrop_search_inbox` |
 * | "give me that entry, in full" | `swarmdrop_inbox_item` |
 *
 * The split is not decoration. A list must stay cheap — SwarmDrop's own spec
 * forbids a payload that grows with the file count, because these results get
 * persisted — so it carries per-*entry* facts only. The completing tool is named
 * in every list's description, because the failure this design produced once was
 * a model listing an inbox and then having nowhere to go for the actual paths.
 *
 * ## Paths come from the record, never from arithmetic
 *
 * An entry has a `rootPath` and its files have `relativePath`s, and joining them
 * looks obviously right. It is not: the CLI resolves a root by agreement between
 * the files and falls back to the storage root when they disagree, so the joined
 * path can name something that does not exist — and it looks perfectly
 * plausible. `swarmdrop_inbox_item` reports each file's real `localPath`, which
 * is the only path safe to hand to another tool.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

import { call } from '../cli.js'
import { count, optional, rows, text } from '../coerce.js'
import { explain, INBOX_SEARCH_SINCE } from './explain.js'
import { pending, plural, shortId } from './present.js'
import { inboxEntry, INBOX_ENTRY_SCHEMA } from './shape.js'

/** One file inside an inbox entry, as `swarmdrop inbox show` reports it. */
interface InboxFileRow {
  readonly name?: unknown
  readonly relativePath?: unknown
  readonly localPath?: unknown
  readonly size?: unknown
  readonly missing?: unknown
}

/** The file schema `swarmdrop_inbox_files` and `swarmdrop_inbox_item` share. */
const INBOX_FILE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    relativePath: { type: 'string', required: true, description: "Path within the entry's root." },
    localPath: {
      type: 'string',
      required: true,
      description: 'Real path on this machine — the one to hand to another tool.',
    },
    size: { type: 'integer', required: true },
    missing: {
      type: 'boolean',
      required: true,
      description: 'True when the file is gone from disk; localPath will not open.',
    },
  },
} as const

/** Project one file row. Shared so the two tools cannot drift apart. */
export function inboxFile(file: InboxFileRow) {
  return {
    name: text(file.name),
    relativePath: text(file.relativePath),
    localPath: text(file.localPath),
    size: count(file.size),
    missing: file.missing === true,
  }
}

/** Read the file rows out of an `inbox show` payload, whatever its content kind. */
export function filesOf(detail: Readonly<Record<string, unknown>>): InboxFileRow[] {
  const content = detail['content']
  if (typeof content !== 'object' || content === null) return []
  return rows((content as Record<string, unknown>)['entries'])
}

export const inboxTools = [
  defineTool({
    name: 'swarmdrop_list_inbox',
    description:
      "List what the user's devices have sent to this machine, newest first. "
      + 'Each entry says where it landed (rootPath); for the path of a specific file, '
      + 'or the body of a text message, call swarmdrop_inbox_item. '
      + 'Use swarmdrop_search_inbox when looking for something by keyword.',
    parameters: {
      limit: { type: 'integer', description: 'Maximum entries to return. Default: all.' },
    },
    output: {
      schema: { type: 'array', items: INBOX_ENTRY_SCHEMA },
      render: (_args, value) => [{
        type: 'text',
        text: value.length === 0
          ? 'Inbox is empty.'
          : value.map(row => `${row.itemId} — ${row.title} (${String(row.itemCount)} item(s) from ${row.sourceName})`).join('\n'),
      }],
    },
    async execute(args) {
      const list = await call<Record<string, unknown>[]>(['inbox', 'list']).catch(explain)
      // Sliced here because `inbox list` has no limit flag. Newest first is the
      // CLI's own order, so the head is the useful end.
      const limited = args.limit === undefined ? list : list.slice(0, args.limit)
      return limited.map(inboxEntry)
    },
    presentCall: args => pending(
      args.limit === undefined
        ? 'List the inbox'
        : `List the newest ${plural(args.limit, 'inbox entry', 'inbox entries')}`,
      'read',
    ),
  }),

  defineTool({
    name: 'swarmdrop_search_inbox',
    description:
      'Find inbox entries by keyword. Matches the title, the sending device, the body of '
      + 'a text message and the names of files, so it is the right tool when the user '
      + 'describes what they sent rather than when. Follow with swarmdrop_inbox_item for '
      + "an entry's files and paths.",
    parameters: {
      query: { type: 'string', required: true, description: 'Substring to look for.' },
      limit: { type: 'integer', description: 'Maximum entries. Default: the CLI decides.' },
      includeArchived: {
        type: 'boolean',
        description: 'Also search entries the user has archived. Default: false.',
      },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            itemId: { type: 'string', required: true },
            title: { type: 'string', required: true },
            sourceName: { type: 'string', required: true },
            itemCount: { type: 'integer', required: true },
            receivedAt: {
              type: 'integer',
              required: true,
              description: 'Unix milliseconds (not seconds).',
            },
            rootPath: {
              oneOf: [{ type: 'string' }, { type: 'null' }],
              required: true,
              description: 'Directory holding the entry, or null. Use swarmdrop_inbox_item for per-file paths.',
            },
            snippet: {
              oneOf: [{ type: 'string' }, { type: 'null' }],
              required: true,
              description:
                'Text around the match, when the hit was inside a message body. Null when the '
                + 'match was the title or the device name — both of which are already above.',
            },
            fileNames: {
              type: 'array',
              required: true,
              items: { type: 'string' },
              description: 'Names of the files in this entry, for recognising it. Not paths.',
            },
          },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: value.length === 0
          ? `Nothing in the inbox matches "${args.query}".`
          : value.map(hit => `${hit.itemId} — ${hit.title} (from ${hit.sourceName})`).join('\n'),
      }],
    },
    async execute(args) {
      const argv = ['inbox', 'search', args.query]
      if (args.limit !== undefined) argv.push('--limit', String(args.limit))
      if (args.includeArchived === true) argv.push('--include-archived')
      // The version floor is passed so an older CLI produces one actionable
      // sentence rather than clap's usage text, which a model reads as its own
      // mistake and retries against forever.
      const hits = await call<Record<string, unknown>[]>(argv)
        .catch((error: unknown) => explain(error, INBOX_SEARCH_SINCE))
      return hits.map(hit => ({
        itemId: text(hit['id']),
        title: text(hit['title']),
        sourceName: text(hit['sourceName']),
        itemCount: count(hit['itemCount']),
        receivedAt: count(hit['receivedAt']),
        rootPath: optional(hit['rootPath']),
        snippet: optional(hit['snippet']),
        fileNames: rows(hit['files']).map(file => text(file['name'])),
      }))
    },
    // The query in the title, not `rawInput`: it is short, and it is the one
    // thing that makes this call different from the last one.
    presentCall: args => pending(`Search the inbox for "${args.query}"`, 'search'),
  }),

  defineTool({
    name: 'swarmdrop_inbox_item',
    description:
      'Everything about one inbox entry: where it landed, the real path of every file, '
      + 'and the body if it is a text message. This is the tool that completes '
      + 'swarmdrop_list_inbox and swarmdrop_search_inbox.',
    parameters: {
      itemId: { type: 'string', required: true, description: 'Entry id from a list or search.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entry: { ...INBOX_ENTRY_SCHEMA, required: true },
          text: {
            oneOf: [{ type: 'string' }, { type: 'null' }],
            required: true,
            description: 'The message body for a text entry; null for a file entry.',
          },
          files: {
            type: 'array',
            required: true,
            items: INBOX_FILE_SCHEMA,
            description: 'Empty for a text entry.',
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.text !== null
          ? value.text
          : value.files.map(file => `${file.localPath}${file.missing ? ' (missing)' : ''}`).join('\n'),
      }],
    },
    async execute(args) {
      const detail = await call<Record<string, unknown>>(['inbox', 'show', args.itemId])
        .catch(explain)
      const content = detail['content']
      const body = typeof content === 'object' && content !== null
        ? (content as Record<string, unknown>)['body']
        : undefined
      return {
        // The summary is flattened into the detail payload by the CLI, so the
        // same projection reads it — one description of an inbox entry, not two.
        entry: inboxEntry(detail),
        text: optional(body),
        files: filesOf(detail).map(inboxFile),
      }
    },
    presentCall: args => pending(`Open inbox entry ${shortId(args.itemId)}`, 'read', args.itemId),
  }),

  defineTool({
    name: 'swarmdrop_inbox_files',
    description:
      'Get the local paths of the files in one inbox entry, so they can be read or copied. '
      + 'Files that are gone from disk are reported with missing=true rather than a path '
      + 'that will not open. swarmdrop_inbox_item returns these plus the rest of the entry.',
    parameters: {
      itemId: { type: 'string', required: true, description: 'Entry id from swarmdrop_list_inbox.' },
    },
    output: {
      schema: { type: 'array', items: INBOX_FILE_SCHEMA },
      render: (_args, value) => [{
        type: 'text',
        text: value.length === 0
          ? 'That entry holds no files (it may be a text message — swarmdrop_inbox_item returns the body).'
          : value.map(file => `${file.localPath}${file.missing ? ' (missing)' : ''}`).join('\n'),
      }],
    },
    // ⚠️ **The files are at `content.entries`, not `files`.** This read used to
    // be `detail.files`, which does not exist on any version of the payload — so
    // the tool answered "no files" for every entry ever passed to it, and did it
    // without failing. That is what a projection with two implementations buys:
    // `swarmdrop_inbox_item` read the right place, this one did not, and only
    // one of them was ever checked. Both now go through `filesOf`.
    async execute(args) {
      const detail = await call<Record<string, unknown>>(['inbox', 'show', args.itemId])
        .catch(explain)
      return filesOf(detail).map(inboxFile)
    },
    presentCall: args => pending(`Files of inbox entry ${shortId(args.itemId)}`, 'read', args.itemId),
  }),
]
