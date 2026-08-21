/**
 * The SwarmDrop settings page: one nav column, one content column.
 *
 * ## Why a nav rather than one long page
 *
 * Every section here costs a `swarmdrop` **process**, so a page that rendered
 * all seven would spawn six on open — five of them for content below the fold.
 * A nav makes "what is on screen" and "what has been fetched" the same set,
 * which is the only shape that keeps the no-polling rule affordable.
 *
 * The one section that costs nothing is Overview: it reads the panel's store,
 * which is already being fed. That is why it is the landing page.
 *
 * ## The page cannot open itself
 *
 * dsh hands `openSection` only to `settings.onboarding` entries, so a plugin has
 * no way to open Settings on its own page. The sidebar panel therefore never
 * links here — it expands what it can in place and leaves opening Settings to
 * the user. Anything this page is the *only* home for (revoking an invite,
 * changing the receive directory) has to be findable from Settings alone.
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the settings shell's SlotMap declaration (the
// 'settings.section' entry) into this program so `PropsRuntime` below resolves
// against the real one rather than an unknown key.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

import {
  AboutSection, BootstrapSection, InboxSection, InvitesSection, OverviewSection,
  SettingsSection, TransfersSection, type SectionProps,
} from './console-sections.js'
import { errorStyle, mutedStyle, noticeStyle, pageStyle } from './console-ui.js'
import type { ConsoleState } from './console-port.js'
import type { ConsoleAction, ConsoleSection } from '../console-wire.js'
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
  onAct(action: ConsoleAction): void
  /** Drop a notice or an error the user has read. */
  onDismiss(): void
  onStartNode(): void
  onStopNode(): void
  onForget(peerId: string): void
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

const layoutStyle: CSSProperties = {
  display: 'flex',
  gap: 20,
  alignItems: 'flex-start',
}

const navStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 128,
  flexShrink: 0,
}

const contentStyle: CSSProperties = { flex: 1, minWidth: 0 }

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
  usePanel, useConsole, onOpenSection, onRefresh, onAct, onDismiss,
  onStartNode, onStopNode, onForget, t,
}: SwarmDropConsoleProps) {
  const panel = usePanel(snapshot => snapshot)
  const consoleState = useConsole(snapshot => snapshot)
  const [page, setPage] = useState<Page>('overview')

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
        <div style={{ ...bannerStyle, color: 'var(--dsw-alias-state-warning-primary)' }}>
          <span title={panel.subscription}>{t('stale')}</span>
        </div>
      )}
      {consoleState.error !== null && (
        <Banner style={errorStyle} text={consoleState.error} onDismiss={dismiss} t={t} />
      )}
      {consoleState.actionError !== null && (
        <Banner style={errorStyle} text={consoleState.actionError} onDismiss={dismiss} t={t} />
      )}
      {consoleState.notice !== null && (
        <Banner style={noticeStyle} text={consoleState.notice} onDismiss={dismiss} t={t} />
      )}

      <div style={layoutStyle}>
        <nav style={navStyle} aria-label={t('name')}>
          {PAGES.map(entry => (
            <Button
              key={entry.page}
              variant={entry.page === page ? 'outline' : 'ghost'}
              size="sm"
              aria-current={entry.page === page}
              onClick={() => { setPage(entry.page) }}
              style={{ justifyContent: 'flex-start' }}
            >
              {t(entry.label)}
            </Button>
          ))}
        </nav>

        <div style={contentStyle}>
          {page === 'overview' && (
            <OverviewSection
              panel={panel}
              t={t}
              onStartNode={onStartNode}
              onStopNode={onStopNode}
              onForget={onForget}
            />
          )}
          {page === 'invites' && <InvitesSection {...sectionProps} />}
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
 * One dismissible line above the page.
 *
 * Dismissible rather than auto-expiring: the two things that land here are an
 * export destination and a failure, and both are things the user may need to
 * read twice or copy out.
 */
function Banner({ style, text, onDismiss, t }: {
  style: CSSProperties
  text: string
  onDismiss: () => void
  t: SwarmDropConsoleProps['t']
}) {
  return (
    <div style={{ ...bannerStyle, ...style }}>
      <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{text}</span>
      <Button variant="ghost" size="sm" onClick={onDismiss} style={mutedStyle}>
        {t('dismiss')}
      </Button>
    </div>
  )
}
