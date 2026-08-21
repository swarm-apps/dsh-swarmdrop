/**
 * The console's Host half: one read route, one write route.
 *
 * These mount on the **panel's** channel rather than one of their own. A second
 * channel would be a second `rpc.handle` registration, a second authority
 * decision and a second teardown path, for two more routes reaching the same
 * binary on the same machine — the channel is a transport seat, not a
 * namespace.
 *
 * ## Every route is a projection, never a forward
 *
 * `swarmdrop`'s `--json` objects carry everything its own terminal output
 * needs — twenty-odd fields on a transfer, a dozen on an inbox item. Passing
 * one through would make all of them part of this page's contract, so each
 * route names the handful it draws (`console-wire.ts`) and lets the rest change
 * freely. That is also what makes an older CLI degrade instead of crash: a
 * field it does not send reads as absent, not as a parse failure.
 *
 * ## Version skew is a first-class outcome
 *
 * A user can upgrade this plugin without upgrading `swarmdrop` — they are
 * separate packages on separate release lines. The sections that need a newer
 * CLI say so in one sentence ({@link needsCli}) instead of surfacing clap's
 * usage text, which reads as though the user typed something wrong.
 */

import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { createRequire } from 'node:module'

import { call, cliVersion, SwarmDropError } from './cli.js'
import { count, flag, optional, presence, rows, text, type Row } from './coerce.js'
import {
  ENDPOINT_CONSOLE_ACT, ENDPOINT_CONSOLE_LOAD,
  type AboutRow, type BootstrapRow, type ConsoleAction, type ConsoleData,
  type ConsoleActionAnswer, type ConsoleLoadRequest, type ConsoleSection, type InboxRow,
  type InviteRow, type SettingRow, type TransferControl, type TransferRow, type UpdateCheck,
} from './console-wire.js'


/**
 * The `swarmdrop` version each capability first appeared in.
 *
 * Only the ones that can actually be missing are listed — everything else has
 * been there since the CLI's first release, and claiming a floor for it would
 * be a number nobody verified.
 */
const CONFIG_SURFACE_SINCE = '0.6.0'

/** Which sections need a CLI newer than the floor. */
const SECTION_NEEDS: Partial<Record<ConsoleSection, string>> = {
  settings: CONFIG_SURFACE_SINCE,
  bootstrap: CONFIG_SURFACE_SINCE,
}

/** Which actions need a CLI newer than the floor. */
const ACTION_NEEDS: Partial<Record<ConsoleAction['kind'], string>> = {
  'setting.write': CONFIG_SURFACE_SINCE,
  'bootstrap.add': CONFIG_SURFACE_SINCE,
  'bootstrap.remove': CONFIG_SURFACE_SINCE,
}

/**
 * Whether this failure is "that CLI has never heard of this command".
 *
 * clap answers an unknown subcommand or flag with a **usage error** (exit 2)
 * whose text is about argument parsing. Relayed as-is it reads as though the
 * user mistyped something, and the user typed nothing at all — they clicked a
 * button in a settings page.
 *
 * Matching on clap's wording is admittedly a string test, but the alternative
 * (probe `--version` before every call) spawns a second process per action to
 * pre-empt a case that is rare and self-describing. The fallback is safe: an
 * unmatched message is relayed unchanged.
 */
export function isUnknownToCli(error: SwarmDropError): boolean {
  if (error.exitCode !== 2) return false
  return /unrecognized subcommand|unexpected argument|invalid value|unknown argument/i
    .test(error.message)
}

/**
 * Run something, and translate "your CLI is too old" into one sentence.
 *
 * `since` is `undefined` for everything that has always existed — those calls
 * pass through untouched rather than being wrapped in a claim about versions.
 */
async function needsCli<T>(since: string | undefined, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (since !== undefined && error instanceof SwarmDropError && isUnknownToCli(error)) {
      const installed = await cliVersion()
      throw new SwarmDropError(
        installed === null
          ? `这项需要 swarmdrop ${since} 或更新的版本`
          : `这项需要 swarmdrop ${since} 或更新的版本（当前 ${installed}）`,
        error.exitCode,
      )
    }
    throw error
  }
}

/** Read one section. */
export async function loadConsole(payload: unknown): Promise<ConsoleData> {
  const section = sectionOf(payload)
  return needsCli(SECTION_NEEDS[section], () => LOADERS[section]())
}

/** Perform one action, reporting a refusal as an outcome rather than a fault. */
export async function actConsole(payload: unknown): Promise<ConsoleActionAnswer> {
  const action = payload as ConsoleAction | null
  if (action === null || typeof action !== 'object') {
    return { ok: false, message: 'no action was given' }
  }
  try {
    const outcome = await needsCli(ACTION_NEEDS[action.kind], () => perform(action))
    return { ok: true, ...outcome }
  } catch (error) {
    // Same split as the panel's `attempt`: a refusal by the CLI is a fact about
    // the machine, anything else is a genuine transport-level fault.
    if (error instanceof SwarmDropError) return { ok: false, message: error.message }
    throw error
  }
}

/**
 * Decode the requested section, defaulting rather than throwing.
 *
 * A browser this bundle did not ship cannot reach here, so an unknown value
 * means a bug — and a page showing invites is a better outcome than one showing
 * a stack trace.
 */
function sectionOf(payload: unknown): ConsoleSection {
  const asked = (payload as ConsoleLoadRequest | null)?.section
  return asked !== undefined && asked in LOADERS ? asked : 'invites'
}

type Loader = () => Promise<ConsoleData>

const LOADERS: Record<ConsoleSection, Loader> = {
  invites: async () => ({
    section: 'invites',
    invites: invitesOf(await call<unknown>(['invite', 'list'])),
  }),
  inbox: async () => ({ section: 'inbox', items: inboxOf(await call<unknown>(['inbox', 'list'])) }),
  transfers: async () => ({
    section: 'transfers',
    transfers: transfersOf(await call<unknown>(['transfer', 'list'])),
  }),
  settings: async () => ({
    section: 'settings',
    settings: settingsOf(await call<unknown>(['config', 'list'])),
  }),
  bootstrap: async () => ({
    section: 'bootstrap',
    nodes: bootstrapOf(await call<unknown>(['bootstrap', 'list'])),
  }),
  about: async () => ({ section: 'about', about: await about() }),
}

function invitesOf(raw: unknown): readonly InviteRow[] {
  return rows(raw).map((row): InviteRow => ({
    id: text(row['id']),
    createdAt: count(row['createdAt']),
    expiresAt: count(row['expiresAt']),
    consumed: flag(row['consumed']),
  }))
}

function inboxOf(raw: unknown): readonly InboxRow[] {
  return rows(raw).map((row): InboxRow => ({
    id: text(row['id']),
    title: text(row['title']),
    sourceName: text(row['sourceName']),
    contentKind: text(row['contentKind']),
    itemCount: count(row['itemCount']),
    totalSize: count(row['totalSize']),
    receivedAt: count(row['receivedAt']),
    rootPath: optional(row['rootPath']),
    missing: flag(row['missing']),
  }))
}

/**
 * Which controls apply to a transfer row.
 *
 * Decided here rather than in the browser so the page offers only buttons the
 * CLI will accept. It mirrors `Control::applies` in the CLI exactly:
 *
 * | control | when |
 * |---|---|
 * | pause | `active` — pausing needs a running actor |
 * | resume | `suspended` **and** recoverable — an unrecoverable break can only be re-sent |
 * | cancel | `offered` / `waitingAccept` / `active` — the three "started, not finished" phases |
 *
 * ⚠️ **`suspended` is not cancellable**, tempting as it looks: there is no live
 * actor to cancel, and the CLI refuses. Offering the button anyway would make
 * SwarmDrop look broken for a row that is merely already stopped.
 */
export function controlsOf(row: Row): readonly TransferControl[] {
  const phase = text(row['phase'])
  const controls: TransferControl[] = []
  if (phase === 'active') controls.push('pause')
  if (phase === 'suspended' && flag(row['recoverable'])) controls.push('resume')
  if (phase === 'offered' || phase === 'waiting_accept' || phase === 'active') {
    controls.push('cancel')
  }
  return controls
}

function transfersOf(raw: unknown): readonly TransferRow[] {
  return rows(raw).map((row): TransferRow => ({
    sessionId: text(row['sessionId']),
    direction: text(row['direction']),
    peerName: text(row['peerName']),
    phase: text(row['phase']),
    totalSize: count(row['totalSize']),
    transferredBytes: count(row['transferredBytes']),
    startedAt: count(row['startedAt']),
    controls: controlsOf(row),
  }))
}

function settingsOf(raw: unknown): readonly SettingRow[] {
  return rows(raw).map((row): SettingRow => ({
    key: text(row['key']),
    value: optional(row['value']),
    source: text(row['source']),
    configured: optional(row['configured']),
    overriddenBy: optional(row['overriddenBy']),
  }))
}

/**
 * Flatten the CLI's per-peer link into the two fields the page draws.
 *
 * The relay track is a tagged union (`connecting` / `active` / `failed`), and
 * `lastError` is the **only** thing on either side that says why a relay will
 * not come up. It is carried verbatim: rewriting it would cost the user the one
 * string worth pasting into an issue.
 */
function bootstrapOf(raw: unknown): readonly BootstrapRow[] {
  return rows(raw).map((row): BootstrapRow => {
    const link = row['link']
    const linkRow: Row = typeof link === 'object' && link !== null ? link as Row : {}
    const relay = linkRow['relay']
    const relayRow: Row = typeof relay === 'object' && relay !== null ? relay as Row : {}
    return {
      addr: text(row['addr']),
      peerId: text(row['peerId']),
      origin: text(row['origin']),
      removable: flag(row['removable']),
      // Tri-state: `null` is "no node has been running to probe with", which is
      // not the same as "not connected" — see `presence`.
      connected: link === undefined || link === null ? null : presence(linkRow['connected']),
      relay: optional(relayRow['kind']),
      relayError: optional(relayRow['lastError']),
    }
  })
}

/** This plugin's own version, read from the manifest that shipped with it. */
function pluginVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    // `../package.json` from either `lib/console.js` or `src/console.ts` is the
    // package root, so this resolves the same in a published install and in a
    // source checkout.
    const manifest = require('../package.json') as { version?: unknown }
    return text(manifest.version)
  } catch {
    return ''
  }
}

async function about(): Promise<AboutRow> {
  return { plugin: pluginVersion(), cli: await cliVersion() }
}

/** What an action leaves behind for the page to say, beyond having worked. */
type Outcome = Pick<ConsoleActionAnswer, 'notice' | 'update'>

/**
 * Run one action, answering with whatever the page should say about it.
 *
 * Every arm is a named CLI call; nothing here composes commands or interpolates
 * user input into one.
 */
async function perform(action: ConsoleAction): Promise<Outcome> {
  switch (action.kind) {
    case 'invite.revoke':
      await call<unknown>(['invite', 'revoke', requireText(action.id, 'invite')])
      return {}
    case 'invite.revokeAll':
      // `--yes` because the confirmation it skips is a *terminal* prompt, and
      // the user already confirmed in the page. Without it the CLI would block
      // on a question nobody here can answer.
      await call<unknown>(['invite', 'revoke', '--all', '--yes'])
      return {}
    case 'inbox.export': {
      // Resolved once and reported back: the page asked for `~/Downloads` and
      // the files landed in an absolute path — saying which is the difference
      // between "exported" and "exported, and here is where to look".
      const dir = resolveDir(action.dir)
      await call<unknown>(['inbox', 'export', requireText(action.id, 'item'), dir])
      return { notice: dir }
    }
    case 'transfer.control':
      await call<unknown>([
        'transfer', action.control, requireText(action.sessionId, 'transfer'),
      ])
      return {}
    case 'setting.write': {
      const key = requireText(action.key, 'setting')
      // The CLI reports whether the write is in effect yet (`applied` /
      // `pendingStart` / `overridden`); the page re-reads the section anyway,
      // so what is carried back is only the part the section cannot show —
      // nothing, for a write that took effect.
      await call<unknown>(action.value === null
        ? ['config', 'unset', key]
        : ['config', 'set', key, action.value])
      return {}
    }
    case 'bootstrap.add':
      await call<unknown>(['bootstrap', 'add', requireText(action.addr, 'address')])
      return {}
    case 'bootstrap.remove':
      await call<unknown>(['bootstrap', 'remove', requireText(action.addr, 'address')])
      return {}
    case 'cli.checkUpdate':
      return { update: updateCheck(await call<Row>(['update', '--check'])) }
  }
}

/**
 * What an update check found.
 *
 * Read from `status` rather than the exit code: the CLI is explicit that
 * "a new version exists" is **not** a failure, so the exit code is 0 either way
 * and using it would make "no network" and "there is an update" the same event.
 *
 * Anything that is neither of the two ordinary answers — an externally managed
 * install, or a status a newer CLI added — reads as `unknown` rather than being
 * forced into one of them.
 */
export function updateCheck(row: Row): UpdateCheck {
  const status = text(row['status'])
  const current = text(row['currentVersion'])
  if (status === 'updateAvailable') {
    return { outcome: 'updateAvailable', current, latest: text(row['latestVersion']) }
  }
  if (status === 'upToDate') return { outcome: 'upToDate', current, latest: null }
  return { outcome: 'unknown', current, latest: null }
}

/**
 * Refuse an empty target instead of forwarding it.
 *
 * Every one of these subcommands opens an **interactive picker** when its
 * argument is missing, and there is no terminal here to answer it — the call
 * would hang until the two-minute timeout and then report a timeout, which says
 * nothing about the real problem.
 */
function requireText(value: unknown, what: string): string {
  const trimmed = text(value).trim()
  if (trimmed === '') throw new SwarmDropError(`no ${what} was named`, 2)
  return trimmed
}

/**
 * Turn what the user typed into a directory the CLI can use.
 *
 * `~` is expanded here because the CLI is spawned directly, with **no shell in
 * between** — a literal `~/Downloads` would make the CLI create a directory
 * actually named `~`, and the exported files would land somewhere the user
 * cannot find. A relative path is resolved against the home directory for the
 * same reason: this page has no working directory the user could reason about.
 */
export function resolveDir(raw: unknown): string {
  const value = text(raw).trim()
  if (value === '') throw new SwarmDropError('no destination was given', 2)
  if (value === '~') return homedir()
  if (value.startsWith('~/')) return join(homedir(), value.slice(2))
  return isAbsolute(value) ? value : join(homedir(), value)
}

/** The console's two routes, for the panel channel's table. */
export const CONSOLE_ROUTES = {
  [ENDPOINT_CONSOLE_LOAD]: ({ payload }: { payload: unknown }) => loadConsole(payload),
  [ENDPOINT_CONSOLE_ACT]: ({ payload }: { payload: unknown }) => actConsole(payload),
}
