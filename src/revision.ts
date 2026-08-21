/**
 * "Something the panel cares about changed" — one counter, several writers.
 *
 * ## Why the panel long-polls one number and not several
 *
 * The panel's view is assembled from two independent sources: the machine
 * mirror folded from `swarmdrop watch`, and the pairing session driven by
 * `swarmdrop invite create`. They change on completely different schedules and
 * neither knows about the other.
 *
 * The browser, though, has exactly one question — *is there anything new?* —
 * and one request parked waiting for the answer. Giving each source its own
 * version would mean either two parked requests (two sockets, two timeouts,
 * two retry loops) or a composite cursor the client has to reassemble. A single
 * shared counter makes "wait for anything" the natural operation, and the cost
 * is that a pairing change also wakes a reader that only wanted devices —
 * which is free, because the answer carries both anyway.
 *
 * ## Waking is edge-triggered, reading is level-triggered
 *
 * A waiter parks on `wait(since)` and is released when `current() > since`.
 * That comparison, not the wake-up, is what decides — so a change that lands
 * between two calls is never lost: the next `wait` returns immediately because
 * the number already moved.
 */

/** A monotonic "something changed" counter that readers can park on. */
export class Revision {
  private version = 0
  private readonly waiting = new Set<() => void>()

  /** The current version. A reader feeds this back as its next `since`. */
  current(): number {
    return this.version
  }

  /** Record a change and release everyone parked on an older version. */
  bump(): void {
    this.version += 1
    // Drained into an array first: a woken reader re-parks synchronously in the
    // common case, and mutating the set while iterating it would either skip
    // that reader or spin on it.
    const waiting = [...this.waiting]
    this.waiting.clear()
    for (const wake of waiting) wake()
  }

  /**
   * Park until the version passes `since`, or until `signal` aborts.
   *
   * Returns immediately when the version has already moved — that is the whole
   * point, and it is what makes a caller that loops `since = current()` unable
   * to miss a change that happened between its two calls.
   *
   * @param since - the version the caller has already seen.
   * @param signal - aborts the wait. The caller is expected to answer with
   *   whatever it has; an aborted wait is not an error.
   */
  async wait(since: number, signal: AbortSignal): Promise<void> {
    if (this.version > since || signal.aborted) return

    await new Promise<void>(resolve => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        this.waiting.delete(finish)
        signal.removeEventListener('abort', finish)
        resolve()
      }
      this.waiting.add(finish)
      signal.addEventListener('abort', finish, { once: true })
    })
  }
}
