import { describe, expect, it } from 'vitest'

import { filesOf, inboxFile } from './inbox.js'
import { inboxEntry, transferRow } from './shape.js'
import { outcomeOf } from './transfer.js'

/**
 * Fixtures are **real `swarmdrop --json` output**, trimmed but not reshaped.
 *
 * Hand-written ones would have agreed with whatever this file expected — which
 * is exactly how `swarmdrop_inbox_files` shipped reading a field that has never
 * existed on any version of the payload.
 */
const ENTRY = {
  id: '5c88e51c-aa37-47db-a771-52205be86309',
  contentKind: 'files',
  title: 'wiztree_c.csv',
  sourceName: '光印-华为410',
  sourcePeerId: '12D3KooWGsHTp9ELpP3Ha2KbSSTqRav2yWHt8As4KNvKAHeHqkYj',
  itemCount: 1,
  totalSize: 434735989,
  rootPath: '/Users/yexiyue/Downloads/SwarmDrop',
  receivedAt: 1787105479747,
  missing: false,
  archivedAt: null,
  contentHash: '1c723a8a…',
}

const DETAIL = {
  ...ENTRY,
  content: {
    kind: 'files',
    transfer: null,
    entries: [{
      id: 1,
      transferFileId: 1,
      name: 'wiztree_c.csv',
      relativePath: 'wiztree_c.csv',
      localPath: '/Users/yexiyue/Downloads/SwarmDrop/wiztree_c.csv',
      size: 434735989,
      checksum: '4ac707f0…',
      missing: false,
    }],
  },
}

describe('inboxEntry', () => {
  /**
   * The complaint that produced this projection: a model could list the inbox
   * and still not know *where* anything was, or whether an entry was a message
   * or files.
   */
  it('says where the entry landed and what kind it is', () => {
    expect(inboxEntry(ENTRY)).toEqual({
      itemId: '5c88e51c-aa37-47db-a771-52205be86309',
      contentKind: 'files',
      title: 'wiztree_c.csv',
      sourceName: '光印-华为410',
      itemCount: 1,
      totalSize: 434735989,
      receivedAt: 1787105479747,
      rootPath: '/Users/yexiyue/Downloads/SwarmDrop',
      missing: false,
    })
  })

  /** `receivedAt` is **milliseconds**. Seven doc comments said seconds; a reader
   * who believed them and multiplied by 1000 would land in the year 58000. */
  it('passes the timestamp through as milliseconds', () => {
    expect(new Date(inboxEntry(ENTRY).receivedAt).getUTCFullYear()).toBe(2026)
  })

  /** An entry with no resolved root is `null`, not an empty string — the model
   * has to be able to tell "nowhere on disk" from "the root directory". */
  it('reports an unresolved root as null', () => {
    expect(inboxEntry({ ...ENTRY, rootPath: null }).rootPath).toBeNull()
  })
})

describe('filesOf', () => {
  /**
   * ⚠️ **The regression guard for the bug that started this.**
   *
   * `swarmdrop_inbox_files` read `detail.files`, which does not exist — the CLI
   * puts them under `content.entries`. It answered "no files" for every entry
   * ever passed to it and never failed while doing so.
   */
  it('reads the files where the CLI actually puts them', () => {
    expect(filesOf(DETAIL)).toHaveLength(1)
    expect(filesOf(DETAIL)[0]?.localPath)
      .toBe('/Users/yexiyue/Downloads/SwarmDrop/wiztree_c.csv')
    // The shape the old code looked for is not there, and never was.
    expect(DETAIL).not.toHaveProperty('files')
  })

  /** A text entry has a body and no entries; that is an empty list, not a fault. */
  it('reports a text entry as holding no files', () => {
    expect(filesOf({ ...ENTRY, content: { kind: 'text', body: 'hello' } })).toEqual([])
  })

  /** A payload from a CLI this plugin does not know still has to not throw. */
  it('tolerates a detail with no content at all', () => {
    expect(filesOf({})).toEqual([])
  })
})

describe('inboxFile', () => {
  it('carries the real path and the size', () => {
    expect(inboxFile(DETAIL.content.entries[0]!)).toEqual({
      name: 'wiztree_c.csv',
      relativePath: 'wiztree_c.csv',
      localPath: '/Users/yexiyue/Downloads/SwarmDrop/wiztree_c.csv',
      size: 434735989,
      missing: false,
    })
  })
})

describe('transferRow', () => {
  /**
   * A `transfer list --json` row as the CLI actually serialises `TransferProjection`.
   *
   * **No `speed`/`eta` here on purpose.** Those are not on the projection — a
   * running daemon annotates them onto the answer, and a machine with no daemon
   * gets this shape. An earlier version of this fixture invented them, which
   * made three tests vouch for a payload that does not exist.
   */
  const ROW = {
    sessionId: 'abc',
    direction: 'send',
    peerName: 'Mac mini',
    phase: 'active',
    transferredBytes: 400,
    totalSize: 1000,
    files: [{ fileId: 1 }, { fileId: 2 }],
    recoverable: false,
    failure: null,
  }

  it('projects a row that carries no rate', () => {
    expect(transferRow(ROW)).toMatchObject({
      transferId: 'abc',
      totalBytes: 1000,
      fileCount: 2,
      speed: null,
      eta: null,
    })
  })

  /** With a daemon running, `ProgressCache::annotate` adds these two. */
  it('projects the rate a running daemon annotated on', () => {
    expect(transferRow({ ...ROW, speed: 2048, eta: 30 }))
      .toMatchObject({ speed: 2048, eta: 30 })
  })

  /**
   * `failure` is an internally tagged enum — `{"code":"offerFailed"}`, sometimes
   * with parameters beside it. Read as a string it is `null` for every failed
   * transfer, which is precisely when a model needs to say why.
   */
  it('reads the failure code out of the tagged object', () => {
    expect(transferRow({ ...ROW, failure: { code: 'offerFailed' } }).failure)
      .toBe('offerFailed')
    expect(transferRow({ ...ROW, failure: { code: 'sessionExpired', retentionDays: 7 } }).failure)
      .toBe('sessionExpired')
    expect(transferRow(ROW).failure).toBeNull()
  })

  /**
   * **`0` means "cannot say", not "stopped".** The core zeroes the rate when a
   * sliding window sees no new bytes — which is what publishing a finished file
   * looks like. A model that read that as a measured zero would tell the user
   * their transfer had stalled when it had not.
   */
  it('reads a zero rate as unknown', () => {
    expect(transferRow({ ...ROW, speed: 0, eta: null })).toMatchObject({ speed: null, eta: null })
  })

  /** Garbage in those fields is "cannot say", not a crash. */
  it('tolerates nonsense in the rate fields', () => {
    expect(transferRow({ ...ROW, speed: 'fast', eta: {} }))
      .toMatchObject({ speed: null, eta: null })
  })
})

describe('outcomeOf', () => {
  /**
   * ⚠️ **The regression guard for a rule that read the wrong shape.**
   *
   * `done` is a list of id *strings*. Reading it with `rows()` — which keeps
   * only objects — dropped every entry, and the expression around it then
   * decided `applied` from `Array.isArray` alone: always true, including for a
   * verb that did nothing at all.
   */
  it('reports a verb that acted as applied', () => {
    expect(outcomeOf({ done: ['abc-uuid'], failed: [] }))
      .toEqual({ applied: true, reason: null })
  })

  /** A refusal is a successful call with a reason, not a fault. */
  it('passes the CLI refusal through', () => {
    expect(outcomeOf({ done: [], failed: [{ id: 'abc', reason: '会话不在传输中' }] }))
      .toEqual({ applied: false, reason: '会话不在传输中' })
  })

  /** Neither list mentions it: the id was not one this verb can act on. Saying
   * so beats claiming success, which is what the old expression did. */
  it('does not claim success when nothing happened', () => {
    const outcome = outcomeOf({ done: [], failed: [] })
    expect(outcome.applied).toBe(false)
    expect(outcome.reason).not.toBeNull()
  })

  /** The payload comes from another process and may be any shape. */
  it('tolerates a malformed answer', () => {
    expect(outcomeOf({}).applied).toBe(false)
    expect(outcomeOf({ done: 'not a list' }).applied).toBe(false)
  })
})
