/**
 * How a call looks while it runs, and after.
 *
 * ## What this layer can and cannot do
 *
 * dsh's tool cards are a **closed, provider-neutral vocabulary** — generic,
 * terminal, diff, search, read, web — and a plugin picks one rather than
 * shipping a component. So there is no progress bar and no pause button here:
 * a card is a title, an icon category and some content blocks.
 *
 * That is not a gap to work around. `presentCall` and `presentResult` are
 * **pure functions of the arguments**, run on the live path *and* on replay
 * three months later — a card that read live state would render differently
 * every time the session was reopened. Live progress and the controls for it
 * belong to the conversation row (a real component, fed by the RPC channel)
 * and the panel, both of which can honestly say "right now".
 *
 * What a card *can* do, and what this file is for: say what **this** call is
 * doing, instead of leaving every one of them as "swarmdrop_list_inbox" over a
 * dump of raw arguments.
 *
 * ## Titles name the object, not the verb
 *
 * `Send 3 files to 光印-华为410` rather than `Send files`. A transcript is read
 * back by someone scanning for the moment something went somewhere, and a
 * column of identical verbs makes that scan fail.
 */

import type { GenericCallView, GenericResultView, ToolCallKind } from '@deepseek-ai/dsh-tools'

/**
 * A pending card.
 *
 * `kind` picks the icon a capable UI shows. The vocabulary is dsh's, and the
 * mapping this plugin uses is: reads are `read`, the inbox search is `search`,
 * and everything that changes something on another machine is `other` — there
 * is no "network" category, and borrowing `execute` (shell) or `move`
 * (filesystem) would put a misleading icon on it.
 */
export function pending(title: string, kind: ToolCallKind, rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind, ...rawInput === undefined ? {} : { rawInput } }
}

/**
 * A completed card that only replaces the title.
 *
 * Omitting `content` is deliberate: the model-facing result is already rendered
 * by `output.render`, and repeating it here would put the same text on screen
 * twice. What the completed state adds is the past tense — "Sent 3 files"
 * rather than a spinner's worth of "Sending 3 files…".
 */
export function completed(title: string): GenericResultView {
  return { card: 'generic', title }
}

/**
 * A count and its noun, without the "1 files" that gives away a machine.
 *
 * English-only, like every other string a tool produces: these are read by the
 * model and by whoever is looking at the transcript, and dsh gives a tool no
 * locale. (The panel and the settings page are translated; they are UI.)
 */
export function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`
}

/**
 * A session id, shortened for a card title.
 *
 * Eight characters: enough to tell two transfers apart in one transcript,
 * short enough not to push the rest of the title off a narrow card. The full
 * id stays in `rawInput` for anyone who needs to copy it.
 */
export function shortId(id: string): string {
  return id.slice(0, 8)
}
