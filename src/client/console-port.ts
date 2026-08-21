/**
 * The console's browser half: sections that load when looked at, and nothing else.
 *
 * ## Why this is not the panel port
 *
 * The panel's port owns a **long poll** that runs for the life of the page —
 * the sidebar badge has to be right before anyone opens anything. Nothing here
 * can work that way: every section costs a `swarmdrop` process, and a settings
 * page nobody has open would be spawning them for a screen that is not on
 * screen.
 *
 * So the two ports are the two clocks, and the page reads both: the live half
 * (node liveness, devices, pairing) comes from the panel's store at no extra
 * cost, and only the historical half is fetched here.
 *
 * ## Loaded once, refreshed on request
 *
 * {@link ConsolePort.load} is a no-op for a section already in hand — switching
 * tabs back and forth must not spawn a process each time. {@link
 * ConsolePort.refresh} is the user asking, and always goes.
 *
 * ## Two rules inherited from the panel port, for the same reasons
 *
 * 1. **Every call has a deadline.** `fetch` has none of its own, and a request
 *    that never settles leaves the `finally` that clears `busy` unrun — the
 *    control stays disabled for the life of the page with nothing on screen
 *    saying why.
 * 2. **Busy is per control.** Keyed by action *and target*, so a slow revoke on
 *    one invite does not grey out its neighbour.
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext, ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

import {
  ACTION_RELOADS, ENDPOINT_CONSOLE_ACT, ENDPOINT_CONSOLE_LOAD,
  actionKey,
  type ConsoleAction, type ConsoleActionAnswer, type ConsoleData, type ConsoleSection,
  type UpdateCheck,
} from '../console-wire.js'
import { PANEL_CHANNEL } from '../panel-wire.js'

/**
 * Deadline for reading a section.
 *
 * The Host bounds a CLI query at 120 s and reports its own timeout in words; a
 * little above that means this only fires when the answer never came back at
 * all, which is the case the Host cannot report.
 */
const LOAD_DEADLINE_MS = 130_000

/**
 * Deadline for an action.
 *
 * Same shape as the read: above the Host's own bound, so it is a watchdog on
 * the transport rather than a policy on how long an action may take.
 */
const ACTION_DEADLINE_MS = 130_000

/** What the console page draws. */
export interface ConsoleState {
  /** Sections with a read in flight. */
  readonly loading: readonly ConsoleSection[]
  /** Sections already in hand, by name. */
  readonly loaded: Readonly<Partial<Record<ConsoleSection, ConsoleData>>>
  /** Which controls have a call in flight; see {@link actionKey}. */
  readonly busy: readonly string[]
  /**
   * The last read failed, in its own words.
   *
   * Cleared by any successful read: a successful read *is* the evidence that
   * whatever was wrong is not wrong any more.
   */
  readonly error: string | null
  /**
   * The last action the user asked for did not happen.
   *
   * Kept apart from {@link error} because they are cleared by different things
   * — a read that succeeds a moment after a refused click would otherwise wipe
   * the only explanation the user had.
   */
  readonly actionError: string | null
  /** Something worth saying after an action succeeded (where the export went). */
  readonly notice: string | null
  /**
   * What the last update check found.
   *
   * Kept as data rather than a sentence: the Host has no locale, and an English
   * status word in a Chinese page is a bug the user sees.
   */
  readonly update: UpdateCheck | null
}

const INITIAL: ConsoleState = {
  loading: [],
  loaded: {},
  busy: [],
  error: null,
  actionError: null,
  notice: null,
  update: null,
}

/** What the console page is handed. */
export interface ConsolePort {
  readonly state: ObservableSnapshot<ConsoleState>
  /** Fetch a section unless it is already in hand. */
  load(section: ConsoleSection): void
  /** Fetch a section because the user asked. */
  refresh(section: ConsoleSection): void
  /** Run one action, then re-read whatever it invalidated. */
  act(action: ConsoleAction): void
  /** Drop a notice or an error the user has read. */
  dismiss(): void
  dispose(): void
}

/**
 * The one error message a failure produces, whatever kind of failure it was.
 *
 * A deadline is named rather than relayed: `AbortSignal.timeout` raises a
 * DOMException reading "signal timed out", which says nothing about what timed
 * out or that the Host may still be working on it.
 */
function reasonOf(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return 'SwarmDrop 没有回应，请再试一次'
  }
  return error instanceof Error ? error.message : String(error)
}

export function createConsolePort(ctx: ClientContext): ConsolePort {
  const connection = ctx.get('connection') as ConnectionHandle
  const store = createSnapshotStore<ConsoleState>(INITIAL)
  const life = new AbortController()

  function patch(next: Partial<ConsoleState>): void {
    store.set({ ...store.getSnapshot(), ...next })
  }

  /** One call, with the transport's two failure shapes folded into one. */
  async function ask<T>(endpoint: string, payload: unknown, deadlineMs: number): Promise<T> {
    const signal = AbortSignal.any([life.signal, AbortSignal.timeout(deadlineMs)])
    const answer = await connection.rpc.call(PANEL_CHANNEL, endpoint, payload, signal)
    if (!answer.ok) throw new Error(`${answer.error.code}: ${answer.error.message}`)
    return answer.value as T
  }

  async function read(section: ConsoleSection): Promise<void> {
    // Guarded rather than merely disabled in the UI: a tab switch and a refresh
    // click can race, and two reads sharing one key would leave the section
    // marked loading after the first one finished.
    if (store.getSnapshot().loading.includes(section)) return
    patch({ loading: [...store.getSnapshot().loading, section] })
    try {
      const data = await ask<ConsoleData>(
        ENDPOINT_CONSOLE_LOAD, { section }, LOAD_DEADLINE_MS,
      )
      patch({
        loaded: { ...store.getSnapshot().loaded, [section]: data },
        error: null,
      })
    } catch (error) {
      if (life.signal.aborted) return
      patch({ error: reasonOf(error) })
    } finally {
      // Read the *current* set rather than restoring a captured one: another
      // section may have started or finished while this call was in flight.
      patch({ loading: store.getSnapshot().loading.filter(held => held !== section) })
    }
  }

  async function run(action: ConsoleAction): Promise<void> {
    const key = actionKey(action)
    if (store.getSnapshot().busy.includes(key)) return
    patch({
      busy: [...store.getSnapshot().busy, key],
      actionError: null,
      notice: null,
      update: null,
    })
    try {
      const answer = await ask<ConsoleActionAnswer>(
        ENDPOINT_CONSOLE_ACT, action, ACTION_DEADLINE_MS,
      )
      if (!answer.ok) {
        patch({ actionError: answer.message ?? 'the action was refused' })
        return
      }
      patch({ notice: answer.notice ?? null, update: answer.update ?? null })
      // Re-read what this action changed. Which section that is lives on the
      // wire's side (`ACTION_RELOADS`) so a new action cannot forget to say.
      await read(ACTION_RELOADS[action.kind])
    } catch (error) {
      if (life.signal.aborted) return
      patch({ actionError: reasonOf(error) })
    } finally {
      patch({ busy: store.getSnapshot().busy.filter(held => held !== key) })
    }
  }

  return {
    state: store,
    load(section: ConsoleSection): void {
      if (store.getSnapshot().loaded[section] !== undefined) return
      void read(section)
    },
    refresh(section: ConsoleSection): void { void read(section) },
    act(action: ConsoleAction): void { void run(action) },
    dismiss(): void {
      patch({ actionError: null, notice: null, update: null, error: null })
    },
    dispose(): void { life.abort() },
  }
}
