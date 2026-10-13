/**
 * The console's shared vocabulary: styles and the four elements every section
 * is built from.
 *
 * ## Why inline styles
 *
 * Same reason as the panel: dsh's own surfaces use CSS modules, which the
 * in-repo client bundler understands, while this package ships its browser half
 * through a hand-written loader wrapper. Adding a stylesheet would mean owning
 * CSS extraction and injection too. Inline styles referencing dsh's `--dsw-*`
 * custom properties get the theme — dark mode and any future re-theme included
 * — without owning a build step.
 *
 * ## Why these live apart from the sections
 *
 * Seven sections drawing seven slightly different "label — value" rows is how a
 * settings page ends up looking like seven settings pages. One row component
 * used by all of them is the cheapest way to keep that from happening.
 */

import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Button, StateDot, writeClipboard, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'

import {
  IconCheckOutline16, IconCopyOutline16, IconPlayOutline16, IconStopFill16,
} from './icons.js'

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

import { SwarmDropMark } from './brand.js'
import { summarizeNodeHealth, type NodeHealthLevel, type StatusTone } from './node-health.js'
import type { SwarmDropKey } from './locales.js'
import type { PanelState } from './panel-port.js'

/**
 * Translator bound to this plugin's dictionary.
 *
 * Derived from the slot props rather than imported from `console.tsx`, which
 * imports this file: taking it from the source both of them already depend on
 * keeps the dependency a line rather than a loop.
 */
type Translate = PropsLocale<'swarmdrop'>['t']

export const pageStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 13,
  lineHeight: 1.6,
}

/**
 * A group's title.
 *
 * Deliberately *not* an eyebrow. This was 11px, uppercase, letter-spaced and
 * tertiary-coloured — and seven groups each wore one, which made the page read
 * as seven decorated kickers rather than one page with sections. Hierarchy here
 * comes from weight and size against the body text below it; the all-caps
 * micro-label was decoration doing a job that weight does better, and it cost
 * legibility at 11px to do it.
 */
export const headingStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 13,
  fontWeight: 600,
}

export const mutedStyle: CSSProperties = { color: 'var(--dsw-alias-label-secondary)' }

export const errorStyle: CSSProperties = {
  color: 'var(--dsw-alias-state-error-primary)',
  wordBreak: 'break-word',
}

export const noticeStyle: CSSProperties = {
  color: 'var(--dsw-alias-state-success-primary)',
  wordBreak: 'break-word',
}

/**
 * Something that has not failed but is going to.
 *
 * Distinct from {@link errorStyle} because the difference is real to the
 * reader: an error is an action that did not happen, a warning is the machine
 * being in a state where some future one will not. Colouring the second like
 * the first teaches people to read red as "already broken" and then ignore it.
 */
export const warnStyle: CSSProperties = {
  color: 'var(--dsw-alias-state-warn-primary)',
  wordBreak: 'break-word',
}

export const monoStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  color: 'var(--dsw-alias-label-tertiary)',
  wordBreak: 'break-all',
}

/** One entry in a list of things — an invite, a device, a bootstrap node. */
export const cardStyle: CSSProperties = {
  padding: '12px 14px',
  borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l2)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

export const listStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

export const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  minHeight: 24,
}

export const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-l2)',
  // `bg-layer-1`, the same pair dsh's own Input uses. It was
  // `--dsw-alias-bg-primary`, which dsh does not define — the field had no
  // background at all and simply showed whatever was behind it.
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
}

/** One `label — value` line. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={rowStyle}>
      <span style={mutedStyle}>{label}</span>
      <span style={{ textAlign: 'right', minWidth: 0, wordBreak: 'break-word' }}>{children}</span>
    </div>
  )
}

/** A titled block. Every section is a stack of these. */
export function Group({ title, action, children }: {
  title: string
  /** Optional control on the heading line — usually Refresh. */
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={rowStyle}>
        <span style={headingStyle}>{title}</span>
        {action}
      </div>
      {children}
    </section>
  )
}

/**
 * What a section shows when it has nothing.
 *
 * A sentence rather than a blank area: an empty list and a list that failed to
 * load look identical when both are empty, and the user cannot tell which they
 * are looking at.
 */
export function Empty({ children }: { children: ReactNode }) {
  return <div style={mutedStyle}>{children}</div>
}

/**
 * A value worth copying, with the button that copies it.
 *
 * Confirmation is a transient icon swap rather than a toast: the thing the user
 * needs to know is "that one, yes", and it belongs next to the value they
 * clicked, not in a corner of the screen.
 */
export function Copyable({ value, label, style }: {
  value: string
  /** Accessible name for the copy button — the section says what this is. */
  label: string
  style?: CSSProperties
}) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    void writeClipboard(value).then(() => {
      setCopied(true)
      setTimeout(() => { setCopied(false) }, 1_500)
    })
  }, [value])

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, ...style }}>
      <span style={{ ...monoStyle, flex: 1, minWidth: 0 }}>{value}</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={copy}
        title={label}
        aria-label={label}
        icon={copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────── header ────

/**
 * What the node dot says. One definition, three surfaces.
 *
 * `ongoing` for "not ready yet" is not the same as stopped: before the first
 * answer arrives nobody has asked the machine anything, and painting that as
 * stopped sends the user to start a node that may already be running.
 */
export function nodeDot(panel: PanelState): StateDotState {
  if (!panel.ready) return 'ongoing'
  return panel.nodeRunning ? 'done' : 'warning'
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 16,
  flexWrap: 'wrap',
}

const titleStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 15,
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary)',
}

const taglineStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--dsw-alias-label-secondary)',
  marginTop: 2,
}

/**
 * The page header: what this is, and whether it is running.
 *
 * ## Why liveness is up here and not only on Overview
 *
 * Every other page is a *consequence* of the node being up. A user reading
 * "export failed" on Inbox, or an empty transfer list, asks "is the node even
 * running" — and before this header that answer lived on a different tab. It is
 * the one fact worth repeating on all seven.
 *
 * ## Why nothing else is up here
 *
 * The header is mounted under every tab, so anything it shows is fetched on
 * every visit to every page. That rules out the plugin version, the CLI path
 * and the daemon's version, tempting as a "SwarmDrop v0.6.0" title line is:
 * each of those costs a `swarmdrop` process (see `console-sections.tsx`), and
 * putting one here would spawn it seven times over rather than once, on About,
 * where the user actually asked. Everything the header draws comes from the
 * panel's already-parked subscription, which costs nothing.
 *
 * The mark is brand-coloured here, unlike the sidebar's: the sidebar foot is a
 * row of monochrome 16px icons that take their colour from the row state, and a
 * green mark in that row ignores all of it. A header has room for brand colour
 * to read as brand colour rather than as a stain.
 */
const HEALTH_KEY: Record<NodeHealthLevel, SwarmDropKey> = {
  notRunning: 'healthNotRunning',
  starting: 'healthStarting',
  reachable: 'healthReachable',
  lanReachable: 'healthLanReachable',
  configuredLanOnly: 'healthConfiguredLanOnly',
  isolated: 'healthIsolated',
}

/** Exhaustive by construction: a new tone has to be given a token here. */
const TONE_COLOR: Record<StatusTone, string> = {
  neutral: 'var(--dsw-alias-label-secondary)',
  success: 'var(--dsw-alias-state-success-primary)',
  warning: 'var(--dsw-alias-state-warn-primary)',
}

export function ConsoleHeader({ panel, t, onStartNode, onStopNode }: {
  panel: PanelState
  t: Translate
  onStartNode: () => void
  onStopNode: () => void
}) {
  const status = !panel.ready
    ? t('nodeUnknown')
    : panel.nodeRunning ? t('nodeRunning') : t('nodeStopped')

  // Recomputed per render rather than stored: `settling → unreachable` turns on
  // elapsed time, not on an event, so a level computed once and kept goes stale
  // while nothing arrives to invalidate it.
  const health = summarizeNodeHealth(panel.network, Date.now())
  const online = panel.devices.filter(device => device.online === true).length

  return (
    <header style={headerStyle}>
      <div style={{ minWidth: 0 }}>
        <div style={titleStyle}>
          {/* `currentColor`, like the sidebar's. The mark is *not* painted with
              `--dsw-alias-brand-primary`: that token resolves to neutral ink in
              dsh's sheet rather than to a brand hue — dsh says so itself, in
              `ConversationRoot.module.css` and `InputBar.module.css`, both of
              which had to move off it. Painting it the literal #0F8F7A instead
              would be the one hardcoded colour in this package and is unverified
              against dark mode. */}
          <span style={{ display: 'inline-flex' }}>
            <SwarmDropMark size={18} />
          </span>
          {t('name')}
        </div>
        {/* The consequence sentence, not an adjective. The Node Status
            Contract is explicit that "good" or "limited" do not qualify: they
            have no subject, and the question being asked is "can anyone reach
            me". The tagline it replaces said what the plugin is, which the
            title already says. */}
        <div style={{ ...taglineStyle, color: TONE_COLOR[health.tone] }}>
          {t(HEALTH_KEY[health.level])}
        </div>
        {/* Paired N · online M — slot 3 of the conclusion layer. */}
        {panel.devices.length > 0 && (
          <div style={taglineStyle}>
            {t('pairedSummary', { paired: panel.devices.length, online })}
          </div>
        )}
      </div>

      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {/* The dot is aria-hidden, so the state is carried by this text. Colour
            is never the only channel. */}
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
    </header>
  )
}

// ──────────────────────────────────────────────────────────────────── tabs ────

const tablistStyle: CSSProperties = {
  display: 'flex',
  gap: 2,
  // Scrolls rather than wraps: a wrapped tab row doubles the header's height,
  // and the content below moves every time the container is resized past a
  // wrap point. One row that scrolls stays one row.
  overflowX: 'auto',
  scrollbarWidth: 'none',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}

/**
 * The seven pages, as one row.
 *
 * ## Why horizontal
 *
 * dsh's Settings already owns a vertical nav column immediately to the left.
 * A second column beside it reads as one nav split in two, with the plugin's
 * half the weaker of the pair — and it costs the content the width it needs.
 *
 * ## Keyboard
 *
 * The WAI-ARIA tabs pattern: only the selected tab is in the tab sequence,
 * arrows move between them, Home and End jump to the ends. The buttons are
 * found through the tablist's own DOM rather than refs because dsh's `Button`
 * is a plain function component and does not forward one.
 */
export function SectionTabs<T extends string>({ items, current, onSelect, label }: {
  items: readonly { readonly id: T; readonly label: string }[]
  current: T
  onSelect: (id: T) => void
  /** Accessible name for the tablist. */
  label: string
}) {
  const list = useRef<HTMLDivElement>(null)

  const move = useCallback((delta: number, absolute?: 'first' | 'last') => {
    const index = items.findIndex(item => item.id === current)
    if (index < 0) return
    const next = absolute === 'first' ? 0
      : absolute === 'last' ? items.length - 1
      : (index + delta + items.length) % items.length
    const target = items[next]
    if (target === undefined) return
    onSelect(target.id)
    // Focus follows selection, which is what makes arrow keys feel like a tab
    // strip rather than a listbox the user then has to activate.
    const buttons = list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    buttons?.[next]?.focus()
  }, [items, current, onSelect])

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    const handlers: Record<string, () => void> = {
      ArrowRight: () => { move(1) },
      ArrowLeft: () => { move(-1) },
      Home: () => { move(0, 'first') },
      End: () => { move(0, 'last') },
    }
    const handler = handlers[event.key]
    if (handler === undefined) return
    event.preventDefault()
    handler()
  }, [move])

  return (
    <div ref={list} role="tablist" aria-label={label} style={tablistStyle} onKeyDown={onKeyDown}>
      {items.map(item => {
        const selected = item.id === current
        return (
          <Button
            key={item.id}
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            variant="ghost"
            size="sm"
            onClick={() => { onSelect(item.id) }}
            style={{
              flexShrink: 0,
              borderRadius: 0,
              // Business blue, not brand-primary. dsh's own conversation tabs
              // ride this exact token for this exact reason: `brand-primary`
              // resolves to neutral black in the token sheet, so a "brand"
              // underline would be indistinguishable from ink. This is the
              // nearest semantic token that stays blue in both themes.
              color: selected
                ? 'var(--dsw-alias-state-business-primary)'
                : 'var(--dsw-alias-label-secondary)',
              fontWeight: selected ? 600 : 400,
              // The underline is the selected state. It sits on the same 1px
              // rule the tablist draws, so the row's baseline does not shift
              // when selection moves.
              boxShadow: selected
                ? 'inset 0 -2px 0 0 var(--dsw-alias-state-business-primary)'
                : 'none',
            }}
          >
            {item.label}
          </Button>
        )
      })}
    </div>
  )
}
