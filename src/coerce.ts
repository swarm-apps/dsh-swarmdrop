/**
 * Reading values off the CLI, defensively.
 *
 * ## Why every read goes through here
 *
 * Everything this plugin parses comes from a *separate process* that can be
 * newer than the plugin — the user upgrades `swarmdrop` without reinstalling the
 * plugin, and the CLI is explicit that unknown fields must flow past rather than
 * break a subscription. So a missing or re-typed field has to degrade to a
 * defined value, never throw and never poison a fold.
 *
 * These are five one-liners, and they lived in five places under three sets of
 * names (`str`/`num`, `text`/`number`, `text`/`count`) with identical bodies.
 * Three names for one policy read as three policies — and the moment one of the
 * copies drifts, half the plugin is parsing by a rule nobody wrote down.
 *
 * ## The defaults are not arbitrary
 *
 * `text` and `count` fall back to a *neutral* value (`''`, `0`) because their
 * consumers render them. {@link optional} exists separately for the fields where
 * absence is a fact worth keeping — a node id that has not been assigned yet is
 * not the same as an empty one, and a panel that renders `''` for it looks
 * broken rather than honest.
 *
 * ⚠️ **Both halves import this.** It has no dependencies of its own, so the
 * browser bundle takes it too — `console-wire.ts` reads `text`/`flag` from here
 * and ships in `lib/client.js`. An earlier version of this note claimed the
 * opposite ("would drag `cli.ts`'s module graph into a page"), which was never
 * true and made the file look off-limits to the half that can use it.
 *
 * The browser's own tri-state reading of `online` predates that; it is a second
 * copy with no remaining reason, and merging it is a cleanup waiting to happen.
 */

/** One untrusted JSON object, as the CLI hands it over. */
export type Row = Readonly<Record<string, unknown>>

/** A string field, or `''` when it is absent or not a string. */
export function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * A string field, or `null` when it is absent.
 *
 * For fields where "not set" is a fact the consumer acts on, rather than
 * something to render as blank.
 */
export function optional(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** A finite number, or `0`. NaN and Infinity count as absent. */
export function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** A boolean field, true only when it is literally `true`. */
export function flag(value: unknown): boolean {
  return value === true
}

/** A list of strings, dropping anything that is not one. */
export function list(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** A list of objects, dropping anything that is not one. */
export function rows(value: unknown): Row[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Row => typeof item === 'object' && item !== null)
}

/**
 * How the CLI's three-valued online state reads.
 *
 * **`null` is unknown, not offline.** The distinction is the difference between
 * "your phone is asleep" and "start SwarmDrop", and collapsing it sends the user
 * to debug a network that is fine. Anything that is not a boolean — including a
 * field a newer CLI renamed — is unknown.
 */
export function presence(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/** The three states, spelled the one way both the model and the user see them. */
const PRESENCE_LABELS = {
  true: 'online',
  false: 'offline',
  null: 'unknown',
} as const satisfies Record<string, string>

/**
 * How a presence reads in text.
 *
 * A lookup rather than a nested ternary, and here rather than at each call site:
 * the tool's `output.schema` documents these three literals as its contract, so
 * the command printing a fourth spelling of the same fact would be a quiet
 * inconsistency between two surfaces onto one value.
 */
export function presenceLabel(value: unknown): 'online' | 'offline' | 'unknown' {
  return PRESENCE_LABELS[`${presence(value)}`]
}
