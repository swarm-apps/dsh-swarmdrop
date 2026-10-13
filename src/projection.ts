/**
 * The inbox roll, as a Session **projection** — the fold unit.
 *
 * ## Why a projection rather than folding on the browser side
 *
 * The `@` source needs "what can I reference right now" for one session. The
 * obvious move is to fold the session's events in the browser — but dsh has a
 * seam for exactly this, and it is the better one:
 *
 * > 框架负责驱动，领域负责计算：注册表只订阅一次 `session/event`，并把每个已提交事件
 * > 折叠进每个单元；领域不持有任何订阅，**客户端也从不折叠领域事件——它们收到的是成品值**。
 *
 * Registering a unit here buys three things a hand-rolled browser fold cannot:
 * the framework guarantees the fold runs over *committed* events in log order
 * (so refresh, history paging and replay all agree), the value is cached and
 * pushed as a whole value (last-wins, self-describing), and the client half
 * needs zero code to receive it.
 *
 * It is also not a bypass: nothing here reaches around the event log. The value
 * is derived from it, deterministically, by the framework.
 *
 * ## Three rules the seam imposes, all load-bearing
 *
 * 1. **`apply` must be synchronous and pure.** An async unit would tear the
 *    carriers' consistency cut.
 * 2. **Return the *same reference* for events this unit does not care about.**
 *    An unchanged reference produces zero downstream work; a fresh object on
 *    every unrelated event would push a new value to every client on every
 *    token chunk.
 * 3. **Bump `stateVersion` whenever the state shape or the fold changes.**
 *    Persisted rows from an older unit are otherwise forward-applied into
 *    garbage rather than discarded.
 *
 * The value *vocabulary* lives in `./inbox-projection.ts` — the browser half
 * needs it and must not reach a package root to get it.
 */

import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'

import type { InboxReference, SwarmDropInboxProjection } from './inbox-projection.js'
import type { InboxEntryData } from './types.js'

const referenceSchema = z.object({
  itemId: z.string(),
  contentKind: z.string(),
  sourceName: z.string(),
  itemCount: z.number(),
  totalSize: z.number(),
  receivedAt: z.number(),
})

const projectionSchema = z.object({
  items: z.array(referenceSchema),
  hasMore: z.boolean(),
})

/** Fold state. Plain JSON, because the framework persists it. */
interface InboxRollState {
  readonly items: readonly InboxReference[]
  readonly hasMore: boolean
}

const EMPTY: InboxRollState = { items: [], hasMore: false }

// The host-side table entry: `ProjectionDefinition`'s key constraint reads
// `SessionProjectionStateMap`, so a unit key absent from it does not compile.
// The client-side entry lives in `./inbox-projection.ts` — same module, the
// other interface, exactly as dsh's own token-meter splits its pair.
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    swarmdropInbox: InboxRollState
  }
}

function referenceOf(entry: InboxEntryData): InboxReference {
  return {
    itemId: entry.itemId,
    contentKind: entry.contentKind,
    sourceName: entry.sourceName,
    itemCount: entry.itemCount,
    totalSize: entry.totalSize,
    receivedAt: entry.receivedAt,
  }
}

/**
 * The unit, in the spelling `dsh` 0.2.x reads: `stateSchema` for the persisted
 * fold state and `wire` for the client view (itself split into `viewSchema`
 * for the payload and `view` for the state → payload read).
 *
 * ## Why the old dual spelling is gone
 *
 * This unit used to ship both spellings — `schema`/`view` for the 0.1.x line
 * and `stateSchema`/`wire` for 0.1.1+ — with a cast to smuggle the extra keys
 * past the type it compiled against. The 0.2.x `register` overload takes
 * `Omit<ProjectionDefinition<K, S>, 'wire'> & { wire: … }`, which rejects the
 * old top-level `view` outright: there is no pair of runtimes left to serve
 * with one object, so the unit now speaks only the current contract and the
 * peer range admits only harnesses that read it.
 */
const base: Omit<ProjectionDefinition<'swarmdropInbox', InboxRollState>, 'wire'> & {
  wire: {
    viewSchema: z.ZodType<SwarmDropInboxProjection>
    view(state: InboxRollState): SwarmDropInboxProjection
  }
} = {
  key: 'swarmdropInbox',
  stateSchema: projectionSchema,
  init: () => EMPTY,
  apply: (state, event) => {
    // The baseline is a whole-value checkpoint, so it *replaces* — it is what
    // the inbox held when this conversation began, not something to merge into.
    if (event.type === 'swarmdrop/inbox-baseline') {
      return { items: event.data.items.map(referenceOf), hasMore: event.data.hasMore }
    }
    if (event.type === 'swarmdrop/inbox-received') {
      const item = referenceOf(event.data.item)
      // Guard against a replayed duplicate: the same item must not appear twice
      // in the `@` menu, and the log is the authority on identity.
      if (state.items.some(existing => existing.itemId === item.itemId)) return state
      return { items: [item, ...state.items], hasMore: state.hasMore }
    }
    // ⚠️ Same reference, not a copy — see rule 2 in the module docs. Every
    // assistant token chunk passes through here.
    return state
  },
  wire: { viewSchema: projectionSchema, view: state => state },
  stateVersion: 1,
}

/** The registered unit. */
export const inboxProjectionDefinition = base
