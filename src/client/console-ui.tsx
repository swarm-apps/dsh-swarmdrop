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

import { useCallback, useState, type CSSProperties, type ReactNode } from 'react'
import { Button, IconCheckOutline16, IconCopyOutline16, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'

export const pageStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 13,
  lineHeight: 1.6,
}

export const headingStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
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

export const monoStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  color: 'var(--dsw-alias-label-tertiary)',
  wordBreak: 'break-all',
}

/** One entry in a list of things — an invite, a device, a bootstrap node. */
export const cardStyle: CSSProperties = {
  padding: '10px 12px',
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
  background: 'var(--dsw-alias-bg-primary)',
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
