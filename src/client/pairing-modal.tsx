/**
 * The two dialogs pairing needs, and the white card the code sits on.
 *
 * ## Why this is its own file
 *
 * Both dialogs have two callers now — the sidebar panel and the settings
 * console — and neither of those is a place the other should import from.
 * `panel.tsx` is the panel; reaching into it for a dialog would make the
 * console depend on the panel's whole module. `console-ui.tsx` is the
 * console's own vocabulary and has no business growing a panel's component.
 *
 * ## Why pairing needs dialogs at all, rather than a section
 *
 * Two separate reasons that happen to have the same answer:
 *
 * 1. **The code needs the room.** A scannable QR is 240px across; the panel
 *    popover is 320px wide including its padding. Everything the invite step
 *    wants to show does not fit in a column that narrow.
 * 2. **The decision must reach a person.** An inbound request used to render
 *    inside the popover, so closing the panel meant nobody could answer and
 *    the far side timed out. A dialog is drawn over the page whatever the
 *    panel is doing — which is the actual fix, not a nicer version of the old
 *    layout.
 *
 * ## Styles are inline, except on the card
 *
 * Same reason as `panel.tsx`: this package ships its browser half through a
 * hand-written loader wrapper, so a stylesheet would mean owning CSS
 * extraction. The card is the one exception to the theme and is documented
 * where it is defined.
 */

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type ReactNode,
} from 'react'
import {
  Button, IconCheckOutline16, IconCloseOutline16, IconCopyOutline16,
  IconRightUpOutline16, Modal, StateDot, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

import {
  MIN_QR_FACE_PX, QR_FACE_PX,
  type PairingPhase, type PairingRequestView, type PairQrAnswer,
} from '../panel-wire.js'
import { MINIMUM_CLI } from './format.js'
import type { SwarmDropKey } from './locales.js'

/**
 * Translator bound to this plugin's dictionary.
 *
 * Taken from the slot props rather than from either surface's own props type:
 * both hand down the same translator, and depending on one of them would put
 * this module back inside the thing it was pulled out of.
 */
export type Translate = PropsLocale<'swarmdrop'>['t']

/**
 * Whether the invite dialog is up, for a surface that can open one.
 *
 * ## Two states, not one
 *
 * The desk's phase lives on the machine; whether this browser is *showing* it
 * is local. Keeping them apart is what buys three behaviours that a single
 * flag cannot:
 *
 * - **Closing the dialog leaves the desk running.** Copying the link is in
 *   order to go paste it somewhere, so the dialog is always closed mid-pairing.
 *   See {@link PairInviteDialog} for what the desk is holding back.
 * - **A decision borrows the screen and hands it back.** While a request is
 *   pending the invite dialog steps aside (one mask at a time), and a decline
 *   returns to `waiting` with the dialog where the user left it — no
 *   re-opening, no lost place.
 * - **A finished desk forgets the intent.** Otherwise a dialog left open
 *   through a successful pairing would spring back the next time *any* surface
 *   opened a desk, in front of someone who was looking at something else.
 *
 * Shared by both surfaces because both need all three, and a second copy of
 * this reasoning is a second place for it to drift.
 */
export function useInviteDialog(
  phase: PairingPhase,
  onBeginPair: () => void,
  onCancelPair: () => void,
): {
  /** Pass straight to {@link PairInviteDialog}'s `open`. */
  readonly open: boolean
  /** Staff a desk and show its invite. */
  readonly begin: () => void
  /** Re-open the dialog for a desk that is already staffed. */
  readonly view: () => void
  /** Put the dialog away. The desk keeps running. */
  readonly close: () => void
  /** Close the desk, and the dialog with it. */
  readonly cancel: () => void
} {
  const [wanted, setWanted] = useState(false)

  useEffect(() => {
    if (phase === 'idle' || phase === 'paired') setWanted(false)
  }, [phase])

  const begin = useCallback(() => {
    onBeginPair()
    setWanted(true)
  }, [onBeginPair])

  const cancel = useCallback(() => {
    onCancelPair()
    setWanted(false)
  }, [onCancelPair])

  return {
    open: wanted && phase === 'waiting',
    begin,
    view: useCallback(() => { setWanted(true) }, []),
    close: useCallback(() => { setWanted(false) }, []),
    cancel,
  }
}

/**
 * A dismissal that does nothing, defined once.
 *
 * {@link PairingRequestDialog} has no dismissal — see its own note — and a
 * fresh `() => {}` on every render would make the `Modal` re-bind its key
 * listener each time for a handler that never runs.
 */
const NOOP = (): void => {}

/** How much white surrounds the code inside the card. */
const CARD_PADDING = 12

/** What the card needs horizontally before it is worth drawing at all. */
const CARD_WIDTH = QR_FACE_PX + CARD_PADDING * 2

/**
 * The card the code sits on.
 *
 * ⚠️ **Fixed colours, deliberately — do not reach for `--dsw-*` here.**
 * Everything else this plugin draws follows dsh's theme, which makes writing
 * `var(--dsw-alias-bg-layer-1)` the automatic move. It would be wrong: cameras
 * read inverted QR codes badly, so the code stays dark-on-white in dark mode
 * too, and any text drawn on this card has to stay dark with it. A muted grey
 * token over a white card is unreadable in exactly one theme, which is also the
 * one nobody tests in.
 *
 * The hairline ring is what keeps the white card from bleeding into a light
 * page; the shadow does that job in dark mode.
 */
const cardStyle: CSSProperties = {
  position: 'relative',
  alignSelf: 'center',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: CARD_WIDTH,
  height: CARD_WIDTH,
  padding: CARD_PADDING,
  borderRadius: 20,
  background: '#ffffff',
  border: '1px solid rgb(15 23 42 / 0.06)',
  boxShadow: '0 10px 30px rgb(15 23 42 / 0.12)',
}

/** Text drawn on the card. Dark because the card is white in both themes. */
const onCardStyle: CSSProperties = {
  color: '#334155',
  fontSize: 13,
  lineHeight: 1.5,
  textAlign: 'center',
}

const mutedStyle: CSSProperties = { color: 'var(--dsw-alias-label-secondary)' }

const errorStyle: CSSProperties = {
  color: 'var(--dsw-alias-state-error-primary)',
  wordBreak: 'break-word',
}

const monoStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  color: 'var(--dsw-alias-label-tertiary)',
  wordBreak: 'break-all',
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  minHeight: 24,
}

/** One `label — value` line inside a dialog body. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={rowStyle}>
      <span style={mutedStyle}>{label}</span>
      <span style={{ textAlign: 'right' }}>{children}</span>
    </div>
  )
}

/**
 * What the card is showing.
 *
 * A failure carries a **reason, not a sentence**. Wording it where it is
 * discovered would put `t` in the effect's dependencies, and the translator's
 * identity is not guaranteed to survive a re-render — as a dependency it would
 * re-request the code on every one of them. Deciding the words at render time
 * is also just where they belong.
 */
type QrState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly svg: string }
  /** No code, and something to say about why — never a blank card. */
  | { readonly status: 'failed'; readonly reason: QrFailure }

/** Why there is no code. */
type QrFailure =
  /** This viewport cannot hold a scannable one; see {@link MIN_QR_FACE_PX}. */
  | { readonly kind: 'noRoom' }
  /** This `swarmdrop` predates `invite qr`. */
  | { readonly kind: 'tooOld' }
  /** Anything else, in the CLI's own words — empty when it gave none. */
  | { readonly kind: 'refused'; readonly detail: string }

/** The reason, in the reader's language. */
function failureText(reason: QrFailure, t: Translate): string {
  switch (reason.kind) {
    case 'noRoom': return t('qrNoRoom')
    // The version is named here rather than by the Host: this side holds both
    // the dictionary and the floor.
    case 'tooOld': return t('qrNeedsNewerCli', { minimum: MINIMUM_CLI })
    case 'refused': return reason.detail
  }
}

/**
 * The invite, rendered as something a camera can read.
 *
 * The SVG arrives from the Host, which got it from `swarmdrop invite qr` —
 * see `cli.ts` for why it is not encoded here.
 *
 * ## Why an `<img>` rather than inline SVG
 *
 * SwarmDrop's desktop app injects the same SVG with
 * `dangerouslySetInnerHTML` and sizes it with a Tailwind child selector. This
 * package has no stylesheet, so a child selector is not available — and the
 * `<?xml?>` declaration the encoder emits is not something an HTML parser
 * should be handed anyway. A data URI sidesteps both: the SVG carries a
 * `viewBox`, so `width`/`height` scale it exactly, `shape-rendering:
 * crispEdges` survives, and the browser treats the document as an image —
 * no scripts, no external loads, regardless of what produced it.
 */
function InviteQr({ state, t }: { state: QrState; t: Translate }) {
  // Measured, not guessed: a real invite encodes to ~64KB of SVG, and
  // percent-encoding it lands well past 100KB. Without this it would be redone
  // on every render of this dialog — and the copy button re-renders it twice
  // per click (feedback on, feedback off two seconds later).
  const src = useMemo(
    () => (state.status === 'ready'
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(state.svg)}`
      : ''),
    [state],
  )

  return (
    <div style={cardStyle}>
      {state.status === 'ready' && (
        <img
          src={src}
          width={QR_FACE_PX}
          height={QR_FACE_PX}
          alt={t('qrAlt')}
          style={{ display: 'block' }}
        />
      )}
      {state.status === 'loading' && <QrSkeleton />}
      {/* The message is the CLI's own, and it is the only thing that
          distinguishes "this machine cannot draw one" from a card that failed
          to paint. Without it the user checks their phone. */}
      {state.status === 'failed' && (
        <div style={{ ...onCardStyle, padding: '0 16px' }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('qrUnavailable')}</div>
          {/* Absent when the CLI refused without saying anything — a heading
              over an empty line reads as a card that failed to finish. */}
          {failureText(state.reason, t) !== '' && (
            <div style={{ fontSize: 12, color: '#64748b' }}>
              {failureText(state.reason, t)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Three finder corners over a faint grid.
 *
 * Shaped like what is coming rather than a centred spinner: a spinner on a
 * white card reads as "this card is broken", and the corners say "a code goes
 * here" without claiming one exists yet.
 */
function QrSkeleton() {
  const corner: CSSProperties = {
    position: 'absolute',
    width: '22%',
    height: '22%',
    border: '5px solid rgb(15 23 42 / 0.09)',
    borderRadius: 6,
  }
  return (
    <div
      aria-hidden
      style={{
        position: 'relative',
        width: QR_FACE_PX,
        height: QR_FACE_PX,
        borderRadius: 8,
        backgroundImage:
          'repeating-linear-gradient(90deg, rgb(15 23 42 / 0.05) 0 6px, transparent 6px 12px),'
          + 'repeating-linear-gradient(0deg, rgb(15 23 42 / 0.05) 0 6px, transparent 6px 12px)',
      }}
    >
      <span style={{ ...corner, left: 0, top: 0 }} />
      <span style={{ ...corner, right: 0, top: 0 }} />
      <span style={{ ...corner, left: 0, bottom: 0 }} />
    </div>
  )
}

/**
 * The invite is on screen and the desk is staffed.
 *
 * ## Closing this does not close the desk
 *
 * Escape and the mask only put the dialog away; the pairing process keeps
 * running and the surface that opened this keeps a visible row saying so. The
 * two really do come apart in normal use — copying the link is *in order to*
 * go somewhere else and paste it, so the dialog is always closed mid-pairing.
 * Killing the desk on a stray Escape would end a pairing the far side is in
 * the middle of, and `src/pairing.ts` explains what the desk is holding back.
 *
 * So `onCancelPair` hangs off one clearly labelled button and nothing else.
 *
 * ## The link is not shown, but two ways to use it are
 *
 * The canonical invite is about 1,150 characters and nobody reads it; the code
 * is what it is for. But **"open" cannot be dropped**: this panel may itself be
 * displayed on a phone (dsh reached from a browser away from the machine), and
 * a phone cannot scan a code on its own screen. That case has exactly one
 * working path, and it is that button.
 */
export function PairInviteDialog({
  open, invite, busy, onClose, onCancelPair, onQr, t,
}: {
  open: boolean
  /** The canonical link, or `null` while the CLI has not issued one yet. */
  invite: string | null
  busy: boolean
  onClose: () => void
  onCancelPair: () => void
  onQr: (invite: string, size: number) => Promise<PairQrAnswer>
  t: Translate
}) {
  const [qr, setQr] = useState<QrState>({ status: 'loading' })
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [roomForCode, setRoomForCode] = useState(true)

  // Held in a ref rather than listed as a dependency: the surfaces build their
  // face object inline, so this arrives as a new function identity on every
  // render — as a dependency it would re-request the code forever.
  const askQr = useRef(onQr)
  useLayoutEffect(() => { askQr.current = onQr })

  /**
   * Whether the code fits.
   *
   * Measured rather than assumed because the answer must not be "shrink it".
   * The face size is the encoder's address budget: below roughly
   * {@link MIN_QR_FACE_PX} it runs out of addresses to drop and returns an
   * over-budget code *without reporting anything* — a picture too dense to
   * scan that looks exactly like a good one. A viewport too narrow for the
   * card therefore gets the stated fallback, not a smaller code.
   */
  useLayoutEffect(() => {
    if (!open) return
    const measure = () => {
      const width = bodyRef.current?.clientWidth ?? 0
      setRoomForCode(width === 0 || width >= CARD_WIDTH)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => { window.removeEventListener('resize', measure) }
  }, [open])

  useEffect(() => {
    if (!open || invite === null || invite === '') return
    if (!roomForCode) {
      setQr({ status: 'failed', reason: { kind: 'noRoom' } })
      return
    }
    let cancelled = false
    setQr({ status: 'loading' })
    askQr.current(invite, QR_FACE_PX).then(
      answer => {
        if (cancelled) return
        // A refusal comes back inside a successful call — see `PairQrAnswer`.
        if (answer.svg !== null) {
          setQr({ status: 'ready', svg: answer.svg })
          return
        }
        setQr({
          status: 'failed',
          reason: answer.tooOld === true
            ? { kind: 'tooOld' }
            : { kind: 'refused', detail: answer.message ?? '' },
        })
      },
      // A transport failure and a CLI that would not draw one are the same
      // thing to this card: no code, and a sentence about why.
      (error: unknown) => {
        if (cancelled) return
        setQr({ status: 'failed', reason: { kind: 'refused', detail: String(error) } })
      },
    )
    return () => { cancelled = true }
  }, [open, invite, roomForCode])

  // `writeClipboard` reports failure rather than throwing — a browser can
  // refuse the write (permissions, a non-secure origin). Claiming "Copied"
  // when nothing was would send the user to paste an invite they do not have.
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

  const ready = invite !== null && invite !== ''

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('addDevice')}
      closeLabel={t('close')}
      description={t('pairingHint')}
      footer={
        <>
          {/* Left of the primary action and in the quiet voice: it ends a
              pairing the far side may be halfway through, so it should not be
              the button the eye lands on first. */}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onCancelPair}
            icon={<IconCloseOutline16 />}
          >
            {t('cancelPairing')}
          </Button>
          {/* One place says it failed, not two: the label is where the eye
              already is, and a second line under the code repeating it reads
              as two separate things having gone wrong. */}
          <Button
            variant="primary"
            size="sm"
            disabled={!ready}
            onClick={copy}
            icon={copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
            style={copyFailed ? errorStyle : undefined}
          >
            {copyFailed ? t('copyFailed') : copied ? t('copied') : t('copyLink')}
          </Button>
        </>
      }
    >
      <div ref={bodyRef} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <InviteQr state={ready ? qr : { status: 'loading' }} t={t} />

        <div style={{ ...rowStyle, justifyContent: 'center', gap: 6 }}>
          <StateDot state="ongoing" size={8} />
          <span style={mutedStyle}>{t('waitingForDevice')}</span>
        </div>

        {/* The alternative path, next to the sentence that makes it necessary
            rather than in the footer: it is what you use when the code cannot
            be scanned, not a second-class copy button.
            `noreferrer` as well as `noopener` — the invite is a capability and
            the landing page has no business learning where it came from. */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <a
            href={ready ? invite : undefined}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'none', pointerEvents: ready ? undefined : 'none' }}
          >
            <Button variant="ghost" size="sm" disabled={!ready} icon={<IconRightUpOutline16 />}>
              {t('openOnThisDevice')}
            </Button>
          </a>
        </div>
      </div>
    </Modal>
  )
}

/**
 * How the CLI classifies the link a request arrived over.
 *
 * `dcutr` is a hole-punched direct link — the CLI's terminal output calls it
 * direct, and so does this. An empty classifier means the CLI did not say,
 * which is its own answer rather than a blank cell.
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
 * ## It opens whatever the rest of the UI is doing
 *
 * This is the whole reason the request stopped being a section. A request has
 * a timeout on the far side, so one that renders inside a collapsed popover is
 * a request nobody answers — the other device just fails. Mounted above the
 * page, it reaches the user whether or not they were looking at SwarmDrop.
 *
 * Only one surface may mount this (the panel, which is always mounted); a
 * second copy would mean two masks and two sets of buttons for one decision.
 *
 * ## The node id is shown in full and never truncated
 *
 * It is the only thing on this card the far side cannot choose: the display
 * name is self-reported and can be copied exactly, so reading the id back over
 * the phone is what actually distinguishes the user's own device from whoever
 * grabbed the link first.
 *
 * ## No mask-close, no Escape-close
 *
 * `onClose` deliberately does nothing. Every way out of this dialog is a
 * decision, because the two available answers are not interchangeable and
 * neither is a safe default: dismissing as "decline" would reject a device the
 * user meant to admit, and dismissing as "accept" is unthinkable. The far side
 * times out on its own if nobody answers.
 */
export function PairingRequestDialog({ request, busy, onRespondPair, t }: {
  /** The request awaiting a decision, or `null` when there is none. */
  request: PairingRequestView | null
  busy: boolean
  onRespondPair: (pendingId: number, accept: boolean) => void
  t: Translate
}) {
  const link = request === null
    ? undefined
    : CONNECTION_LABELS[request.connection as keyof typeof CONNECTION_LABELS]

  return (
    <Modal
      open={request !== null}
      onClose={NOOP}
      title={t('pairingRequestTitle')}
      closeLabel={t('close')}
      description={t('verifyHint')}
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || request === null}
            onClick={() => { if (request !== null) onRespondPair(request.pendingId, false) }}
            icon={<IconCloseOutline16 />}
          >
            {t('decline')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || request === null}
            onClick={() => { if (request !== null) onRespondPair(request.pendingId, true) }}
            icon={<IconCheckOutline16 />}
          >
            {t('accept')}
          </Button>
        </>
      }
    >
      {request !== null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* A blank name is what the far side reported, and rendering it blank
              looks like a rendering fault rather than a fact worth noticing —
              which is exactly the moment to check the node id below instead. */}
          <Line label={t('device')}>
            {request.device === '' ? t('unnamedDevice') : request.device}
          </Line>
          <Line label={t('system')}>{`${request.os} · ${request.arch}`}</Line>
          {/* An unrecognized classifier is shown verbatim rather than dropped:
              a newer CLI may add one, and "no link row" reads as a bug. */}
          <Line label={t('link')}>
            {link === undefined ? request.connection : t(link)}
          </Line>
          <div style={{ ...monoStyle, marginTop: 8 }}>{request.peerId}</div>
        </div>
      )}
    </Modal>
  )
}
