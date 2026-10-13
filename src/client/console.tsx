/**
 * The SwarmDrop settings page: a header, a tab strip, one content column.
 *
 * ## Why a tab strip rather than a second nav column
 *
 * dsh's Settings already owns a vertical nav immediately to the left of this
 * component. A second column beside it reads as one nav split in two — and the
 * plugin's half is the weaker of the pair, since the host's rows carry icons
 * and this one carried bare text. It also spent width the content needed: the
 * page rendered a 128px rail so that seven short labels could sit in a column.
 * One horizontal row costs a line of height and gives the width back.
 *
 * ## Why a nav at all rather than one long page
 *
 * Every section here costs a `swarmdrop` **process**, so a page that rendered
 * all seven would spawn six on open — five of them for content below the fold.
 * A nav makes "what is on screen" and "what has been fetched" the same set,
 * which is the only shape that keeps the no-polling rule affordable.
 *
 * Overview is the cheapest, and that is why it is the landing page: the device
 * table and node liveness are read straight out of the panel's store, which is
 * already being fed. It is no longer entirely free — opening it asks for
 * network posture once, because that half of the store is filled only while
 * the *sidebar* panel is open, so a user who lives in Settings would otherwise
 * find the Network section permanently blank. One process on open, and only
 * again when the user asks; still not a schedule.
 *
 * ## The page cannot open itself
 *
 * dsh hands `openSection` only to `settings.onboarding` entries, so a plugin has
 * no way to open Settings on its own page. The sidebar panel therefore never
 * links here — it expands what it can in place and leaves opening Settings to
 * the user. Anything this page is the *only* home for (revoking an invite,
 * changing the receive directory) has to be findable from Settings alone.
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'

import { IconCheckOutline16, IconCloseOutline16, IconWarningOutline16 } from './icons.js'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the settings shell's SlotMap declaration (the
// 'settings.section' entry) into this program so `PropsRuntime` below resolves
// against the real one rather than an unknown key.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

import {
  AboutSection, BootstrapSection, InboxSection, InvitesSection, OverviewSection,
  SettingsSection, TransfersSection, type SectionProps,
} from './console-sections.js'
import { ConsoleHeader, SectionTabs, pageStyle } from './console-ui.js'
import type { ConsoleState } from './console-port.js'
import type { ConsoleAction, ConsoleSection } from '../console-wire.js'
import type { PairQrAnswer } from '../panel-wire.js'
import type { SwarmDropKey } from './locales.js'
import type { PanelState } from './panel-port.js'

/** What the slot entry hands this component. */
export interface SwarmDropConsoleFace {
  hooks: {
    /** The live machine view, shared with the sidebar panel. */
    panel: HostObservable<PanelState>
    /** The on-demand half: sections fetched when looked at. */
    console: HostObservable<ConsoleState>
  }
  /** Fetch a section unless it is already in hand. */
  onOpenSection(section: ConsoleSection): void
  /** Fetch a section because the user asked. */
  onRefresh(section: ConsoleSection): void
  /**
   * Read network posture once. See `PanelPort.refreshNetwork` for why the
   * console needs its own door to this and cannot use `setOpen`.
   */
  onRefreshNetwork(): void
  onAct(action: ConsoleAction): void
  /** Drop a notice or an error the user has read. */
  onDismiss(): void
  onStartNode(): void
  onStopNode(): void
  onForget(peerId: string): void
  /** Staff a pairing desk — the same one the sidebar panel drives. */
  onBeginPair(): void
  /** Close it. The node goes back to refusing inbound requests. */
  onCancelPair(): void
  /** Render the open invite as a QR code. See `pairing-modal.tsx`. */
  onQr(invite: string, size: number): Promise<PairQrAnswer>
}

export type SwarmDropConsoleProps =
  PropsRuntime<'settings.section'> & InjectFace<SwarmDropConsoleFace> & PropsLocale<'swarmdrop'>

/**
 * Which page is on screen.
 *
 * `overview` is not a {@link ConsoleSection}: it fetches nothing, so it has no
 * entry in the load union. Keeping the two apart is what makes "opening a page
 * means fetching it" true for every value that *is* a section.
 */
type Page = 'overview' | ConsoleSection

/** The nav, in order. Each row's label key doubles as its identity check. */
const PAGES: readonly { readonly page: Page; readonly label: SwarmDropKey }[] = [
  { page: 'overview', label: 'navOverview' },
  { page: 'invites', label: 'navInvites' },
  { page: 'inbox', label: 'navInbox' },
  { page: 'transfers', label: 'navTransfers' },
  { page: 'settings', label: 'navSettings' },
  { page: 'bootstrap', label: 'navBootstrap' },
  { page: 'about', label: 'navAbout' },
]

/** The dictionary key for one page, for naming its panel. */
function labelOf(page: Page): SwarmDropKey {
  const entry = PAGES.find(candidate => candidate.page === page)
  // Unreachable: `Page` is exactly the set PAGES enumerates. Falling back to
  // the landing page's key keeps this total rather than asserting.
  return entry?.label ?? 'navOverview'
}

const bannerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 8,
  padding: '6px 10px',
  borderRadius: 6,
  background: 'var(--dsw-alias-interactive-bg-hover)',
}

export function SwarmDropConsole({
  usePanel, useConsole, onOpenSection, onRefresh, onRefreshNetwork, onAct, onDismiss,
  onStartNode, onStopNode, onForget, onBeginPair, onCancelPair, onQr, t,
}: SwarmDropConsoleProps) {
  const panel = usePanel(snapshot => snapshot)
  const consoleState = useConsole(snapshot => snapshot)
  const [page, setPage] = useState<Page>('overview')

  // Rebuilt when the locale changes, which is what `t` changing means.
  const tabs = useMemo(
    () => PAGES.map(entry => ({ id: entry.page, label: t(entry.label) })),
    [t],
  )

  // Opening a page is what fetches it. The port skips a section already in
  // hand, so switching back and forth costs nothing.
  useEffect(() => {
    if (page !== 'overview') onOpenSection(page)
  }, [page, onOpenSection])

  const sectionProps: SectionProps = {
    t,
    console: consoleState,
    act: onAct,
    refresh: onRefresh,
  }

  const dismiss = useCallback(() => { onDismiss() }, [onDismiss])

  return (
    <div style={pageStyle}>
      {/* Above everything it qualifies, because it qualifies everything: while
          the subscription is down these are the last facts it sent. */}
      {panel.subscription !== null && (
        <div style={{ ...bannerStyle, color: 'var(--dsw-alias-state-warn-primary)' }}>
          <span title={panel.subscription}>{t('stale')}</span>
        </div>
      )}
      {/* Liveness and start/stop live here rather than on Overview: every
          other page is a consequence of the node being up, so a user reading a
          failure on Inbox should not have to change tabs to learn whether the
          node is running. See `ConsoleHeader` for why nothing costlier joins
          them. */}
      <ConsoleHeader
        panel={panel}
        t={t}
        onStartNode={onStartNode}
        onStopNode={onStopNode}
      />

      <SectionTabs
        items={tabs}
        current={page}
        onSelect={setPage}
        label={t('name')}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Under the tabs rather than above the header: what lands here is a
            failure or a receipt belonging to the page the user is on, and a
            section's error pushing the whole console down reads as the plugin
            being broken rather than one request having failed. The subscription
            notice above stays where it is — that one really does qualify all
            seven. */}
        {consoleState.error !== null && (
          <Banner tone="error" text={consoleState.error} onDismiss={dismiss} t={t} />
        )}
        {consoleState.actionError !== null && (
          <Banner tone="error" text={consoleState.actionError} onDismiss={dismiss} t={t} />
        )}
        {consoleState.notice !== null && (
          <Banner tone="notice" text={consoleState.notice} onDismiss={dismiss} t={t} />
        )}

        {/* One panel is mounted at a time, which is the same set as "one
            section has been fetched" — see the note at the top of the file. */}
        <div role="tabpanel" aria-label={t(labelOf(page))}>
          {page === 'overview' && (
            <OverviewSection
              panel={panel}
              t={t}
              onForget={onForget}
              onRefreshNetwork={onRefreshNetwork}
            />
          )}
          {/* Pairing lives on this page rather than on Overview: an invite
              *is* a pairing, and Overview is a zero-cost mirror of the panel's
              store — putting an action that spawns a process there would cost
              it the property that makes it the landing page. */}
          {page === 'invites' && (
            <InvitesSection
              {...sectionProps}
              pairing={panel.pairing}
              pairingBusy={panel.busy.includes('pair')}
              onBeginPair={onBeginPair}
              onCancelPair={onCancelPair}
              onQr={onQr}
            />
          )}
          {page === 'inbox' && <InboxSection {...sectionProps} />}
          {page === 'transfers' && <TransfersSection {...sectionProps} />}
          {page === 'settings' && <SettingsSection {...sectionProps} />}
          {page === 'bootstrap' && <BootstrapSection {...sectionProps} />}
          {page === 'about' && <AboutSection {...sectionProps} />}
        </div>
      </div>
    </div>
  )
}

/**
 * One dismissible message belonging to the page under it.
 *
 * Dismissible rather than auto-expiring: the two things that land here are an
 * export destination and a failure, and both are things the user may need to
 * read twice or copy out.
 *
 * ## Three things this shape is answering
 *
 * **The dismiss control is an icon.** It was the word "dismiss", and a long
 * message left it no width — flex handed the text every pixel and the label
 * wrapped one character per line down the right edge. An icon button cannot
 * wrap. The word survives as its accessible name.
 *
 * **The text scrolls past a point.** A `swarmdrop` error is whatever the CLI
 * said, and the CLI is capable of listing every variant it accepts in one line
 * (see the `unknown variant` family). Unbounded, one of those fills the panel
 * and pushes the page it is about off screen. Bounded, it is still complete —
 * scrolled, not truncated, so nothing is silently dropped.
 *
 * **Tone is carried by the icon, not by colouring the message.** The body was
 * entirely red, and a wall of red is harder to read than ordinary text — which
 * matters here, because this is the CLI's own wording and that is where the
 * instructions live ("run `swarmdrop stop` then `swarmdrop start`" arrives
 * inside one of these). A tinted ground is not the alternative either: dsh has
 * no `state-error-tertiary`, and `-secondary` is a mid-saturation red that
 * nothing dark reads well against. A coloured left stripe is not on the table.
 * So: neutral ground, red glyph, readable text, and `role="alert"` to say in
 * the accessibility tree what the colour says on screen.
 */
function Banner({ tone, text, onDismiss, t }: {
  tone: 'error' | 'notice'
  text: string
  onDismiss: () => void
  t: SwarmDropConsoleProps['t']
}) {
  const error = tone === 'error'
  return (
    <div
      role={error ? 'alert' : 'status'}
      style={bannerStyle}
    >
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          display: 'inline-flex',
          marginTop: 1,
          color: error
            ? 'var(--dsw-alias-state-error-primary)'
            : 'var(--dsw-alias-state-success-primary)',
        }}
      >
        {error ? <IconWarningOutline16 /> : <IconCheckOutline16 />}
      </span>
      {/* A whole number of lines. An arbitrary pixel cap cuts the last visible
          line in half, which reads as a rendering fault rather than as "there
          is more" — and the half-line is where the CLI's remedy tends to sit,
          because it puts the instruction after the diagnosis. Ten lines clears
          every error this plugin has actually produced; longer ones scroll. */}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          wordBreak: 'break-word',
          maxHeight: 'calc(1.6em * 10)',
          overflowY: 'auto',
        }}
      >
        {text}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onDismiss}
        title={t('dismiss')}
        aria-label={t('dismiss')}
        style={{ flexShrink: 0 }}
        icon={<IconCloseOutline16 />}
      />
    </div>
  )
}
