import { describe, expect, it } from 'vitest'

import { Revision } from './revision.js'

/** An AbortSignal that never fires, for waits that are expected to be woken. */
function never(): AbortSignal {
  return new AbortController().signal
}

describe('Revision', () => {
  it('starts at zero and counts up', () => {
    const revision = new Revision()
    expect(revision.current()).toBe(0)
    revision.bump()
    expect(revision.current()).toBe(1)
  })

  /**
   * The load-bearing property: a change that lands *between* two calls must not
   * be missed.
   *
   * A reader loops `wait(since)` → read → `since = current()`. Between its read
   * and its next `wait` there is a window in which a change can arrive with
   * nobody parked. Waking is edge-triggered, so if `wait` only ever parked, that
   * change would sit unreported until the *next* one — which for a pairing
   * request means the panel never shows it.
   */
  it('returns at once when the version already moved', async () => {
    const revision = new Revision()
    const seen = revision.current()
    revision.bump()

    // No parked waiter existed when bump() ran, and this still must not block.
    await revision.wait(seen, never())
    expect(revision.current()).toBeGreaterThan(seen)
  })

  it('wakes a parked reader when something changes', async () => {
    const revision = new Revision()
    let woke = false
    const parked = revision.wait(revision.current(), never()).then(() => { woke = true })

    // Nothing has changed yet, so it must still be parked.
    await Promise.resolve()
    expect(woke).toBe(false)

    revision.bump()
    await parked
    expect(woke).toBe(true)
  })

  it('wakes every parked reader, not just the first', async () => {
    const revision = new Revision()
    const since = revision.current()
    const all = Promise.all([
      revision.wait(since, never()),
      revision.wait(since, never()),
      revision.wait(since, never()),
    ])
    revision.bump()
    await expect(all).resolves.toHaveLength(3)
  })

  /**
   * A reader that re-parks the instant it is woken must not be dropped.
   *
   * `bump` drains the waiter set before calling anyone, precisely so a
   * synchronous re-park lands in a fresh set rather than one being iterated.
   * Getting this wrong makes the *second* change silently unreported — which
   * would look like the panel updating once and then going stale.
   */
  it('survives a reader that re-parks synchronously', async () => {
    const revision = new Revision()
    let rounds = 0
    let since = revision.current()

    const follow = async (): Promise<void> => {
      while (rounds < 3) {
        await revision.wait(since, never())
        since = revision.current()
        rounds += 1
      }
    }
    const running = follow()

    for (let i = 0; i < 3; i += 1) {
      revision.bump()
      // One turn of the microtask queue is all the reader needs to re-park.
      await Promise.resolve()
      await Promise.resolve()
    }

    await running
    expect(rounds).toBe(3)
  })

  it('returns when the wait is aborted, without a change', async () => {
    const revision = new Revision()
    const controller = new AbortController()
    const since = revision.current()
    const parked = revision.wait(since, controller.signal)

    controller.abort()
    await parked
    // The caller answers with whatever it has; an aborted wait is not an error
    // and must not have advanced anything.
    expect(revision.current()).toBe(since)
  })

  it('returns at once for an already-aborted signal', async () => {
    const revision = new Revision()
    await expect(revision.wait(revision.current(), AbortSignal.abort())).resolves.toBeUndefined()
  })
})
