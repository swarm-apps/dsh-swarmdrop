import { beforeEach, describe, expect, it } from 'vitest'

import { MachineState } from './machine.js'
import { Revision } from './revision.js'
import type { WatchFrame } from './cli.js'

/** Build a frame the way the CLI writes them, without its `v`/`seq` envelope. */
function frame(kind: string, fields: Record<string, unknown> = {}): WatchFrame {
  return { v: 1, seq: 0, kind, ...fields }
}

const PHONE = { peerId: '12D3KooWPhone', name: '光印-华为410', online: true }
const LAPTOP = { peerId: '12D3KooWLaptop', name: 'Mac mini', online: false }

describe('MachineState', () => {
  let revision: Revision
  let machine: MachineState

  beforeEach(() => {
    revision = new Revision()
    machine = new MachineState(revision)
  })

  it('adopts a baseline as a whole value', () => {
    machine.accept(frame('baseline', {
      nodeRunning: true,
      devices: [PHONE],
      inbox: [{ itemId: 'a', contentKind: 'files', sourceName: '光印-华为410', itemCount: 1, totalSize: 10, receivedAt: 1 }],
      inboxHasMore: true,
    }))

    const snapshot = machine.snapshot()
    expect(snapshot.nodeRunning).toBe(true)
    expect(snapshot.devices).toEqual([PHONE])
    expect(snapshot.inbox).toHaveLength(1)
    expect(snapshot.inboxHasMore).toBe(true)
  })

  /**
   * A baseline arrives on subscribe **and every time a node reappears**, which
   * is precisely when merging would be wrong: the second baseline is the whole
   * truth, and anything the first one held that it does not mention is gone.
   */
  it('replaces rather than merges on a second baseline', () => {
    machine.accept(frame('baseline', { nodeRunning: true, devices: [PHONE, LAPTOP], inbox: [] }))
    machine.accept(frame('baseline', { nodeRunning: true, devices: [PHONE], inbox: [] }))

    expect(machine.snapshot().devices).toEqual([PHONE])
  })

  /**
   * **`null` is unknown, not offline.** When the node goes away nothing has been
   * probed any more, and painting the devices offline would send the user to
   * debug a network that is fine.
   */
  it('forgets online state when the node goes away', () => {
    machine.accept(frame('baseline', { nodeRunning: true, devices: [PHONE, LAPTOP], inbox: [] }))
    machine.accept(frame('nodeUnavailable'))

    const snapshot = machine.snapshot()
    expect(snapshot.nodeRunning).toBe(false)
    expect(snapshot.devices.map(device => device.online)).toEqual([null, null])
  })

  it('takes the whole device table from devicesChanged', () => {
    machine.accept(frame('baseline', { nodeRunning: true, devices: [PHONE], inbox: [] }))
    machine.accept(frame('devicesChanged', { devices: [PHONE, LAPTOP] }))

    expect(machine.snapshot().devices).toHaveLength(2)
  })

  it('adds newest-first and removes by id', () => {
    machine.accept(frame('baseline', { nodeRunning: true, devices: [], inbox: [] }))
    machine.accept(frame('inboxAdded', { itemId: 'first', contentKind: 'files', sourceName: 'x', itemCount: 1, totalSize: 1, receivedAt: 1 }))
    machine.accept(frame('inboxAdded', { itemId: 'second', contentKind: 'text', sourceName: 'x', itemCount: 1, totalSize: 1, receivedAt: 2 }))

    expect(machine.snapshot().inbox.map(entry => entry.itemId)).toEqual(['second', 'first'])

    machine.accept(frame('inboxRemoved', { itemId: 'second' }))
    expect(machine.snapshot().inbox.map(entry => entry.itemId)).toEqual(['first'])
  })

  /**
   * A newer CLI may add frame kinds. Treating one as a change would wake every
   * parked panel for something that by construction did not alter the mirror.
   */
  it('ignores kinds it does not fold, without reporting a change', () => {
    machine.accept(frame('baseline', { nodeRunning: false, devices: [], inbox: [] }))
    const before = revision.current()

    machine.accept(frame('somethingFromTheFuture', { whatever: true }))

    expect(revision.current()).toBe(before)
  })

  describe('transfers', () => {
    const SESSION = 'session-1'

    /** A `transferChanged` frame, with the fields the fold reads. */
    function changed(fields: Record<string, unknown> = {}): WatchFrame {
      return frame('transferChanged', {
        sessionId: SESSION,
        direction: 'send',
        peerName: '光印-华为410',
        phase: 'active',
        transferredBytes: 0,
        totalBytes: 1_000,
        fileCount: 2,
        updatedAt: 1,
        ...fields,
      })
    }

    /** A `transferProgress` frame. */
    function progress(fields: Record<string, unknown> = {}): WatchFrame {
      return frame('transferProgress', {
        sessionId: SESSION,
        direction: 'send',
        transferredBytes: 400,
        totalBytes: 1_000,
        completedFiles: 0,
        totalFiles: 2,
        speed: 2_048,
        eta: 30,
        ...fields,
      })
    }

    it('folds a phase change and a progress sample into one row', () => {
      machine.accept(changed())
      machine.accept(progress())

      const [transfer] = machine.snapshot().transfers
      expect(transfer).toMatchObject({
        sessionId: SESSION,
        peerName: '光印-华为410',
        phase: 'active',
        transferredBytes: 400,
        speed: 2_048,
        eta: 30,
      })
    })

    /**
     * **A phase change must not blank the rate.** The rate only ever arrives on
     * progress frames, so replacing the row wholesale would clear it every time
     * the phase moved — and a phase change is exactly when a transfer becomes
     * worth looking at.
     */
    it('keeps the rate across a phase change that stays active', () => {
      machine.accept(changed())
      machine.accept(progress())
      machine.accept(changed({ transferredBytes: 500, updatedAt: 2 }))

      expect(machine.snapshot().transfers[0]?.speed).toBe(2_048)
    })

    /**
     * Leaving `active` is the one case that *does* clear it: a paused transfer
     * has no bytes moving, and last minute's rate describes a machine state
     * that no longer exists.
     */
    it('drops the rate when the transfer stops being active', () => {
      machine.accept(changed())
      machine.accept(progress())
      machine.accept(changed({ phase: 'suspended' }))

      const [transfer] = machine.snapshot().transfers
      expect(transfer?.phase).toBe('suspended')
      expect(transfer?.speed).toBeNull()
      expect(transfer?.eta).toBeNull()
    })

    /**
     * `0` from the CLI means "no new bytes within a sliding window" — a stall,
     * which is what publishing a finished file looks like. Rendering that as
     * "0 B/s" would report a stop that is not happening, so it is normalised
     * here rather than at each consumer.
     */
    it('reads a zero rate as "cannot say" rather than zero', () => {
      machine.accept(changed())
      machine.accept(progress({ speed: 0, eta: null }))

      const [transfer] = machine.snapshot().transfers
      expect(transfer?.speed).toBeNull()
      expect(transfer?.eta).toBeNull()
      // The bytes still count: the transfer did not stop existing.
      expect(transfer?.transferredBytes).toBe(400)
    })

    /** A CLI older than 0.7.0 sends no rate at all. Same answer, no crash. */
    it('tolerates a CLI that sends no rate', () => {
      machine.accept(changed())
      machine.accept(frame('transferProgress', {
        sessionId: SESSION, transferredBytes: 400, totalBytes: 1_000,
      }))

      expect(machine.snapshot().transfers[0]?.speed).toBeNull()
    })

    it('retires a session when it reaches a terminal phase', () => {
      machine.accept(changed())
      machine.accept(changed({ phase: 'terminal' }))

      expect(machine.snapshot().transfers).toHaveLength(0)
    })

    /**
     * A sample for a session the mirror never heard of is dropped rather than
     * turned into a row: it has no peer and no phase, so the panel would draw
     * "— 42%", which is worse than drawing nothing until the next phase change.
     */
    it('drops a progress sample for an unknown session', () => {
      machine.accept(progress({ sessionId: 'never-introduced' }))

      expect(machine.snapshot().transfers).toHaveLength(0)
    })

    /** The baseline carries unfinished transfers, and they are adopted. */
    it('adopts transfers from a baseline', () => {
      machine.accept(frame('baseline', {
        nodeRunning: true,
        devices: [],
        inbox: [],
        transfers: [
          { sessionId: 'a', direction: 'receive', peerName: 'Mac mini', phase: 'active', transferredBytes: 1, totalBytes: 2, fileCount: 1, updatedAt: 1 },
          { sessionId: 'b', direction: 'send', peerName: 'Mac mini', phase: 'terminal', transferredBytes: 2, totalBytes: 2, fileCount: 1, updatedAt: 1 },
        ],
      }))

      expect(machine.snapshot().transfers.map(row => row.sessionId)).toEqual(['a'])
    })

    /**
     * The node dying is not "the rate is unknown", it is "nothing is running".
     * Whatever survives comes back on the next baseline, with a fresh phase.
     */
    it('clears transfers when the node goes away', () => {
      machine.accept(changed())
      machine.accept(frame('nodeUnavailable'))

      expect(machine.snapshot().transfers).toHaveLength(0)
    })
  })

  it('reports a change for every frame it does fold', () => {
    const before = revision.current()
    machine.accept(frame('baseline', { nodeRunning: true, devices: [], inbox: [] }))
    machine.accept(frame('devicesChanged', { devices: [PHONE] }))
    expect(revision.current()).toBe(before + 2)
  })

  /**
   * A device table with a renamed or missing `online` field must read as
   * unknown. Defaulting to `false` would paint every device offline the first
   * time the CLI's field names drift.
   */
  it('reads an absent or non-boolean online field as unknown', () => {
    machine.accept(frame('baseline', {
      nodeRunning: true,
      devices: [{ peerId: 'a', name: 'a' }, { peerId: 'b', name: 'b', online: 'yes' }],
      inbox: [],
    }))
    expect(machine.snapshot().devices.map(device => device.online)).toEqual([null, null])
  })

  it('survives a baseline whose arrays are missing or the wrong type', () => {
    machine.accept(frame('baseline', { nodeRunning: true, devices: 'nope', inbox: null }))
    const snapshot = machine.snapshot()
    expect(snapshot.devices).toEqual([])
    expect(snapshot.inbox).toEqual([])
  })

  describe('baseline()', () => {
    it('reports hasMore when the CLI said there were older entries', () => {
      machine.accept(frame('baseline', { nodeRunning: true, devices: [], inbox: [], inboxHasMore: true }))
      expect(machine.baseline().hasMore).toBe(true)
    })

    /**
     * The cap is this plugin's, not the CLI's: the session log gets a bounded
     * checkpoint even when the subscription happened to carry more.
     */
    it('caps the checkpoint and says so', () => {
      const inbox = Array.from({ length: 60 }, (_, index) => ({
        itemId: `item-${String(index)}`,
        contentKind: 'files',
        sourceName: 'x',
        itemCount: 1,
        totalSize: 1,
        receivedAt: index,
      }))
      machine.accept(frame('baseline', { nodeRunning: true, devices: [], inbox, inboxHasMore: false }))

      const baseline = machine.baseline()
      expect(baseline.items).toHaveLength(50)
      expect(baseline.hasMore).toBe(true)
    })
  })
})
