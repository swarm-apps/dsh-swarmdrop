/**
 * This plugin's own icon set.
 *
 * ## Why it exists
 *
 * These rows used to import `Icon*Outline16` from
 * `@deepseek-ai/dsh-client-ui-primitives`. dsh 0.2.x removed that generic icon
 * family outright — the primitives package now exports only semantic icons
 * (`PermissionIcon*`, `LinkIcon*`, `ReferenceIcon*`, `FileTypeIcon`) and a
 * plugin that needs a trash can has nowhere to borrow one from.
 *
 * Rather than fork the visual language, this file keeps the same glyphs the
 * rows have always shown, drawn here: outline strokes on `currentColor`, so
 * they inherit whatever the surrounding text uses, at the same 16/14px boxes
 * the dsh set used. Decoupling from the harness icon family is also the honest
 * dependency shape for a third-party plugin — that family is internal, and
 * renaming a glyph is not something a plugin should ever feel.
 *
 * All are props-free by design: every call site renders `<IconX />` bare as a
 * `Button`/`DisclosureRow` icon.
 */

import type { SVGProps } from 'react'

/** Shared outline style: 1.5px stroke reads correctly at 14–16px. */
const OUTLINE: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

function Glyph(props: SVGProps<SVGSVGElement>) {
  return <svg {...OUTLINE} {...props} />
}

export function IconCheckOutline16() {
  return (
    <Glyph>
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </Glyph>
  )
}

export function IconCloseOutline16() {
  return (
    <Glyph>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Glyph>
  )
}

export function IconCopyOutline16() {
  return (
    <Glyph>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5v-1a1.5 1.5 0 0 0-1.5-1.5H4a1.5 1.5 0 0 0-1.5 1.5V9a1.5 1.5 0 0 0 1.5 1.5h1" />
    </Glyph>
  )
}

export function IconGlobeOutline14() {
  return (
    <Glyph viewBox="0 0 14 14">
      <circle cx="7" cy="7" r="5.25" />
      <path d="M1.75 7h10.5M7 1.75c1.6 1.6 1.6 8.9 0 10.5M7 1.75c-1.6 1.6-1.6 8.9 0 10.5" />
    </Glyph>
  )
}

export function IconPlayOutline16() {
  return (
    <Glyph>
      <path d="M5.5 4.5v7l6-3.5z" />
    </Glyph>
  )
}

export function IconPlusOutline16() {
  return (
    <Glyph>
      <path d="M8 3.5v9M3.5 8h9" />
    </Glyph>
  )
}

export function IconRefreshOutline14() {
  return (
    <Glyph viewBox="0 0 14 14">
      <path d="M12 7a5 5 0 1 1-1.6-3.7" />
      <path d="M12 1.5v2.8H9.2" />
    </Glyph>
  )
}

export function IconRightUpOutline16() {
  return (
    <Glyph>
      <path d="M4.5 11.5 11.5 4.5M6 4.5h5.5V10" />
    </Glyph>
  )
}

export function IconStopFill16() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="4.5" y="4.5" width="7" height="7" rx="1" />
    </svg>
  )
}

export function IconTrashOutline16() {
  return (
    <Glyph>
      <path d="M3.5 5h9M6.5 5V3.75A1.25 1.25 0 0 1 7.75 2.5h.5a1.25 1.25 0 0 1 1.25 1.25V5" />
      <path d="M4.75 5l.6 7.25A1.25 1.25 0 0 0 6.6 13.5h2.8a1.25 1.25 0 0 0 1.25-1.25L11.25 5" />
      <path d="M6.75 7.5v3.5M9.25 7.5v3.5" />
    </Glyph>
  )
}

export function IconWarningOutline16() {
  return (
    <Glyph>
      <path d="M8 2.5 14 13H2z" />
      <path d="M8 6.5v3M8 11.25v.25" />
    </Glyph>
  )
}
