/**
 * The console's seven pages.
 *
 * One file rather than seven because they are seven *views of one subsystem*
 * and share every element they draw with ({@link ./console-ui.tsx}) — split up,
 * the shared props alone would be more code than the sections.
 *
 * ## What each page is for, and what it must not become
 *
 * | Page | Answers |
 * |---|---|
 * | Overview | "is it working, and who is it paired with" — the panel's facts, unabbreviated |
 * | Invites | "what have I handed out, and how do I take it back" |
 * | Inbox | "what arrived, and where did it land" |
 * | Transfers | "what is moving, and can I stop it" |
 * | Settings | "what is this machine called, and where do files land" |
 * | Bootstrap | "how does this reach the outside, and why can't it" |
 * | About | "which versions am I running" |
 *
 * None of them polls. A section is read when opened and when the user asks —
 * see `console-wire.ts` for why that is a rule and not a default.
 */

import { useCallback, useState } from 'react'
import {
  Button, IconCheckOutline16, IconPlayOutline16, IconPlusOutline16, IconStopFill16,
  IconTrashOutline16, StateDot, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'

import {
  Copyable, Empty, Fact, Group,
  cardStyle, errorStyle, inputStyle, listStyle, monoStyle, mutedStyle, rowStyle,
} from './console-ui.js'
import { formatSize, versionSkew } from './format.js'
import type { ConsoleState } from './console-port.js'
import {
  actionKey,
  type AboutRow, type BinarySource, type BootstrapRow, type ConsoleAction, type ConsoleData,
  type ConsoleSection, type InboxRow, type InviteRow, type SettingRow, type TransferControl,
  type TransferRow,
} from '../console-wire.js'
import type { SwarmDropKey } from './locales.js'
import type { PanelState } from './panel-port.js'
import { deviceKey } from './panel-port.js'
import type { SwarmDropConsoleProps } from './console.js'

/** Translator bound to this plugin's dictionary. */
export type Translate = SwarmDropConsoleProps['t']

/** What every section is handed. */
export interface SectionProps {
  readonly t: Translate
  readonly console: ConsoleState
  readonly act: (action: ConsoleAction) => void
  readonly refresh: (section: ConsoleSection) => void
}

/**
 * Read one section's data out of the store, narrowed.
 *
 * The store holds every loaded section under one key, so the discriminant has
 * to be re-checked here: a stale answer for a section the user has left could
 * otherwise be rendered into the page they are now looking at.
 */
function dataOf<S extends ConsoleSection>(
  state: ConsoleState, section: S,
): Extract<ConsoleData, { section: S }> | undefined {
  const data = state.loaded[section]
  return data?.section === section
    ? data as Extract<ConsoleData, { section: S }>
    : undefined
}

/** The refresh control every fetched section carries. */
function Refresh({ section, t, console: state, refresh }: SectionProps & { section: ConsoleSection }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={state.loading.includes(section)}
      onClick={() => { refresh(section) }}
    >
      {t('refresh')}
    </Button>
  )
}

/**
 * What a fetched section shows before its first answer.
 *
 * "Loading" and "nothing here" are different facts and look identical when both
 * are blank — a user who sees an empty invite list has to know which one it is
 * before deciding whether something is wrong.
 */
function Pending({ section, t, console: state, children }: SectionProps & {
  section: ConsoleSection
  children: React.ReactNode
}) {
  if (dataOf(state, section) === undefined) {
    return <Empty>{state.loading.includes(section) ? t('loading') : t('notLoaded')}</Empty>
  }
  return <>{children}</>
}

// ─────────────────────────────────────────────────────────────── overview ────

/** What the node dot says. Mirrors the panel's, for the same reasons. */
function nodeDot(panel: PanelState): StateDotState {
  if (!panel.ready) return 'ongoing'
  return panel.nodeRunning ? 'done' : 'warning'
}

/**
 * Node, network and devices — the panel's facts without the abbreviation.
 *
 * Reads the **panel's** store rather than fetching: node liveness and the
 * device table already arrive on the subscription the panel keeps parked, and
 * asking again would spawn a process to learn what the browser already knows.
 */
export function OverviewSection({ panel, t, onStartNode, onStopNode, onForget }: {
  panel: PanelState
  t: Translate
  onStartNode: () => void
  onStopNode: () => void
  onForget: (peerId: string) => void
}) {
  const status = !panel.ready
    ? t('nodeUnknown')
    : panel.nodeRunning ? t('nodeRunning') : t('nodeStopped')

  return (
    <>
      <Group title={t('node')}>
        <div style={rowStyle}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <StateDot state={nodeDot(panel)} size={8} />
            {status}
          </span>
          {panel.nodeRunning ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={panel.busy.includes('node')}
              onClick={onStopNode}
              icon={<IconStopFill16 />}
            >
              {t('stop')}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={panel.busy.includes('node')}
              onClick={onStartNode}
              icon={<IconPlayOutline16 />}
            >
              {t('start')}
            </Button>
          )}
        </div>
        {panel.network?.peerId != null && (
          <Copyable value={panel.network.peerId} label={t('copyNodeId')} />
        )}
      </Group>

      {/* Hidden while stopped: every field would read "unknown" or "none",
          which is four lines repeating what the node row already said. */}
      {panel.nodeRunning && panel.network !== null && (
        <Group title={t('network')}>
          <Fact label={t('nat')}>{panel.network.natStatus}</Fact>
          <Fact label={t('relay')}>
            {panel.network.relayReady ? t('relayReady') : t('relayWaiting')}
          </Fact>
          <Fact label={t('bootstrap')}>
            {panel.network.bootstrapConnected ? t('bootstrapConnected') : t('bootstrapWaiting')}
          </Fact>
          <Fact label={t('peers')}>{panel.network.connectedPeers}</Fact>
          {panel.network.publicAddr != null && (
            <Copyable value={panel.network.publicAddr} label={t('copyAddress')} />
          )}
          <div style={mutedStyle}>{t('listen')}</div>
          {panel.network.listenAddrs.length === 0
            ? <Empty>{t('noListenAddrs')}</Empty>
            : panel.network.listenAddrs.map(addr => (
              <Copyable key={addr} value={addr} label={t('copyAddress')} />
            ))}
        </Group>
      )}

      <Group title={t('devices')}>
        {panel.devices.length === 0
          ? <Empty>{t('noDevices')}</Empty>
          : (
            <div style={listStyle}>
              {panel.devices.map(device => (
                <div key={device.peerId} style={cardStyle}>
                  <div style={rowStyle}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {/* Three states, never two: `null` is "nobody has probed",
                          and showing it as offline sends the user to debug a
                          network that is fine. */}
                      <StateDot
                        state={device.online === null
                          ? 'ongoing'
                          : device.online ? 'done' : 'warning'}
                        size={8}
                      />
                      {device.name === '' ? t('unnamedDevice') : device.name}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={panel.busy.includes(deviceKey(device.peerId))}
                      onClick={() => { onForget(device.peerId) }}
                      icon={<IconTrashOutline16 />}
                    >
                      {t('forget')}
                    </Button>
                  </div>
                  <Copyable value={device.peerId} label={t('copyNodeId')} />
                </div>
              ))}
            </div>
          )}
      </Group>
    </>
  )
}

// ──────────────────────────────────────────────────────────────── invites ────

/** Whole minutes until `expiresAt`, or 0 once it is past. */
function minutesLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.round((expiresAt * 1_000 - now) / 60_000))
}

/**
 * Invites this machine has issued.
 *
 * The most important page here, and the reason the console exists at all: an
 * invite is valid for 24 hours, survives restarts, and is a **bearer token** —
 * whoever holds it can pair. Revoking is the only way to take one back, and
 * before this page the CLI was the only place to do it.
 */
export function InvitesSection(props: SectionProps) {
  const { t, console: state, act } = props
  const data = dataOf(state, 'invites')
  const now = Date.now()

  return (
    <Group
      title={t('invites')}
      action={
        <div style={{ display: 'flex', gap: 4 }}>
          {data !== undefined && data.invites.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              disabled={state.busy.includes(actionKey({ kind: 'invite.revokeAll' }))}
              onClick={() => { act({ kind: 'invite.revokeAll' }) }}
            >
              {t('revokeAll')}
            </Button>
          )}
          <Refresh {...props} section="invites" />
        </div>
      }
    >
      <div style={mutedStyle}>{t('invitesHint')}</div>
      <Pending {...props} section="invites">
        {data !== undefined && (data.invites.length === 0
          ? <Empty>{t('noInvites')}</Empty>
          : (
            <div style={listStyle}>
              {data.invites.map(invite => (
                <InviteCard
                  key={invite.id}
                  invite={invite}
                  now={now}
                  busy={state.busy.includes(actionKey({ kind: 'invite.revoke', id: invite.id }))}
                  onRevoke={() => { act({ kind: 'invite.revoke', id: invite.id }) }}
                  t={t}
                />
              ))}
            </div>
          ))}
      </Pending>
    </Group>
  )
}

function InviteCard({ invite, now, busy, onRevoke, t }: {
  invite: InviteRow
  now: number
  busy: boolean
  onRevoke: () => void
  t: Translate
}) {
  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        <span>
          {invite.consumed
            ? t('inviteConsumed')
            : t('inviteExpiresIn', { minutes: minutesLeft(invite.expiresAt, now) })}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={onRevoke}
          icon={<IconTrashOutline16 />}
        >
          {t('revoke')}
        </Button>
      </div>
      {/* The id is short enough to read and is what `swarmdrop invite revoke`
          takes, so someone working in a terminal can act on what they see. */}
      <div style={monoStyle}>{invite.id.slice(0, 16)}</div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────── inbox ────

/**
 * What arrived, and where it landed.
 *
 * The path matters more than it looks: the CLI accepts files automatically once
 * a device is paired, so the user often does not know a file arrived at all,
 * let alone which directory it went to.
 */
export function InboxSection(props: SectionProps) {
  const { t, console: state, act } = props
  const data = dataOf(state, 'inbox')

  return (
    <Group title={t('inbox')} action={<Refresh {...props} section="inbox" />}>
      <Pending {...props} section="inbox">
        {data !== undefined && (data.items.length === 0
          ? <Empty>{t('inboxEmpty')}</Empty>
          : (
            <div style={listStyle}>
              {data.items.map(item => (
                <InboxCard
                  key={item.id}
                  item={item}
                  busy={state.busy.includes(
                    actionKey({ kind: 'inbox.export', id: item.id, dir: '' }),
                  )}
                  onExport={dir => { act({ kind: 'inbox.export', id: item.id, dir }) }}
                  t={t}
                />
              ))}
            </div>
          ))}
      </Pending>
    </Group>
  )
}

function InboxCard({ item, busy, onExport, t }: {
  item: InboxRow
  busy: boolean
  onExport: (dir: string) => void
  t: Translate
}) {
  const [dir, setDir] = useState('~/Downloads')
  const [exporting, setExporting] = useState(false)

  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        <strong style={{ minWidth: 0, wordBreak: 'break-word' }}>{item.title}</strong>
        <span style={mutedStyle}>{formatSize(item.totalSize)}</span>
      </div>
      <div style={mutedStyle}>
        {t('inboxFrom', { device: item.sourceName })}
        {' · '}
        {/* The CLI reports inbox times in milliseconds — see `InboxRow`. */}
        {new Date(item.receivedAt).toLocaleString()}
      </div>
      {item.rootPath !== null && <Copyable value={item.rootPath} label={t('copyPath')} />}
      {/* Stated before they try: exporting an entry whose files are gone fails
          with a filesystem error that reads like a bug in SwarmDrop. */}
      {item.missing && <div style={errorStyle}>{t('inboxMissing')}</div>}
      {!item.missing && (exporting ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            style={inputStyle}
            value={dir}
            onChange={event => { setDir(event.target.value) }}
            aria-label={t('exportTo')}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy || dir.trim() === ''}
            onClick={() => { onExport(dir) }}
          >
            {t('export')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setExporting(false) }}>
            {t('cancel')}
          </Button>
        </div>
      ) : (
        <div>
          <Button variant="ghost" size="sm" onClick={() => { setExporting(true) }}>
            {t('export')}
          </Button>
        </div>
      ))}
    </div>
  )
}

// ────────────────────────────────────────────────────────────── transfers ────

/** The label for one control. Exhaustive, so an added control fails to compile. */
const CONTROL_KEYS: Record<TransferControl, SwarmDropKey> = {
  pause: 'pause',
  resume: 'resume',
  cancel: 'cancelTransfer',
}

/** Transfer history, with the controls that apply to each row. */
export function TransfersSection(props: SectionProps) {
  const { t, console: state, act } = props
  const data = dataOf(state, 'transfers')

  return (
    <Group title={t('transfers')} action={<Refresh {...props} section="transfers" />}>
      <Pending {...props} section="transfers">
        {data !== undefined && (data.transfers.length === 0
          ? <Empty>{t('noTransfers')}</Empty>
          : (
            <div style={listStyle}>
              {data.transfers.map(row => (
                <TransferCard
                  key={row.sessionId}
                  row={row}
                  busy={state.busy}
                  onControl={control => {
                    act({ kind: 'transfer.control', control, sessionId: row.sessionId })
                  }}
                  t={t}
                />
              ))}
            </div>
          ))}
      </Pending>
    </Group>
  )
}

function TransferCard({ row, busy, onControl, t }: {
  row: TransferRow
  busy: readonly string[]
  onControl: (control: TransferControl) => void
  t: Translate
}) {
  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        <span style={{ minWidth: 0, wordBreak: 'break-word' }}>
          {row.direction === 'send' ? t('directionSend') : t('directionReceive')}
          {' · '}
          {row.peerName === '' ? t('unnamedDevice') : row.peerName}
        </span>
        <span style={mutedStyle}>{row.phase}</span>
      </div>
      <div style={mutedStyle}>
        {formatSize(row.transferredBytes)} / {formatSize(row.totalSize)}
      </div>
      {row.controls.length > 0 && (
        <div style={{ display: 'flex', gap: 4 }}>
          {row.controls.map(control => (
            <Button
              key={control}
              variant="ghost"
              size="sm"
              disabled={busy.includes(
                actionKey({ kind: 'transfer.control', control, sessionId: row.sessionId }),
              )}
              onClick={() => { onControl(control) }}
            >
              {t(CONTROL_KEYS[control])}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────── settings ────

/**
 * How a value's origin reads, and what each setting is called.
 *
 * Lookups keyed by the CLI's own strings, with a fallback to the raw string:
 * the closed set lives in the CLI, and a newer one adding a setting must render
 * as *that setting's key* rather than as a blank label or a thrown error.
 */
const SOURCE_KEYS: Readonly<Record<string, SwarmDropKey>> = {
  env: 'sourceEnv',
  config: 'sourceConfig',
  default: 'sourceDefault',
}

/** Display name for each configurable scalar. See {@link SOURCE_KEYS}. */
const SETTING_KEYS: Readonly<Record<string, SwarmDropKey>> = {
  'device-name': 'settingDeviceName',
  'receive-dir': 'settingReceiveDir',
}

/** This machine's device name and where received files land. */
export function SettingsSection(props: SectionProps) {
  const { t, console: state, act } = props
  const data = dataOf(state, 'settings')

  return (
    <Group title={t('settings')} action={<Refresh {...props} section="settings" />}>
      <Pending {...props} section="settings">
        {data?.settings.map(setting => (
          <SettingEditor
            key={setting.key}
            setting={setting}
            busy={state.busy.includes(
              actionKey({ kind: 'setting.write', key: setting.key, value: null }),
            )}
            onWrite={value => { act({ kind: 'setting.write', key: setting.key, value }) }}
            t={t}
          />
        ))}
      </Pending>
    </Group>
  )
}

/**
 * One editable setting.
 *
 * ## The field shows what is *persisted*, not what is in effect
 *
 * When an environment variable is winning, those are two different strings, and
 * the field must hold the one the user can change — otherwise editing it looks
 * like it did nothing, and they do it again. What is actually in effect is
 * stated above it, along with the variable holding it down.
 */
function SettingEditor({ setting, busy, onWrite, t }: {
  setting: SettingRow
  busy: boolean
  onWrite: (value: string | null) => void
  t: Translate
}) {
  const persisted = setting.configured ?? ''
  const [draft, setDraft] = useState(persisted)
  const [editing, setEditing] = useState(false)

  const start = useCallback(() => {
    setDraft(setting.configured ?? setting.value ?? '')
    setEditing(true)
  }, [setting.configured, setting.value])

  const sourceKey = SOURCE_KEYS[setting.source]
  const nameKey = SETTING_KEYS[setting.key]
  const overridden = setting.overriddenBy !== null

  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        <strong>{nameKey === undefined ? setting.key : t(nameKey)}</strong>
        {!editing && (
          <Button variant="ghost" size="sm" onClick={start}>{t('edit')}</Button>
        )}
      </div>
      <Fact label={t('inEffect')}>{setting.value ?? t('valueUnset')}</Fact>
      <div style={mutedStyle}>{sourceKey === undefined ? setting.source : t(sourceKey)}</div>
      {/* The one thing a value-only view cannot say: that editing this field
          will not change anything until the variable goes away. */}
      {overridden && (
        <div style={errorStyle}>
          {t('overriddenBy', { variable: setting.overriddenBy ?? '' })}
        </div>
      )}
      {editing && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            style={inputStyle}
            value={draft}
            onChange={event => { setDraft(event.target.value) }}
            aria-label={t('edit')}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy || draft.trim() === ''}
            onClick={() => { onWrite(draft); setEditing(false) }}
            icon={<IconCheckOutline16 />}
          >
            {t('save')}
          </Button>
          {/* Clearing is its own action, not "save an empty string": the CLI
              refuses a blank value, and what the user means is "fall back". */}
          {persisted !== '' && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => { onWrite(null); setEditing(false) }}
            >
              {t('clear')}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => { setEditing(false) }}>
            {t('cancel')}
          </Button>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────── bootstrap ────

/** Bootstrap and relay nodes: how this machine reaches the outside world. */
export function BootstrapSection(props: SectionProps) {
  const { t, console: state, act } = props
  const data = dataOf(state, 'bootstrap')
  const [addr, setAddr] = useState('')

  const add = useCallback(() => {
    act({ kind: 'bootstrap.add', addr })
    setAddr('')
  }, [act, addr])

  return (
    <Group title={t('bootstrapNodes')} action={<Refresh {...props} section="bootstrap" />}>
      <div style={mutedStyle}>{t('bootstrapHint')}</div>
      <Pending {...props} section="bootstrap">
        {data !== undefined && (data.nodes.length === 0
          // Allowed, and consequential: with an empty list this machine can
          // only find devices on the local network. Said plainly rather than
          // drawn as an ordinary empty list.
          ? <div style={errorStyle}>{t('bootstrapEmpty')}</div>
          : (
            <div style={listStyle}>
              {data.nodes.map(node => (
                <BootstrapCard
                  key={node.addr}
                  node={node}
                  busy={state.busy.includes(
                    actionKey({ kind: 'bootstrap.remove', addr: node.addr }),
                  )}
                  onRemove={() => { act({ kind: 'bootstrap.remove', addr: node.addr }) }}
                  t={t}
                />
              ))}
            </div>
          ))}
      </Pending>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          style={inputStyle}
          value={addr}
          placeholder="/ip4/…/tcp/4001/p2p/12D3Koo…"
          onChange={event => { setAddr(event.target.value) }}
          aria-label={t('addBootstrap')}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={
            state.busy.includes(actionKey({ kind: 'bootstrap.add', addr })) || addr.trim() === ''
          }
          onClick={add}
          icon={<IconPlusOutline16 />}
        >
          {t('addBootstrap')}
        </Button>
      </div>
    </Group>
  )
}

function BootstrapCard({ node, busy, onRemove, t }: {
  node: BootstrapRow
  busy: boolean
  onRemove: () => void
  t: Translate
}) {
  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {/* Same three states as a device: `null` means no node has been
              running to probe with, which is not "cannot connect". */}
          <StateDot
            state={node.connected === null ? 'ongoing' : node.connected ? 'done' : 'warning'}
            size={8}
          />
          {node.origin === 'builtin' ? t('originBuiltin') : t('originCustom')}
        </span>
        {node.removable && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onRemove}
            icon={<IconTrashOutline16 />}
          >
            {t('remove')}
          </Button>
        )}
      </div>
      <Copyable value={node.addr} label={t('copyAddress')} />
      {node.relay === 'connecting' && <div style={mutedStyle}>{t('relayConnecting')}</div>}
      {node.relay === 'active' && <div style={mutedStyle}>{t('relayReady')}</div>}
      {/* The kernel's own words, verbatim: this is the only string on either
          side that says why a relay will not come up. */}
      {node.relay === 'failed' && (
        <div style={errorStyle}>
          {t('relayFailed')}
          {node.relayError !== null && `: ${node.relayError}`}
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────── about ────

/**
 * Which locale key names each way the binary was found.
 *
 * A lookup rather than a chain of ternaries, so a new `BinarySource` variant
 * fails to compile here instead of silently rendering as blank.
 */
const BINARY_SOURCE_KEY: Readonly<Record<BinarySource, SwarmDropKey>> = {
  override: 'binaryOverride',
  path: 'binaryPath',
  bundled: 'binaryBundled',
  missing: 'binaryMissing',
}

/**
 * One line when the running node is not the version this plugin runs.
 *
 * Warning-coloured rather than muted: it is not trivia about the install, it is
 * the reason a command the user just tried came back with something confusing.
 */
function VersionSkewNotice({ t, about }: SectionProps & { about: AboutRow }) {
  const skew = versionSkew(about.cli, about.daemon)
  if (skew.kind === 'aligned') return null
  return (
    <div style={errorStyle}>
      {skew.kind === 'differs'
        ? t('skewDiffers', { daemon: skew.daemon, cli: about.cli ?? '' })
        : t('skewSilent')}
    </div>
  )
}

/** Versions, and one button to check for a newer CLI. */
export function AboutSection(props: SectionProps) {
  const { t, console: state, act } = props
  const data = dataOf(state, 'about')

  return (
    <Group title={t('about')} action={<Refresh {...props} section="about" />}>
      <Pending {...props} section="about">
        {data !== undefined && (
          <>
            <Fact label={t('pluginVersion')}>{data.about.plugin}</Fact>
            <Fact label={t('cliVersion')}>{data.about.cli ?? t('cliMissing')}</Fact>
            <Fact label={t('binary')}>{t(BINARY_SOURCE_KEY[data.about.binary.source])}</Fact>
            {/* The path is what makes the source row actionable — "your own
                install" is not an answer to "which one" when there are two. */}
            {data.about.binary.source !== 'missing' && (
              <div style={{ ...mutedStyle, ...monoStyle, wordBreak: 'break-all' }}>
                {data.about.binary.path}
              </div>
            )}
            {data.about.daemon.state !== 'none' && (
              <Fact label={t('daemonVersion')}>
                {data.about.daemon.state === 'known'
                  ? data.about.daemon.version
                  : t('daemonSilent')}
              </Fact>
            )}
            <VersionSkewNotice {...props} about={data.about} />
            <div>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  state.busy.includes(actionKey({ kind: 'cli.checkUpdate' }))
                  || data.about.cli === null
                }
                onClick={() => { act({ kind: 'cli.checkUpdate' }) }}
              >
                {t('checkUpdate')}
              </Button>
            </div>
            {/* Phrased here rather than on the Host, which has no locale.
                `unknown` is its own sentence: an externally managed install is
                not "up to date", it is "ask the thing that installed it". */}
            {state.update !== null && (
              <div style={mutedStyle}>
                {state.update.outcome === 'updateAvailable'
                  && t('updateAvailable', { version: state.update.latest ?? '' })}
                {state.update.outcome === 'upToDate' && t('updateUpToDate')}
                {state.update.outcome === 'unknown' && t('updateUnknown')}
              </div>
            )}
          </>
        )}
      </Pending>
    </Group>
  )
}
