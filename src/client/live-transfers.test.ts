import { describe, expect, it, vi } from 'vitest'

import { createLiveTransfers } from './live-transfers.js'
import type { PanelPort, PanelState } from './panel-port.js'
import type { PanelTransfer } from '../panel-wire.js'

const TRANSFER: PanelTransfer = {
  sessionId: 'abc',
  direction: 'send',
  peerName: '光印-华为410',
  phase: 'active',
  transferredBytes: 400,
  totalBytes: 1_000,
  fileCount: 2,
  recoverable: false,
  speed: 2_048,
  eta: 30,
}

/** A port whose state this test drives by hand. */
function stubPort(initial: Partial<PanelState> = {}) {
  let snapshot = { transfers: [], busy: [], ...initial } as PanelState
  const listeners = new Set<() => void>()
  const controlTransfer = vi.fn(async () => {})
  const port = {
    state: {
      getSnapshot: () => snapshot,
      subscribe(fn: () => void) {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
    },
    controlTransfer,
  } as unknown as PanelPort
  return {
    port,
    controlTransfer,
    push(next: Partial<PanelState>) {
      snapshot = { ...snapshot, ...next }
      for (const fn of listeners) fn()
    },
  }
}

describe('createLiveTransfers', () => {
  /**
   * The normal state of a deployment with no `connection`, and of every row read
   * back later. It must not be an error — the row renders from the log instead.
   */
  it('says nothing is live before a channel arrives', () => {
    const live = createLiveTransfers()
    expect(live.face.hooks.live.getSnapshot()).toEqual({})
  })

  /** A control with no channel is dropped rather than thrown: the row only
   * offers one when it has a live entry, so getting here means the channel went
   * away between the render and the click. */
  it('ignores a control with no channel', () => {
    const live = createLiveTransfers()
    expect(() => { live.face.onControl('abc', 'pause') }).not.toThrow()
  })

  it('projects the transfers once a channel attaches', () => {
    const live = createLiveTransfers()
    const { port } = stubPort({ transfers: [TRANSFER] })
    live.attach(port)

    expect(live.face.hooks.live.getSnapshot()['abc']).toEqual({
      phase: 'active',
      transferredBytes: 400,
      totalBytes: 1_000,
      speed: 2_048,
      eta: 30,
      recoverable: false,
      busy: false,
    })
  })

  /** Busy is per transfer: two running at once, and one pending pause must not
   * grey out the other's buttons. */
  it('marks only the transfer whose control is in flight', () => {
    const live = createLiveTransfers()
    const other: PanelTransfer = { ...TRANSFER, sessionId: 'def' }
    const { port } = stubPort({ transfers: [TRANSFER, other], busy: ['transfer:abc'] })
    live.attach(port)

    const snapshot = live.face.hooks.live.getSnapshot()
    expect(snapshot['abc']?.busy).toBe(true)
    expect(snapshot['def']?.busy).toBe(false)
  })

  /**
   * **The panel answers roughly once a second whether or not anything moved.**
   * Publishing on every answer would re-render every transfer row in the
   * transcript for nothing, so an unchanged projection must not notify.
   */
  it('does not notify when nothing about a transfer changed', () => {
    const live = createLiveTransfers()
    const { port, push } = stubPort({ transfers: [TRANSFER] })
    live.attach(port)

    const listener = vi.fn()
    live.face.hooks.live.subscribe(listener)
    push({ transfers: [{ ...TRANSFER }] })
    expect(listener).not.toHaveBeenCalled()

    push({ transfers: [{ ...TRANSFER, transferredBytes: 500 }] })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('forwards a control to the attached port', () => {
    const live = createLiveTransfers()
    const { port, controlTransfer } = stubPort({ transfers: [TRANSFER] })
    live.attach(port)

    live.face.onControl('abc', 'pause')
    expect(controlTransfer).toHaveBeenCalledWith('abc', 'pause')
  })

  /** A torn-down channel leaves the rows rendering from the log, not from a
   * frozen last frame that will never update again. */
  it('goes quiet when the channel detaches', () => {
    const live = createLiveTransfers()
    const { port } = stubPort({ transfers: [TRANSFER] })
    const detach = live.attach(port)
    expect(live.face.hooks.live.getSnapshot()['abc']).toBeDefined()

    detach()
    expect(live.face.hooks.live.getSnapshot()).toEqual({})
  })
})
