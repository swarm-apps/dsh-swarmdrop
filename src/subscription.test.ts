import { describe, expect, it, vi } from 'vitest'

import type { WatchFrame } from './cli.js'
import { WatchSubscription, type SubscriptionDeps } from './subscription.js'

/** One spawned subscription, so a test can end it the way a process would. */
interface FakeWatch {
  onFrame: (frame: WatchFrame) => void
  onEnded: (message: string) => void
  stop: ReturnType<typeof vi.fn>
}

/** A scheduled retry, run by hand rather than by a clock. */
interface FakeTimer {
  fn: () => void
  ms: number
  cancelled: boolean
}

function harness() {
  const spawns: FakeWatch[] = []
  const timers: FakeTimer[] = []
  const frames: WatchFrame[] = []
  const health: (string | null)[] = []

  const deps: SubscriptionDeps = {
    start: (onFrame, onEnded) => {
      const spawn = { onFrame, onEnded, stop: vi.fn() }
      spawns.push(spawn)
      return spawn.stop
    },
    schedule: (fn, ms) => {
      const timer: FakeTimer = { fn, ms, cancelled: false }
      timers.push(timer)
      return timer
    },
    cancel: handle => { (handle as FakeTimer).cancelled = true },
  }

  const subscription = new WatchSubscription({
    onFrame: frame => frames.push(frame),
    onHealth: trouble => health.push(trouble),
  }, deps)

  return {
    subscription, spawns, timers, frames, health,
    /** The process that is currently running. */
    live: (): FakeWatch => {
      const spawn = spawns.at(-1)
      if (spawn === undefined) throw new Error('nothing was spawned')
      return spawn
    },
    /** Fire the pending retry, as a clock would. */
    fire: (): void => {
      const timer = timers.at(-1)
      if (timer === undefined) throw new Error('no retry was scheduled')
      timer.fn()
    },
  }
}

const FRAME: WatchFrame = { v: 1, seq: 0, kind: 'baseline', devices: [], inbox: [] }

describe('WatchSubscription', () => {
  it('subscribes at once', () => {
    const h = harness()
    expect(h.spawns).toHaveLength(1)
    expect(h.subscription.health()).toBeNull()
  })

  it('passes frames through', () => {
    const h = harness()
    h.live().onFrame(FRAME)
    expect(h.frames).toEqual([FRAME])
  })

  /**
   * **The bug this class exists for.** `swarmdrop watch` handles SIGTERM and
   * exits 0, so anything that kills it — a user, an upgrade replacing the
   * binary — used to end the subscription silently. The mirror then served
   * whatever it held for the life of the dsh process.
   */
  it('comes back after the process ends', () => {
    const h = harness()
    h.live().onEnded('`swarmdrop watch` exited with 0')

    expect(h.timers).toHaveLength(1)
    h.fire()
    expect(h.spawns).toHaveLength(2)
  })

  it('reports being down, and reports recovering', () => {
    const h = harness()
    h.live().onEnded('gone')
    expect(h.health).toEqual(['gone'])
    expect(h.subscription.health()).toBe('gone')

    h.fire()
    h.live().onFrame(FRAME)
    expect(h.health).toEqual(['gone', null])
    expect(h.subscription.health()).toBeNull()
  })

  /** Health is an edge, so a consumer need not filter duplicates. */
  it('reports a health change once', () => {
    const h = harness()
    h.live().onEnded('gone')
    h.fire()
    h.live().onEnded('gone')
    expect(h.health).toEqual(['gone'])
  })

  it('backs off, and stops backing off at the ceiling', () => {
    const h = harness()
    for (let attempt = 0; attempt < 8; attempt++) {
      h.live().onEnded('gone')
      h.fire()
    }
    expect(h.timers.map(timer => timer.ms))
      .toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000])
  })

  /**
   * A spawn that succeeds and dies immediately would otherwise reset the delay
   * every time and become a process-per-second loop. Only a frame proves the
   * attempt produced a working subscription.
   */
  it('resets the delay on a frame, not on a spawn', () => {
    const h = harness()
    h.live().onEnded('gone')
    h.fire()
    h.live().onEnded('gone')
    h.fire()
    expect(h.timers.map(timer => timer.ms)).toEqual([1_000, 2_000])

    h.live().onFrame(FRAME)
    h.live().onEnded('gone')
    expect(h.timers.at(-1)?.ms).toBe(1_000)
  })

  it('stops for good on dispose', () => {
    const h = harness()
    const live = h.live()
    h.subscription.dispose()

    expect(live.stop).toHaveBeenCalledOnce()
    live.onEnded('gone')
    expect(h.timers).toHaveLength(0)
    expect(h.health).toEqual([])
  })

  it('cancels a pending retry on dispose', () => {
    const h = harness()
    h.live().onEnded('gone')
    h.subscription.dispose()

    expect(h.timers[0]?.cancelled).toBe(true)
    h.fire()
    expect(h.spawns).toHaveLength(1)
  })

  /**
   * The handle belongs to a process that has already gone. Calling its stop()
   * would send SIGTERM to a pid this plugin no longer owns — which by then may
   * belong to something else entirely.
   */
  it('does not stop a process that already ended', () => {
    const h = harness()
    const dead = h.live()
    dead.onEnded('gone')
    h.subscription.dispose()
    expect(dead.stop).not.toHaveBeenCalled()
  })
})
