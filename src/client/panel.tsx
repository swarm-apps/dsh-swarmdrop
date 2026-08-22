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
  Button, IconCheckOutline16, IconPlayOutline16,
  IconPlusOutline16, IconRefreshOutline14,
  IconStopFill16, IconTrashOutline16, StateDot, useDismissOnOutsidePointer,
  type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the sidebar's SlotMap declaration (the 'sidebar.footer.action'
// entry) into this program so PropsRuntime below resolves against the real one.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

import { SwarmDropMark } from './brand.js'
import { formatDuration, formatSize } from './format.js'
import { PairInviteDialog, PairingRequestDialog, useInviteDialog } from './pairing-modal.js'
import { QR_FACE_PX, type PairQrAnswer, type PanelDevice } from '../panel-wire.js'
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
  /** Render the open invite as a QR code. See `pairing-modal.tsx`. */
  onQr(invite: string, size: number): Promise<PairQrAnswer>
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
  onBeginPair, onCancelPair, onRespondPair, onQr, t,
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

  // Shared with the settings console, which opens the same dialog against the
  // same desk — see `useInviteDialog` for why the dialog's state is not simply
  // the desk's phase.
  const invite = useInviteDialog(state.pairing.phase, onBeginPair, onCancelPair)

  const label = t('name')

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

          <NodeSection
            state={state}
            busy={state.busy.includes('node')}
            onStartNode={onStartNode}
            onStopNode={onStopNode}
            t={t}
          />
          <NetworkSection network={state.network} nodeRunning={state.nodeRunning} t={t} />
          <DeviceSection devices={state.devices} busy={state.busy} onForget={onForget} t={t} />
          {/* Directly under the devices it adds to, and in one fixed place.
              It used to move to the top whenever a desk was open, because a
              request rendered below the fold was a request nobody answered —
              a problem the dialogs below solve properly, so the section can
              now sit where it belongs and stay there. */}
          <PairingSection
            pairing={state.pairing}
            busy={state.busy.includes('pair')}
            onBeginPair={invite.begin}
            onViewPairing={invite.view}
            onCancelPair={invite.cancel}
            t={t}
          />

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

      {/* ⚠️ **Outside the popover, and that is the whole point.** Both of these
          are portalled to the document body, but React still unmounts them
          with their owner — put them inside the `open &&` above and closing
          the panel would take the pairing request down with it, which is the
          exact failure this replaced. This component is mounted for as long as
          the sidebar exists (`sidebar.footer.action` is `scope: 'root'`), so
          out here they survive whatever the panel does.

          Clicking either one dismisses the popover, because the portal is
          outside `rootRef` and `useDismissOnOutsidePointer` counts it as an
          outside press. Intended: the panel gets out of the way of the thing
          it just opened. */}
      <PairInviteDialog
        open={invite.open}
        invite={state.pairing.invite}
        busy={state.busy.includes('pair')}
        onClose={invite.close}
        onCancelPair={invite.cancel}
        onQr={onQr}
        t={t}
      />
      {/* The panel owns this one alone — see `pairing-modal.tsx`. A second
          copy from the settings console would put two masks and two sets of
          buttons over one decision. */}
      <PairingRequestDialog
        request={state.pairing.request}
        busy={state.busy.includes('pair')}
        onRespondPair={onRespondPair}
        t={t}
      />
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
 * The pairing desk, as a status surface shows it.
 *
 * A row rather than a workspace. Both halves of pairing moved into dialogs
 * (`pairing-modal.tsx`): the invite needs a 240px code the popover cannot
 * hold, and the decision has to reach the user whether or not the panel is
 * open. What is left here is the one thing this surface still owes them —
 * whether a desk is open, and a way back into it.
 *
 * **The way back is load-bearing, not a convenience.** Closing the invite
 * dialog deliberately leaves the desk running, so without this row a pairing
 * in progress would be both invisible and unreachable.
 *
 * A lookup keyed on the phase, so a phase added to the wire without a branch
 * here is a compile error.
 */
function PairingSection({ pairing, busy, onBeginPair, onViewPairing, onCancelPair, t }: {
  pairing: PanelState['pairing']
  busy: boolean
  onBeginPair: () => void
  onViewPairing: () => void
  onCancelPair: () => void
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
      {(pairing.phase === 'waiting' || pairing.phase === 'deciding') && (
        <div style={rowStyle}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <StateDot state="ongoing" size={8} />
            {pairing.phase === 'deciding' ? t('pairingRequestTitle') : t('pairingInProgress')}
          </span>
          {/* No way back in while a decision is pending: that dialog is already
              on screen and cannot be dismissed, so the button would open
              something invisible underneath it. */}
          {pairing.phase === 'waiting' && (
            <Button variant="ghost" size="sm" onClick={onViewPairing}>
              {t('viewPairing')}
            </Button>
          )}
        </div>
      )}
      {pairing.phase === 'paired' && (
        <div style={rowStyle}>
          <span>{t('pairedWith', { device: pairing.pairedDevice ?? '' })}</span>
          {/* "Done" closes the desk — the CLI has already exited, so this is
              clearing the panel's own memory of it rather than cancelling. */}
          <Button variant="ghost" size="sm" onClick={onCancelPair} icon={<IconCheckOutline16 />}>
            {t('done')}
          </Button>
        </div>
      )}
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
