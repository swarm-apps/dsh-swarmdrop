/**
 * The console's wire contract — the settings page, as both halves compile it.
 *
 * ## Why a page at all, when there is already a panel
 *
 * The panel is a *status light*: it lives at the sidebar foot, is always on
 * screen, and answers "is this working". Everything it shows is therefore
 * abbreviated — one listen-address count, an inbox count, no history. That is
 * the right shape for a thing you glance at and the wrong shape for the things
 * you occasionally have to *do*: revoke an invite that leaked, find where a
 * file landed, change the device name, add a relay.
 *
 * dsh's `settings.section` is a full page with its own nav entry, which is
 * where those belong.
 *
 * ## Two endpoints, not twelve
 *
 * Every read is {@link ENDPOINT_CONSOLE_LOAD} with a closed {@link
 * ConsoleSection}, and every write is {@link ENDPOINT_CONSOLE_ACT} with a
 * closed {@link ConsoleAction}. That is **not** generic forwarding — neither
 * union can carry a command this file did not name, so the Host still cannot be
 * asked to run something arbitrary. What it buys is that adding a section is
 * one variant in each union rather than two endpoint constants, two route-table
 * rows and two client methods.
 *
 * ## The page must not poll
 *
 * Every section here costs a `swarmdrop` **process**. The panel can afford a
 * long poll because the Host holds that one open for it; nothing here can. So
 * a section loads when the user first opens it and again when they ask —
 * never on a timer. The live half (node liveness, the device table, pairing)
 * is *not* re-fetched at all: it already arrives on the panel's subscription,
 * and the page reads the same store.
 *
 * ## Every payload is plain JSON
 *
 * Same rule as `panel-wire.ts`: nothing here is a class, a `Date` or a `Map`.
 */

/** Read one section's contents. */
export const ENDPOINT_CONSOLE_LOAD = 'console.load'

/** Perform one of the actions this page offers. */
export const ENDPOINT_CONSOLE_ACT = 'console.act'

/**
 * The sections that have to be fetched.
 *
 * Node liveness and the device table are **not** here: they arrive on the
 * panel's subscription, and re-fetching them would spawn a process to learn
 * something the browser already knows.
 */
export const CONSOLE_SECTIONS = [
  'invites',
  'inbox',
  'transfers',
  'settings',
  'bootstrap',
  'about',
] as const

/** One of {@link CONSOLE_SECTIONS}. */
export type ConsoleSection = typeof CONSOLE_SECTIONS[number]

/** {@link ENDPOINT_CONSOLE_LOAD} request. */
export interface ConsoleLoadRequest {
  readonly section: ConsoleSection
}

/** One invite this machine has issued and not yet revoked. */
export interface InviteRow {
  /** Opaque here; the Host passes it back to `swarmdrop invite revoke`. */
  readonly id: string
  /** Unix seconds. */
  readonly createdAt: number
  readonly expiresAt: number
  /** Already used by a device. Still listed, so its fate is visible. */
  readonly consumed: boolean
}

/** One inbox entry. */
export interface InboxRow {
  readonly id: string
  readonly title: string
  /** Who sent it, as they call themselves. */
  readonly sourceName: string
  /** `file` | `text`, as the CLI classifies it. */
  readonly contentKind: string
  readonly itemCount: number
  readonly totalSize: number
  /** Unix **milliseconds** — the CLI reports inbox times in ms. */
  readonly receivedAt: number
  /** Where it landed. `null` for text, which has no file. */
  readonly rootPath: string | null
  /** The files are gone from disk. Export will fail; say so before they try. */
  readonly missing: boolean
}

/** What a transfer may be told to do. Closed, and checked by the CLI too. */
export type TransferControl = 'pause' | 'resume' | 'cancel'

/** One transfer session. */
export interface TransferRow {
  readonly sessionId: string
  /** `send` | `receive`. */
  readonly direction: string
  readonly peerName: string
  /** `active` | `suspended` | `terminal`, as the CLI reports it. */
  readonly phase: string
  readonly totalSize: number
  readonly transferredBytes: number
  readonly startedAt: number
  /**
   * Which controls apply to this row **right now**.
   *
   * Decided on the Host from the same fields the CLI uses, so a button the page
   * offers is one the CLI will accept. Letting the browser guess would show
   * buttons that refuse on click — and the refusal reads as a bug in SwarmDrop
   * rather than a row that had already finished.
   */
  readonly controls: readonly TransferControl[]
}

/** One configurable scalar, with everything needed to explain its value. */
export interface SettingRow {
  readonly key: string
  /** The value in effect. `null` when the machine can offer none. */
  readonly value: string | null
  /** `env` | `config` | `default`. */
  readonly source: string
  /**
   * What is persisted, when something else is winning.
   *
   * Without it the page could only show a value the user cannot change, and no
   * way to see what they had set — so they edit a field that does nothing.
   */
  readonly configured: string | null
  /** The environment variable holding this value down, when one is. */
  readonly overriddenBy: string | null
}

/** One bootstrap / relay node in the effective list. */
export interface BootstrapRow {
  readonly addr: string
  readonly peerId: string
  /** `builtin` | `custom`. */
  readonly origin: string
  readonly removable: boolean
  /** Transport-level connectivity. `null` when no node is running to probe. */
  readonly connected: boolean | null
  /** `connecting` | `active` | `failed`, or `null` for "not a relay". */
  readonly relay: string | null
  /** The kernel's own words when the relay track failed. Never rewritten. */
  readonly relayError: string | null
}

/** Versions, for the About section. */
export interface AboutRow {
  /** This plugin's own version, from its manifest. */
  readonly plugin: string
  /** The `swarmdrop` binary's version, or `null` when it cannot be run. */
  readonly cli: string | null
}

/**
 * {@link ENDPOINT_CONSOLE_LOAD} answer.
 *
 * Discriminated by `section` so the browser narrows without a cast, and so a
 * stale answer arriving after the user switched tabs can be *recognised* as
 * stale rather than rendered into the wrong page.
 */
export type ConsoleData =
  | { readonly section: 'invites'; readonly invites: readonly InviteRow[] }
  | { readonly section: 'inbox'; readonly items: readonly InboxRow[] }
  | { readonly section: 'transfers'; readonly transfers: readonly TransferRow[] }
  | { readonly section: 'settings'; readonly settings: readonly SettingRow[] }
  | { readonly section: 'bootstrap'; readonly nodes: readonly BootstrapRow[] }
  | { readonly section: 'about'; readonly about: AboutRow }

/**
 * {@link ENDPOINT_CONSOLE_ACT} request.
 *
 * `kind` names the *user's intent*, not the CLI subcommand, so a change on
 * either side stays on that side.
 */
export type ConsoleAction =
  | { readonly kind: 'invite.revoke'; readonly id: string }
  | { readonly kind: 'invite.revokeAll' }
  | { readonly kind: 'inbox.export'; readonly id: string; readonly dir: string }
  | {
    readonly kind: 'transfer.control'
    readonly control: TransferControl
    readonly sessionId: string
  }
  /** `value: null` clears the setting, letting it fall back. */
  | { readonly kind: 'setting.write'; readonly key: string; readonly value: string | null }
  | { readonly kind: 'bootstrap.add'; readonly addr: string }
  | { readonly kind: 'bootstrap.remove'; readonly addr: string }
  | { readonly kind: 'cli.checkUpdate' }

/**
 * What an action answers.
 *
 * Wider than the panel's `ActionAnswer` by exactly one field. Two of these
 * actions produce something worth *saying* on success rather than merely
 * succeeding: an export has a destination the user needs in order to find the
 * files, and an update check's whole point is the answer. Without a place to
 * carry it, the page would have to re-read a section to show what it already
 * knew — or say nothing, which reads as though the click did nothing.
 */
export interface ConsoleActionAnswer {
  readonly ok: boolean
  /** The CLI's own words when it refused. Present only when `ok` is false. */
  readonly message?: string
  /**
   * A **locale-free** fact worth saying on success — today, the directory an
   * export landed in.
   *
   * Only values that read the same in every language belong here. Anything the
   * page would have to phrase gets its own typed field instead ({@link
   * ConsoleActionAnswer.update}), because the Host has no locale and an English
   * status word in a Chinese page is a bug the user sees.
   */
  readonly notice?: string
  /** Present only for an update check. */
  readonly update?: UpdateCheck
}

/**
 * What an update check found.
 *
 * `outcome` is closed so the page can say it in the user's language;
 * `unknown` covers everything the CLI reports that is neither of the two
 * ordinary answers — an externally managed install, or a status a newer CLI
 * added. Claiming one of the two would be worse than admitting neither.
 */
export interface UpdateCheck {
  readonly outcome: 'upToDate' | 'updateAvailable' | 'unknown'
  readonly current: string
  /** The newer version, when there is one. */
  readonly latest: string | null
}

/**
 * Which control an action belongs to.
 *
 * Keyed by **target** as well as verb: two invite rows are two controls, and a
 * slow one has no business greying out its neighbour. That is the same rule the
 * panel learned the hard way — one flag for a whole surface means a single
 * unsettled call takes it hostage.
 *
 * Actions with no target (revoke all, check for updates) key on the verb alone,
 * which is correct: there is only one of each button.
 *
 * Lives on the wire rather than in the browser half because it is derived
 * purely from the action — nothing about a page enters into it.
 *
 * ⚠️ **Every consumer derives its key through this function**, including the
 * components deciding whether to disable a button. Hand-building the string at
 * a call site is a second copy of the format, and when the two drift the
 * failure is silent: the call still runs, the button just never disables.
 */
export function actionKey(action: ConsoleAction): string {
  switch (action.kind) {
    case 'invite.revoke': return `${action.kind}:${action.id}`
    case 'inbox.export': return `${action.kind}:${action.id}`
    case 'transfer.control': return `${action.kind}:${action.control}:${action.sessionId}`
    case 'setting.write': return `${action.kind}:${action.key}`
    case 'bootstrap.remove': return `${action.kind}:${action.addr}`
    case 'bootstrap.add':
    case 'invite.revokeAll':
    case 'cli.checkUpdate': return action.kind
  }
}

/**
 * Which section an action's result invalidates.
 *
 * Lives on the wire's side of the fence because the Host is what knows the
 * action ran; the browser only has to reload the named section. A table rather
 * than a per-action `refresh()` call in the component: forgetting one is
 * silent, and the symptom — a row that stays on screen after being deleted —
 * looks like the delete failed.
 */
export const ACTION_RELOADS: Record<ConsoleAction['kind'], ConsoleSection> = {
  'invite.revoke': 'invites',
  'invite.revokeAll': 'invites',
  'inbox.export': 'inbox',
  'transfer.control': 'transfers',
  'setting.write': 'settings',
  'bootstrap.add': 'bootstrap',
  'bootstrap.remove': 'bootstrap',
  'cli.checkUpdate': 'about',
}
