/**
 * Client-safe projection vocabulary.
 *
 * ⚠️ **This file must not import any package *root*.** The browser half compiles
 * in its own TypeScript program, and a root import drags in that package's
 * `Context` augmentation — dsh augments `Context.sessions` differently on the
 * two sides, so one root import makes the whole client program compile against
 * the Node service surface and fail with errors that point nowhere near the
 * cause. Type-only `/types` subpaths carry no such augmentation.
 *
 * dsh's own `token-meter` splits its projection the same way, for the same
 * reason: `projection.ts` is described there as "pure client-safe vocabulary".
 */

/** One referenceable inbox entry, as the browser half sees it. */
export interface InboxReference {
  readonly itemId: string
  /** `files` or `text`. */
  readonly contentKind: string
  /** Device it came from — what the user will recognise in the `@` menu. */
  readonly sourceName: string
  readonly itemCount: number
  readonly totalSize: number
  /** Unix milliseconds — what `new Date()` takes directly. */
  readonly receivedAt: number
}

/** Everything this session can reference from the inbox, newest first. */
export interface SwarmDropInboxProjection {
  readonly items: readonly InboxReference[]
  /** True when older entries exist beyond the ones listed. */
  readonly hasMore: boolean
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** What this session can reference from the SwarmDrop inbox, newest first. */
    swarmdropInbox: SwarmDropInboxProjection
  }
}
