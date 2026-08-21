import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PairFrame } from './cli.js'
import { PairingSession } from './pairing.js'
import { Revision } from './revision.js'

/** The last window `pair()` was asked to open, so a test can drive it. */
interface FakeWindow {
  onFrame: (frame: PairFrame) => void
  onError: (message: string) => void
  respond: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

const windows: FakeWindow[] = []

vi.mock('./cli.js', () => ({
  pair: (onFrame: (frame: PairFrame) => void, onError: (message: string) => void) => {
    const session = { onFrame, onError, respond: vi.fn(), stop: vi.fn() }
    windows.push(session)
    return { respond: session.respond, stop: session.stop }
  },
}))

/** A context stub: `PairingSession` uses it only to log. */
const ctx = { logger: () => ({ warn: () => {} }) } as never

const REQUEST: PairFrame = {
  event: 'pairingRequest',
  pendingId: 7,
  peerId: '12D3KooWFarSide',
  device: 'Mac mini',
  os: 'macos',
  arch: 'aarch64',
  connection: 'lan',
}

describe('PairingSession', () => {
  let revision: Revision
  let pairing: PairingSession

  beforeEach(() => {
    windows.length = 0
    revision = new Revision()
    pairing = new PairingSession(ctx, revision)
  })

  const latest = (): FakeWindow => {
    const window = windows.at(-1)
    if (window === undefined) throw new Error('no window was opened')
    return window
  }

  it('starts idle', () => {
    expect(pairing.snapshot().phase).toBe('idle')
    expect(windows).toHaveLength(0)
  })

  it('opens a window and reports the invite', () => {
    pairing.begin()
    expect(pairing.snapshot().phase).toBe('waiting')

    latest().onFrame({ event: 'inviteCreated', invite: 'https://example/#ABC', id: 'cafe' })
    const snapshot = pairing.snapshot()
    expect(snapshot.invite).toBe('https://example/#ABC')
    expect(snapshot.inviteId).toBe('cafe')
  })

  /**
   * The panel can be open in two browser tabs, and both may click. A second
   * process would race the first for the same inbound request — and since an
   * invite is one-shot, the loser's user sees nothing at all.
   */
  it('is idempotent while a window is open', () => {
    pairing.begin()
    pairing.begin()
    pairing.begin()
    expect(windows).toHaveLength(1)
  })

  it('surfaces an inbound request for the user to decide', () => {
    pairing.begin()
    latest().onFrame(REQUEST)

    const snapshot = pairing.snapshot()
    expect(snapshot.phase).toBe('deciding')
    expect(snapshot.request).toEqual({
      pendingId: 7,
      peerId: '12D3KooWFarSide',
      device: 'Mac mini',
      os: 'macos',
      arch: 'aarch64',
      connection: 'lan',
    })
  })

  it('answers the request the user is looking at', () => {
    pairing.begin()
    latest().onFrame(REQUEST)
    pairing.respond(7, true)

    expect(latest().respond).toHaveBeenCalledWith(7, true)
    // Back to waiting either way — a decline does not consume the invite.
    expect(pairing.snapshot().phase).toBe('waiting')
    expect(pairing.snapshot().request).toBeNull()
  })

  /**
   * **The security case.** A click that raced an expiry would otherwise answer
   * whichever request arrived in between — admitting a device the user never
   * saw. The id the panel sends must match what the desk is actually holding.
   */
  it('refuses to answer a request it is not holding', () => {
    pairing.begin()
    latest().onFrame(REQUEST)

    pairing.respond(999, true)
    expect(latest().respond).not.toHaveBeenCalled()
    // And the real request is still on screen, waiting for its answer.
    expect(pairing.snapshot().phase).toBe('deciding')
    expect(pairing.snapshot().request?.pendingId).toBe(7)
  })

  it('refuses to answer when nothing is pending', () => {
    pairing.begin()
    pairing.respond(7, true)
    expect(latest().respond).not.toHaveBeenCalled()
  })

  it('returns to waiting when a request expires unanswered', () => {
    pairing.begin()
    latest().onFrame(REQUEST)
    latest().onFrame({ event: 'pairingRequestExpired' })

    expect(pairing.snapshot().phase).toBe('waiting')
    expect(pairing.snapshot().request).toBeNull()
  })

  it('records a successful pairing and closes the window', () => {
    pairing.begin()
    latest().onFrame(REQUEST)
    latest().onFrame({ event: 'paired', device: 'Mac mini', persisted: true })

    const snapshot = pairing.snapshot()
    expect(snapshot.phase).toBe('paired')
    expect(snapshot.pairedDevice).toBe('Mac mini')
    expect(snapshot.request).toBeNull()
  })

  /**
   * The CLI exits after a success, so the process is already gone. Dismissing
   * the result must not try to kill it again, and must leave the desk ready to
   * open a fresh window.
   */
  it('can open a new window after a successful pairing', () => {
    pairing.begin()
    latest().onFrame({ event: 'paired', device: 'Mac mini', persisted: true })
    const stopCalls = latest().stop.mock.calls.length

    pairing.cancel()
    expect(latest().stop.mock.calls).toHaveLength(stopCalls)
    expect(pairing.snapshot().phase).toBe('idle')

    pairing.begin()
    expect(windows).toHaveLength(2)
  })

  /**
   * Cancelling has to kill the process, not just reset the phase: the running
   * process **is** the open door, and the node keeps accepting inbound requests
   * for as long as it lives.
   */
  it('closes the door when cancelled', () => {
    pairing.begin()
    const window = latest()
    pairing.cancel()

    expect(window.stop).toHaveBeenCalledOnce()
    expect(pairing.snapshot().phase).toBe('idle')
  })

  it('closes the door on dispose', () => {
    pairing.begin()
    const window = latest()
    pairing.dispose()
    expect(window.stop).toHaveBeenCalledOnce()
  })

  it('reports a failed window and goes back to idle', () => {
    pairing.begin()
    latest().onError('pairing needs swarmdrop 0.5.0 or newer')

    const snapshot = pairing.snapshot()
    expect(snapshot.phase).toBe('idle')
    expect(snapshot.error).toBe('pairing needs swarmdrop 0.5.0 or newer')
    // The window is gone, so the next click must be able to open a new one.
    pairing.begin()
    expect(windows).toHaveLength(2)
  })

  it('ignores events it does not know', () => {
    pairing.begin()
    latest().onFrame(REQUEST)
    const before = revision.current()

    latest().onFrame({ event: 'somethingFromTheFuture' })

    expect(revision.current()).toBe(before)
    expect(pairing.snapshot().phase).toBe('deciding')
  })

  it('reports every state change', () => {
    const before = revision.current()
    pairing.begin()
    latest().onFrame({ event: 'inviteCreated', invite: 'x', id: 'y' })
    latest().onFrame(REQUEST)
    expect(revision.current()).toBe(before + 3)
  })
})
