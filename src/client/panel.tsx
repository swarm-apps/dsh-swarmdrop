/**
 * The SwarmDrop panel: a dot at the sidebar foot, and what opens under it.
 *
 * ## Why it lives beside Settings and not inside it
 *
 * The complaint this answers is "I cannot tell that the node is not running".
 * A settings card cannot answer it — nobody opens settings to find out whether
 * something is broken. `sidebar.footer.action` is `scope: 'root'` and always
 * on screen, which is the only place a liveness indicator is worth having.
 *
 * SwarmDrop is a *machine-level* subsystem, so a session-scoped seat
 * (`conversation.session.header.*`) would have been the wrong scope as well:
 * the node does not stop being down because you closed the conversation.
 *
 * ## Styles are inline, deliberately
 *
 * dsh's own surfaces use CSS modules, which the in-repo client bundler
 * understands. This package ships its browser half through a hand-written
 * loader wrapper (`scripts/build-client.mjs`), and adding a stylesheet to that
 * would mean owning CSS extraction and injection too. Inline styles referencing
 * dsh's own `--dsw-*` custom properties get the theme — including dark mode and
 * any future re-theme — without owning a build step.
 */

import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type ReactNode,
} from 'react'
import {
  Button, IconCheckOutline16, IconCloseOutline16, IconCopyOutline16, IconPlayOutline16,
  IconPlusOutline16, IconRefreshOutline14, IconRightUpOutline16,
  IconStopFill16, IconTrashOutline16, StateDot, useDismissOnOutsidePointer, writeClipboard,
  type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the sidebar's SlotMap declaration (the 'sidebar.footer.action'
// entry) into this program so PropsRuntime below resolves against the real one.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

import { SwarmDropMark } from './brand.js'
import { formatDuration, formatSize } from './format.js'
import type { PairingRequestView, PanelDevice } from '../panel-wire.js'
import { deviceKey, type PanelState } from './panel-port.js'
import type { SwarmDropKey } from './locales.js'

/** What the slot entry hands this component. */
export interface SwarmDropPanelFace {
  hooks: {
    /** The live machine view; see `panel-port.ts`. */
    panel: HostObservable<PanelState>
  }
  /** Told when the popover opens or closes, so the port can pace its polling. */
  onOpenChange(open: boolean): void
  onStartNode(): void
  onStopNode(): void
  onForget(peerId: string): void
  onBeginPair(): void
  onCancelPair(): void
  onRespondPair(pendingId: number, accept: boolean): void
}

export type SwarmDropPanelProps =
  PropsRuntime<'sidebar.footer.action'> & InjectFace<SwarmDropPanelFace> & PropsLocale<'swarmdrop'>

/** Gap between the trigger and the panel, and the panel and the viewport edge. */
const GAP = 8
const MARGIN = 8

/**
 * Where the popover sits.
 *
 * Anchored by its **bottom** edge, not its top: the trigger lives at the foot
 * of the sidebar, so a panel placed below it opens off the bottom of the
 * viewport. `useAnchoredPosition` from primitives only opens downward, which is
 * right for a header trigger and wrong for this one — the same reason dsh's own
 * Cordis panel measures its anchor by hand.
 *
 * `position: fixed` rather than absolute because the sidebar clips overflow.
 */
interface Anchor {
  readonly left: number
  readonly bottom: number
  /** Room between the viewport top and the trigger, so a short window still fits. */
  readonly maxHeight: number
}

/**
 * What the dot says.
 *
 * "Not yet known" is its own state rather than being folded into "stopped": the
 * first round trip takes a moment, and a badge that claims the node is down
 * during it teaches the user to distrust the badge.
 */
function dotOf(state: PanelState): StateDotState {
  if (state.error !== null) return 'error'
  if (!state.ready) return 'ongoing'
  // A pairing window left open is worth showing from the closed panel: it is a
  // door standing open, and the popover being dismissed does not close it.
  if (state.pairing.phase !== 'idle') return 'ongoing'
  return state.nodeRunning ? 'done' : 'warning'
}

const panelStyle: CSSProperties = {
  position: 'fixed',
  zIndex: 60,
  width: 320,
  overflowY: 'auto',
  padding: 12,
  borderRadius: 12,
  background: 'var(--dsw-specific-menu)',
  border: '1px solid var(--dsw-alias-border-l2)',
  boxShadow: 'var(--dsw-shadow-lv3)',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 13,
  lineHeight: 1.5,
}

const sectionStyle: CSSProperties = {
  paddingTop: 10,
  marginTop: 10,
  borderTop: '1px solid var(--dsw-alias-border-l2)',
}

const headingStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 6,
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  minHeight: 24,
}

const mutedStyle: CSSProperties = { color: 'var(--dsw-alias-label-secondary)' }

const errorStyle: CSSProperties = {
  color: 'var(--dsw-alias-state-error-primary)',
  wordBreak: 'break-word',
}

/**
 * The band that says the facts below are stale.
 *
 * Warning rather than error: nothing is broken from the user's side and the
 * Host is already retrying — what it costs them is trusting what they read.
 */
const staleStyle: CSSProperties = {
  marginTop: 6,
  padding: '4px 8px',
  borderRadius: 6,
  fontSize: 11,
  color: 'var(--dsw-alias-state-warning-primary)',
  background: 'var(--dsw-alias-interactive-bg-hover)',
}

/** A one-line aside under something, in the muted voice. */
const hintStyle: CSSProperties = { ...mutedStyle, fontSize: 11, marginTop: 6 }

/** The groove a transfer's progress bar sits in. */
const trackStyle: CSSProperties = {
  height: 3,
  marginTop: 6,
  borderRadius: 2,
  background: 'var(--dsw-alias-fill-tertiary)',
  overflow: 'hidden',
}

/** The filled part. Width is the only thing that changes, so it animates cleanly. */
const fillStyle: CSSProperties = {
  height: '100%',
  background: 'var(--dsw-alias-fill-brand)',
  transition: 'width 200ms linear',
}

const monoStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  color: 'var(--dsw-alias-label-tertiary)',
  wordBreak: 'break-all',
}

/**
 * The invite link, which is about 1,150 characters.
 *
 * Long because it carries every dialable address of this node — that is what
 * lets the far side reach it without a lookup service. Shown in full rather
 * than elided because it is also the thing being copied, and a link with an
 * ellipsis in the middle is a link someone will paste.
 */
const inviteStyle: CSSProperties = {
  ...monoStyle,
  marginTop: 6,
  maxHeight: 72,
  overflowY: 'auto',
  padding: 6,
  borderRadius: 6,
  background: 'var(--dsw-alias-interactive-bg-hover)',
}

/** One `label — value` line. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={rowStyle}>
      <span style={mutedStyle}>{label}</span>
      <span>{children}</span>
    </div>
  )
}

export function SwarmDropPanel({
  wide, usePanel, onOpenChange, onStartNode, onStopNode, onForget,
  onBeginPair, onCancelPair, onRespondPair, t,
}: SwarmDropPanelProps) {
  const state = usePanel(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<Anchor>()

  useLayoutEffect(() => {
    if (!open) {
      setAnchor(undefined)
      return
    }
    const place = (): void => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (rect === undefined) return
      setAnchor({
        left: rect.left,
        bottom: window.innerHeight - rect.top + GAP,
        maxHeight: Math.max(rect.top - GAP - MARGIN, 0),
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('resize', place) }
  }, [open])

  useDismissOnOutsidePointer(rootRef, open, setOpen)

  // The port stops asking the CLI for network posture while nothing is looking
  // at it — see `panel-port.ts`. Reporting the transition rather than having
  // the port guess is what keeps that decision in one place.
  useEffect(() => {
    onOpenChange(open)
    return () => { onOpenChange(false) }
  }, [open, onOpenChange])

  const toggle = useCallback(() => { setOpen(current => !current) }, [])

  const label = t('name')
  const pairingIsLive = state.pairing.phase !== 'idle'
  const pairingSection = (
    <PairingSection
      pairing={state.pairing}
      busy={state.busy.includes('pair')}
      onBeginPair={onBeginPair}
      onCancelPair={onCancelPair}
      onRespondPair={onRespondPair}
      t={t}
    />
  )

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <Button
        variant="ghost"
        size="sm"
        onClick={toggle}
        aria-expanded={open}
        title={label}
        style={{ width: '100%', justifyContent: wide ? 'flex-start' : 'center', gap: 8 }}
        icon={<SwarmDropMark />}
      >
        {wide ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {label}
            <StateDot state={dotOf(state)} size={8} />
          </span>
        ) : <StateDot state={dotOf(state)} size={8} />}
      </Button>

      {open && anchor !== undefined && (
        <div
          style={{
            ...panelStyle,
            left: anchor.left,
            bottom: anchor.bottom,
            maxHeight: anchor.maxHeight,
          }}
          role="dialog"
          aria-label={label}
        >
          <div style={{ ...rowStyle, marginBottom: 4 }}>
            <strong>{label}</strong>
            {state.busy.length > 0 && <IconRefreshOutline14 />}
          </div>

          {state.error !== null && <div style={errorStyle}>{state.error}</div>}
          {state.actionError !== null && <div style={errorStyle}>{state.actionError}</div>}
          {/* Above everything it qualifies, because it qualifies everything:
              while the subscription is down these are the last facts it sent,
              not the current ones. */}
          {state.subscription !== null && (
            <div style={staleStyle} title={state.subscription}>{t('stale')}</div>
          )}

          {/* Pairing leads while it is live. The panel is taller than a short
              window, and a request waiting for a decision below the fold is a
              request nobody answers — the far side just times out. */}
          {pairingIsLive && pairingSection}
          <NodeSection
            state={state}
            busy={state.busy.includes('node')}
            onStartNode={onStartNode}
            onStopNode={onStopNode}
            t={t}
          />
          <NetworkSection network={state.network} nodeRunning={state.nodeRunning} t={t} />
          <DeviceSection devices={state.devices} busy={state.busy} onForget={onForget} t={t} />
          {!pairingIsLive && pairingSection}

          {/* Above the inbox: what is happening now outranks what already
              arrived, and this section disappears entirely when nothing is in
              flight — so it costs the quiet panel no height at all. */}
          <TransferSection transfers={state.transfers} t={t} />
          <InboxSection
            count={state.inboxCount}
            recent={state.inboxRecent}
            t={t}
          />
        </div>
      )}
    </div>
  )
}

/** Translator bound to this plugin's dictionary. */
type Translate = SwarmDropPanelProps['t']

/**
 * The inbox count, which expands into the newest few entries.
 *
 * **Expands in place rather than opening Settings.** dsh hands `openSection`
 * only to `settings.onboarding` entries, so a plugin cannot open the settings
 * panel on its own page — a row that looked like a link would have nowhere to
 * go. What it can do is show what it already has: the entries ride along on the
 * state answer (see `PanelInboxEntry`), so expanding costs nothing.
 *
 * The full list, with export, lives on the settings page the user opens
 * themselves.
 */
function InboxSection({ count, recent, t }: {
  count: number
  recent: PanelState['inboxRecent']
  t: Translate
}) {
  const [open, setOpen] = useState(false)
  const expandable = recent.length > 0

  return (
    <div style={sectionStyle}>
      <div style={rowStyle}>
        <span style={mutedStyle}>{t('inbox')}</span>
        {expandable ? (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            onClick={() => { setOpen(current => !current) }}
          >
            {t('inboxCount', { count })}
          </Button>
        ) : <span>{t('inboxCount', { count })}</span>}
      </div>
      {open && recent.map(entry => (
        <div key={entry.itemId} style={{ ...hintStyle, marginTop: 4 }}>
          {entry.sourceName === '' ? t('unnamedDevice') : entry.sourceName}
          {' · '}
          {t('inboxCount', { count: entry.itemCount })}
        </div>
      ))}
      {/* The panel deliberately stops here. Anything more — the whole list,
          where a file landed, exporting it — is the settings page's, which has
          room for it and is not competing with a status light for space. */}
      {open && count > recent.length && (
        <div style={{ ...hintStyle, marginTop: 4 }}>{t('inboxMore')}</div>
      )}
    </div>
  )
}

/**
 * What is moving right now.
 *
 * **Renders nothing when nothing is in flight.** A permanently visible "0
 * transfers" row would cost height on every panel opening to answer a question
 * nobody asked; the section appearing *is* the news.
 *
 * The numbers come off the state answer, which the Host folds from the
 * subscription — the panel never asks the CLI for progress. That is not only a
 * cost decision: deriving a rate from polled snapshots is what made SwarmDrop's
 * own terminal panel report ten times the real speed, and this section would
 * have inherited it.
 */
function TransferSection({ transfers, t }: {
  transfers: PanelState['transfers']
  t: Translate
}) {
  if (transfers.length === 0) return null

  return (
    <div style={sectionStyle}>
      <div style={rowStyle}>
        <span style={mutedStyle}>{t('inFlight')}</span>
        <span style={mutedStyle}>{transfers.length}</span>
      </div>
      {transfers.map(transfer => (
        <TransferRow key={transfer.sessionId} transfer={transfer} t={t} />
      ))}
    </div>
  )
}

/** The phases a transfer can sit in without bytes moving, and what to call them. */
const IDLE_PHASE_KEYS: Readonly<Record<string, SwarmDropKey>> = {
  // Snake case, once. The wire is `entity::TransferPhase` with
  // `rename_all = "snake_case"`, pinned on the CLI side by
  // `phase_names_match_the_wire`; a camelCase key here is dead and its presence
  // suggests the author was not sure which one arrives.
  offered: 'transferPhaseOffered',
  waiting_accept: 'transferPhaseWaitingAccept',
  suspended: 'transferPhaseSuspended',
}

/**
 * One transfer.
 *
 * The second line answers a different question depending on the phase, and that
 * is deliberate: while bytes move, "how fast, how much longer" is the only
 * thing worth the space; while they do not, the *reason* is. Showing a rate for
 * a paused transfer would be reporting a machine state that no longer exists —
 * the same rule the CLI's own panel follows.
 */
function TransferRow({ transfer, t }: {
  transfer: PanelState['transfers'][number]
  t: Translate
}) {
  const { totalBytes, transferredBytes, speed, eta, phase } = transfer
  const percent = totalBytes > 0
    ? Math.min(100, Math.floor((transferredBytes / totalBytes) * 100))
    : 0
  const idleKey = IDLE_PHASE_KEYS[phase]
  const name = transfer.peerName === '' ? t('unnamedDevice') : transfer.peerName

  return (
    <div style={{ marginTop: 8 }}>
      <div style={rowStyle}>
        <span>
          {t(transfer.direction === 'send' ? 'transferSending' : 'transferReceiving')}
          {' '}
          {name}
        </span>
        <span style={mutedStyle}>{String(percent)}%</span>
      </div>
      {/* A bar rather than a number alone: a percentage that moves is hard to
          read at a glance, and this is a glance surface. */}
      <div style={trackStyle}>
        <div style={{ ...fillStyle, width: `${String(percent)}%` }} />
      </div>
      <div style={{ ...hintStyle, marginTop: 4 }}>
        {idleKey === undefined
          ? (
            <>
              {formatSize(transferredBytes)} / {formatSize(totalBytes)}
              {' · '}
              {speed === null ? t('transferUnknownRate') : `${formatSize(speed)}/s`}
              {eta !== null && <>{' · '}{t('transferEta', { eta: formatDuration(eta) })}</>}
            </>
          )
          : t(idleKey)}
      </div>
    </div>
  )
}

function NodeSection({ state, busy, onStartNode, onStopNode, t }: {
  state: PanelState
  busy: boolean
  onStartNode: () => void
  onStopNode: () => void
  t: Translate
}) {
  const status = !state.ready
    ? t('nodeUnknown')
    : state.nodeRunning ? t('nodeRunning') : t('nodeStopped')

  return (
    <div style={sectionStyle}>
      <div style={headingStyle}>{t('node')}</div>
      <div style={rowStyle}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StateDot state={dotOf(state)} size={8} />
          {status}
        </span>
        {state.nodeRunning ? (
          <Button variant="ghost" size="sm" disabled={busy} onClick={onStopNode} icon={<IconStopFill16 />}>
            {t('stop')}
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled={busy} onClick={onStartNode} icon={<IconPlayOutline16 />}>
            {t('start')}
          </Button>
        )}
      </div>
      {state.network?.peerId != null && <div style={monoStyle}>{state.network.peerId}</div>}
    </div>
  )
}

/**
 * Network posture.
 *
 * Hidden entirely while the node is stopped: every field would read "unknown"
 * or "none", which is four lines saying the same thing the node row already
 * said.
 */
function NetworkSection({ network, nodeRunning, t }: {
  network: PanelState['network']
  nodeRunning: boolean
  t: Translate
}) {
  if (network === null || !nodeRunning) return null

  return (
    <div style={sectionStyle}>
      <div style={headingStyle}>{t('network')}</div>
      <Fact label={t('nat')}>{network.natStatus}</Fact>
      <Fact label={t('relay')}>{network.relayReady ? t('relayReady') : t('relayWaiting')}</Fact>
      <Fact label={t('bootstrap')}>
        {network.bootstrapConnected ? t('bootstrapConnected') : t('bootstrapWaiting')}
      </Fact>
      <Fact label={t('peers')}>{network.connectedPeers}</Fact>
      <Fact label={t('listen')}>{t('listenCount', { count: network.listenAddrs.length })}</Fact>
      {network.publicAddr != null && <div style={monoStyle}>{network.publicAddr}</div>}
    </div>
  )
}

function DeviceSection({ devices, busy, onForget, t }: {
  devices: readonly PanelDevice[]
  /** The whole busy set: each row reads only its own key out of it. */
  busy: PanelState['busy']
  onForget: (peerId: string) => void
  t: Translate
}) {
  return (
    <div style={sectionStyle}>
      <div style={headingStyle}>{t('devices')}</div>
      {devices.length === 0
        ? <div style={mutedStyle}>{t('noDevices')}</div>
        : devices.map(device => (
          <DeviceRow
            key={device.peerId}
            device={device}
            busy={busy.includes(deviceKey(device.peerId))}
            onForget={onForget}
            t={t}
          />
        ))}
    </div>
  )
}

/**
 * The pairing desk.
 *
 * Four phases, four different things to draw — a lookup keyed on the phase
 * rather than a chain of conditionals, so a phase added to the wire without a
 * branch here is a compile error.
 */
function PairingSection({ pairing, busy, onBeginPair, onCancelPair, onRespondPair, t }: {
  pairing: PanelState['pairing']
  busy: boolean
  onBeginPair: () => void
  onCancelPair: () => void
  onRespondPair: (pendingId: number, accept: boolean) => void
  t: Translate
}) {
  return (
    <div style={sectionStyle}>
      <div style={headingStyle}>{t('pairing')}</div>
      {pairing.phase === 'idle' && (
        <>
          <Button variant="outline" size="sm" disabled={busy} onClick={onBeginPair} icon={<IconPlusOutline16 />}>
            {t('addDevice')}
          </Button>
          {pairing.error !== null && (
            <div style={{ ...errorStyle, marginTop: 6 }}>{pairing.error}</div>
          )}
        </>
      )}
      {pairing.phase === 'waiting' && (
        <WaitingForDevice invite={pairing.invite} busy={busy} onCancelPair={onCancelPair} t={t} />
      )}
      {pairing.phase === 'deciding' && pairing.request !== null && (
        <RequestCard request={pairing.request} busy={busy} onRespondPair={onRespondPair} t={t} />
      )}
      {pairing.phase === 'paired' && (
        <div style={rowStyle}>
          <span>{t('pairedWith', { device: pairing.pairedDevice ?? '' })}</span>
          <Button variant="ghost" size="sm" onClick={onCancelPair} icon={<IconCheckOutline16 />}>
            {t('done')}
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * The invite is on screen and the desk is staffed.
 *
 * **No QR code is rendered here**, and that is not a shortcut: the invite link
 * points at SwarmDrop's own landing page, which draws the QR itself. Rendering
 * a second one would mean shipping an encoder in the browser bundle to produce
 * a picture of a string the page already turns into a picture.
 */
function WaitingForDevice({ invite, busy, onCancelPair, t }: {
  invite: string | null
  busy: boolean
  onCancelPair: () => void
  t: Translate
}) {
  const [copied, setCopied] = useState(false)

  const [copyFailed, setCopyFailed] = useState(false)

  // `writeClipboard` reports failure rather than throwing — a browser can refuse
  // the write (permissions, a non-secure origin). Claiming "Copied" when nothing
  // was would send the user to paste an invite they do not have.
  const copy = useCallback(() => {
    if (invite === null) return
    void writeClipboard(invite).then(written => {
      setCopied(written)
      setCopyFailed(!written)
    })
  }, [invite])

  useEffect(() => {
    if (!copied && !copyFailed) return
    const timer = setTimeout(() => {
      setCopied(false)
      setCopyFailed(false)
    }, 2_000)
    return () => { clearTimeout(timer) }
  }, [copied, copyFailed])

  return (
    <>
      <div style={rowStyle}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StateDot state="ongoing" size={8} />
          {t('waitingForDevice')}
        </span>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancelPair} icon={<IconCloseOutline16 />}>
          {t('cancel')}
        </Button>
      </div>
      {invite !== null && invite !== '' && (
        <>
          <div style={inviteStyle}>{invite}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={copy}
              icon={<IconCopyOutline16 />}
              style={copyFailed ? errorStyle : undefined}
            >
              {copyFailed ? t('copyFailed') : copied ? t('copied') : t('copyLink')}
            </Button>
            {/* `noreferrer` as well as `noopener`: the invite is a capability
                and the landing page has no business learning where it came from. */}
            <a href={invite} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
              <Button variant="ghost" size="sm" icon={<IconRightUpOutline16 />}>{t('openLink')}</Button>
            </a>
          </div>
          <div style={hintStyle}>{t('pairingHint')}</div>
        </>
      )}
    </>
  )
}

/**
 * How the CLI classifies the link a request arrived over.
 *
 * `dcutr` is a hole-punched direct link — the CLI's terminal output calls it
 * direct, and so does this. An empty classifier means the CLI did not say, which
 * is its own answer rather than a blank cell.
 */
const CONNECTION_LABELS = {
  lan: 'linkLan',
  relay: 'linkRelay',
  direct: 'linkDirect',
  dcutr: 'linkDirect',
  '': 'linkUnknown',
} as const satisfies Record<string, SwarmDropKey>

/**
 * Someone is at the desk.
 *
 * The node id is shown **in full and never truncated**. It is the only thing on
 * this card the far side cannot choose: the display name is self-reported and
 * can be copied exactly, so reading the id back over the phone is what actually
 * distinguishes the user's own device from whoever grabbed the link first.
 */
function RequestCard({ request, busy, onRespondPair, t }: {
  request: PairingRequestView
  busy: boolean
  onRespondPair: (pendingId: number, accept: boolean) => void
  t: Translate
}) {
  const link = CONNECTION_LABELS[request.connection as keyof typeof CONNECTION_LABELS]

  return (
    <div
      style={{
        padding: 8,
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-interactive-bg-hover)',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('pairingRequestTitle')}</div>
      {/* A blank name is what the far side reported, and rendering it blank
          looks like a rendering fault rather than a fact worth noticing —
          which is exactly the moment to check the node id below instead. */}
      <Fact label={t('device')}>{request.device === '' ? t('unnamedDevice') : request.device}</Fact>
      <Fact label={t('system')}>{`${request.os} · ${request.arch}`}</Fact>
      {/* An unrecognized classifier is shown verbatim rather than dropped: a
          newer CLI may add one, and "no link row" reads as a rendering bug. */}
      <Fact label={t('link')}>{link === undefined ? request.connection : t(link)}</Fact>
      <div style={{ ...monoStyle, marginTop: 4 }}>{request.peerId}</div>
      <div style={hintStyle}>{t('verifyHint')}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => { onRespondPair(request.pendingId, false) }}
          icon={<IconCloseOutline16 />}
        >
          {t('decline')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={busy}
          onClick={() => { onRespondPair(request.pendingId, true) }}
          icon={<IconCheckOutline16 />}
        >
          {t('accept')}
        </Button>
      </div>
    </div>
  )
}

function DeviceRow({ device, busy, onForget, t }: {
  device: PanelDevice
  busy: boolean
  onForget: (peerId: string) => void
  t: Translate
}) {
  const [confirming, setConfirming] = useState(false)
  // Unpairing cannot be undone from this machine — the other device has to
  // present a fresh invite. A second click is the cheapest guard that does not
  // put a modal in a 320px popover.
  const forget = useCallback(() => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    onForget(device.peerId)
  }, [confirming, device.peerId, onForget])

  useEffect(() => {
    if (!confirming) return
    const timer = setTimeout(() => { setConfirming(false) }, 4_000)
    return () => { clearTimeout(timer) }
  }, [confirming])

  return (
    <div style={rowStyle}>
      <span
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}
        title={device.peerId}
      >
        {/* `null` is unknown, not offline: the CLI has not had a running node to
            probe with, and painting that as offline sends the user to debug a
            network that is fine. */}
        <StateDot state={device.online === null ? 'ongoing' : device.online ? 'done' : 'warning'} size={8} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {device.name}
        </span>
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={forget}
        icon={<IconTrashOutline16 />}
        style={confirming ? { color: 'var(--dsw-alias-state-error-primary)' } : undefined}
      >
        {confirming ? t('forgetConfirm') : t('forget')}
      </Button>
    </div>
  )
}

export type { SwarmDropKey }
