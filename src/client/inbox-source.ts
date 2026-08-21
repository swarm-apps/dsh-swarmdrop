/**
 * The `@` source: reference something your phone sent you.
 *
 * ## Where the candidates come from
 *
 * From the session **projection** this plugin's Node half registers — not from
 * a loopback call to SwarmDrop, and not from a hand-rolled fold over the event
 * window. dsh's own words for this seam: *"客户端从不折叠领域事件——它们收到的是
 * 成品值"*. The framework drives the fold over committed events in log order,
 * so the `@` menu, a page refresh, and history paging cannot disagree.
 *
 * A loopback call would have been the obvious shortcut and it is the wrong one:
 * it assumes the browser carrier with the Host on the same machine. dsh has
 * three carriers, and the two others break that assumption immediately — as
 * does the case this plugin exists for, someone on their phone reaching a dsh
 * running at home.
 *
 * ## `lexicon` is synchronous and must stay that way
 *
 * The render path scans the draft for `@name` tokens on every keystroke and
 * decorates exact matches. Returning `undefined` means "not warm yet — do not
 * decorate"; it must never mean "let me fetch that for you".
 */

// See the note in `./index.ts` on why this is `ClientContext`.
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ClientSessionContext, InputTriggerCandidate, InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'

import type { InboxReference, SwarmDropInboxProjection } from '../inbox-projection.js'

/** The projection key the Node half owns. */
const KEY = 'swarmdropInbox'

/** A stable, human-typable name for one entry. */
function nameOf(item: InboxReference): string {
  // The item id is a uuid — unusable as an `@` token. The device name plus the
  // short id is recognisable *and* unique, which is what the roll needs: the
  // decoration pass matches these strings literally.
  return `${item.sourceName.replace(/\s+/gu, '-')}-${item.itemId.slice(0, 8)}`
}

/** Human-readable size, for the menu row only. */
function size(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  const units = ['KiB', 'MiB', 'GiB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${value.toFixed(1)} ${String(units[unit])}`
}

/** Narrow the projection's untyped face. */
function isProjection(value: unknown): value is SwarmDropInboxProjection {
  return typeof value === 'object' && value !== null && Array.isArray((value as { items?: unknown }).items)
}

/**
 * Build the `@swarmdrop` source.
 *
 * @param ctx - the client root context (sessions live on it).
 * @returns the source, ready for `inputTriggers.registerSource`.
 */
export function createInboxSource(ctx: ClientContext): InputTriggerSource {
  /** The projection face for one session, or undefined when it is not resolvable. */
  const faceOf = (sessionId: SessionId) => {
    const scope = ctx.sessions.scope(sessionId)
    if (scope === undefined) return undefined
    return ctx.sessions.sessionOf(scope)?.projections.faceOf(KEY)
  }

  const itemsOf = (session: ClientSessionContext): readonly InboxReference[] | undefined => {
    const snapshot = faceOf(session.sessionId)?.getSnapshot()
    // `undefined` is "not warm yet", and it has to stay distinguishable from
    // "warm and empty": the former means do not decorate, the latter means
    // there is genuinely nothing to reference.
    if (snapshot === undefined) return undefined
    return isProjection(snapshot) ? snapshot.items : []
  }

  return {
    trigger: '@',
    name: 'SwarmDrop',
    // Below the built-in file source: a path is what people reach for first,
    // and pushing this group above it would make `@` feel hijacked.
    order: 10,

    candidates(session, { query }): Promise<readonly InputTriggerCandidate[]> {
      const items = itemsOf(session) ?? []
      const needle = query.trim().toLowerCase()
      const matched = needle === ''
        ? items
        : items.filter(item =>
          nameOf(item).toLowerCase().includes(needle)
          || item.sourceName.toLowerCase().includes(needle))
      return Promise.resolve(matched.map(item => ({
        name: nameOf(item),
        description: `${String(item.itemCount)} item(s), ${size(item.totalSize)} from ${item.sourceName}`,
      })))
    },

    onPick({ candidate }) {
      // Plain text rather than a chip: the decoration pass rebuilds the chip
      // from `lexicon`, so the draft stays copy-pasteable and the reference
      // survives a round trip through the clipboard.
      return { text: `@${candidate.name} ` }
    },

    lexicon(session) {
      const items = itemsOf(session)
      return items?.map(nameOf)
    },

    subscribeLexicon(session, listener) {
      const face = faceOf(session.sessionId)
      if (face === undefined) return () => {}
      return face.subscribe(listener)
    },
  }
}
