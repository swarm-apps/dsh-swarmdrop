/**
 * The `swarmdrop` binary, as this plugin talks to it.
 *
 * ## Why shell out instead of speaking MCP
 *
 * `swarmdrop mcp` exists and is the right answer for harnesses that can only
 * run a command. Here we are *inside* the harness, so going through MCP would
 * add a process hop and a protocol for nothing — and would cost the one thing
 * this plugin is for: a native tool can append a Session event as it runs, so
 * the send grows a rich row in the conversation. An MCP result is just text.
 *
 * ## Every call is `--json`
 *
 * The human-readable output is not a contract and never will be. `--json` is,
 * and it keeps stdout free of progress (the CLI writes that to stderr).
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

/**
 * How long a one-shot CLI call may take before we give up on it.
 *
 * Two minutes is generous for a *query* — listing devices, reading the inbox,
 * asking for status — and those are the only calls it applies to.
 */
const CALL_TIMEOUT_MS = 120_000

/**
 * How long a transfer may take.
 *
 * `swarmdrop send` blocks until the transfer reaches a terminal state, and a
 * large file over a relayed link legitimately runs for hours. Under the query
 * timeout it was killed at two minutes and reported as a plain failure with no
 * cause — the worst possible answer, because the transfer was fine and the
 * user's next move (retry) makes it worse.
 *
 * A day rather than no limit at all: something has to bound a call that will
 * never return, and a transfer still running tomorrow is not one anybody is
 * waiting on.
 */
export const TRANSFER_TIMEOUT_MS = 24 * 60 * 60 * 1_000

/**
 * The binary this plugin drives, resolved once.
 *
 * Three sources, in this order:
 *
 * 1. **`SWARMDROP_BIN`** — an explicit override always wins. Someone who
 *    already has SwarmDrop from Homebrew or the install script points at it
 *    and skips the optional dependency entirely.
 * 2. **The copy that came with this package.** `swarmdrop` is an
 *    `optionalDependency`, so `dsh plugin add` puts it in the profile's
 *    `node_modules` — but **the profile's `.bin` is not on dsh's `PATH`**, so
 *    spawning a bare name would never find it. Without this branch the optional
 *    dependency does nothing at all, and every user needs a second, separate
 *    global install to make the plugin work.
 * 3. **`PATH`** — for a global install, and as the honest last resort. If it is
 *    not there either, the spawn fails with a message saying how to install it.
 */
function binary(): string {
  // Not cached: `bundledBinary` answers differently once the platform binary has
  // been fetched, and caching the first answer would pin every later call to the
  // shim — including the ones that need a signal to reach the real process.
  return process.env['SWARMDROP_BIN'] ?? bundledBinary() ?? 'swarmdrop'
}

/**
 * The `swarmdrop` that came with this package, if it is installed.
 *
 * ## Two answers, and the difference matters for signals
 *
 * The npm package's `bin` is a **Node shim** that `spawnSync`s the real platform
 * binary. Spawning the shim works, but SIGTERM then lands on the *shim* — the
 * real process is its child and keeps running. For a long-lived one that is not
 * a slow shutdown, it is a leak: a pairing window that stays open after the user
 * pressed Cancel, which is the one thing that must not survive.
 *
 * So this prefers the **real binary** and falls back to the shim only when it
 * has not been fetched yet. `binary.js` is `binary-install`'s own accessor for
 * that path, and `exists()` is its own answer for whether the fetch has
 * happened; reconstructing either from the layout would be guessing at an
 * implementation detail rather than asking it.
 *
 * ## Why the shim can be un-fetched at all
 *
 * The package fetches its platform binary from a `postinstall` hook, and pnpm
 * blocks those by default (`Ignored build scripts: swarmdrop`). The shim then
 * fetches on first use instead — which is why {@link warmBinary} exists.
 */
function bundledBinary(): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    const { getPackage } = require('swarmdrop/binary.js') as {
      getPackage(): { installDirectory: string; binaries: Record<string, string>; exists(): boolean }
    }
    const pkg = getPackage()
    const name = pkg.binaries['swarmdrop']
    if (name !== undefined && pkg.exists()) return join(pkg.installDirectory, name)
  } catch {
    // A layout this code does not know, or the package is simply not installed
    // (it is optional). Either way, try the shim next.
  }
  return bundledShim()
}

/**
 * The Node shim, which fetches the platform binary on first use.
 *
 * Resolves `swarmdrop/package.json` rather than the package root: the root has
 * no `main`, so a plain `require.resolve('swarmdrop')` throws even when the
 * package is right there.
 */
function bundledShim(): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    const manifest = require.resolve('swarmdrop/package.json')
    const bin = (require(manifest) as { bin?: Record<string, string> | string }).bin
    const entry = typeof bin === 'string' ? bin : bin?.['swarmdrop']
    if (entry === undefined) return undefined
    return new URL(entry, `file://${manifest}`).pathname
  } catch {
    // Not installed. Fall through to PATH.
    return undefined
  }
}

/**
 * Make sure the platform binary has been fetched, so later spawns get the real
 * process rather than the shim.
 *
 * One `--version` through the shim is all it takes — `binary-install` fetches
 * lazily on any run. Costs a few seconds exactly once per install, and only when
 * pnpm skipped the postinstall hook.
 *
 * Failures are ignored on purpose: this is an optimisation for signal delivery,
 * not a precondition. If it does not work, the shim still runs SwarmDrop.
 */
export function warmBinary(): Promise<void> {
  return new Promise(resolve => {
    const path = bundledBinary()
    // Already the real binary (or nothing bundled at all): nothing to fetch.
    if (path === undefined || !path.endsWith('.js')) {
      resolve()
      return
    }
    const child = spawn(path, ['--version'], { stdio: 'ignore' })
    child.on('error', () => { resolve() })
    child.on('close', () => { resolve() })
  })
}

/** A `swarmdrop` call that failed, with the CLI's own words. */
export class SwarmDropError extends Error {
  /**
   * @param exitCode - the CLI's exit code. It is a *classification*, not just
   *   a failure flag: 2 = usage, 3 = node unavailable, 4 = peer unreachable,
   *   5 = transfer failed, 6 = pairing refused. Callers that retry must
   *   distinguish them — retrying a 6 only gets refused again.
   */
  constructor(message: string, readonly exitCode: number | null) {
    super(message)
    this.name = 'SwarmDropError'
  }
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
 * Run one `swarmdrop` subcommand and parse its structured result.
 *
 * ⚠️ **stdout only.** The CLI keeps diagnostics on stderr precisely so this
 * parse cannot be broken by a progress line; mixing the two back together here
 * would undo that.
 */
export async function call<T>(args: readonly string[], timeoutMs = CALL_TIMEOUT_MS): Promise<T> {
  const { stdout, stderr, code, timedOut } = await run([...args, '--json'], timeoutMs)
  if (timedOut) {
    // Said plainly rather than relayed as whatever the killed process left on
    // stderr: "swarmdrop send failed" with no cause sends the user to retry,
    // and a retry of something that ran out of time takes just as long.
    throw new SwarmDropError(
      `swarmdrop ${args.join(' ')} gave up after ${String(Math.round(timeoutMs / 1_000))}s`,
      code,
    )
  }
  if (code !== 0) {
    throw new SwarmDropError(stderr.trim() || `swarmdrop ${args.join(' ')} failed`, code)
  }
  const text = stdout.trim()
  if (text === '') return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new SwarmDropError(`swarmdrop ${args.join(' ')} returned unparsable output`, code)
  }
}

/** Spawn, collect both streams, resolve when it exits. */
function run(
  args: readonly string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary(), args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', err => {
      clearTimeout(timer)
      reject(new SwarmDropError(
        `cannot run \`${binary()}\`: ${err.message}. Install it with \`npm i -g swarmdrop\`.`,
        null,
      ))
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code, timedOut })
    })
  })
}

/**
 * How long `swarmdrop --version` may take.
 *
 * Short on purpose: it is the About page's own content, and a page that hangs
 * waiting for a version number is worse than one that says it could not read it.
 * The first run through the npm shim can still be slow (it fetches the platform
 * binary), which is what {@link warmBinary} is for.
 */
const VERSION_TIMEOUT_MS = 10_000

/**
 * The version of the `swarmdrop` this plugin actually runs.
 *
 * ⚠️ **Not through {@link call}.** `--version` is clap's own flag: it prints one
 * line of text and exits before any subcommand runs, so `--json` has nothing to
 * act on and the output is not JSON. Routing it through `call` would fail with
 * "returned unparsable output" — a message about parsing, for something that
 * worked.
 *
 * `null` rather than throwing: every reason this can fail (not installed, not
 * on PATH, a shim that could not fetch) is a *fact about the machine* the page
 * should state, not an error that takes the page down.
 */
export async function cliVersion(): Promise<string | null> {
  try {
    const { stdout, code } = await run(['--version'], VERSION_TIMEOUT_MS)
    if (code !== 0) return null
    // clap prints `swarmdrop 0.6.0`; take the last field so a longer banner
    // (a build suffix, a name change) still yields the version rather than ''.
    const parts = stdout.trim().split(/\s+/)
    return parts.length > 0 && parts[parts.length - 1] !== '' ? parts[parts.length - 1]! : null
  } catch {
    return null
  }
}

/**
 * `swarmdrop send` structured result for files.
 *
 * Lives here rather than in either caller because both `tools.ts` and
 * `command.ts` send, and the shape they read is the CLI's, not either one's.
 */
export interface SendFilesResult {
  readonly sessionId: string
  readonly fileCount: number
  readonly totalBytes: number
}

/**
 * One row of `swarmdrop device list`.
 *
 * Every field is `unknown` on purpose: this is what a *separate process* said,
 * and callers coerce with `coerce.ts` before rendering. Typing it as
 * `{ name: string }` would be a claim about another program's output that
 * nothing checks.
 */
export interface DeviceRow {
  readonly peerId?: unknown
  readonly name?: unknown
  readonly online?: unknown
}

/** One line off `swarmdrop watch --json`. Relayed verbatim except for parsing. */
export interface WatchFrame {
  /** Wire schema version. Bumped only on a breaking change; see the CLI's spec. */
  readonly v: number
  /** Monotonic within this subscription. A jump means we missed that many. */
  readonly seq: number
  readonly kind: string
  readonly [field: string]: unknown
}

/**
 * One long-lived `swarmdrop` subprocess whose stdout is a stream of NDJSON lines.
 *
 * Both `watch` and `pair` are this shape, and the fiddly parts are the ones that
 * are invisible when wrong:
 *
 * - **stderr must be consumed.** A piped stream nobody reads fills its buffer
 *   (64 KiB on Linux, less elsewhere) and then the *child* blocks writing to it
 *   — forever. For a process that also carries tracing output, that means a
 *   subscription which silently stops delivering after some hours of logs, with
 *   no error anywhere. Reading and discarding all but a tail is what prevents it.
 * - **the stopped flag** guards both child handlers, so a deliberate SIGTERM
 *   does not read as a crash in the user's logs. It is the *only* thing that
 *   silences an exit by default: which exit codes are expected is the caller's
 *   business, expressed by {@link StreamSpec.explain} returning `null`. An exit
 *   the layer decided to swallow on the caller's behalf is how a subscription
 *   ends up dead with nobody told.
 * - **a malformed line is skipped, not fatal.** Tearing the stream down would
 *   lose everything after it, and the CLI is explicit that a newer version's
 *   output must be able to flow past an older consumer.
 *
 * Policy stays with the callers: `watch` wants no stdin, `pair` writes decisions
 * to it; and each explains its own non-zero exit.
 */
interface StreamSpec {
  readonly args: readonly string[]
  /** `pipe` when the caller talks back on stdin. */
  readonly stdin: 'ignore' | 'pipe'
  onLine(line: string): void
  onError(message: string): void
  /**
   * Turn an exit plus the tail of stderr into one sentence, or `null` when this
   * exit is an expected end rather than trouble.
   *
   * Called for **every** exit the caller did not ask for, including code 0.
   * The two callers disagree about what a clean exit means — `pair` exits 0 the
   * moment a device is admitted, while a subscription that exits 0 has still
   * stopped delivering — and that disagreement is exactly what belongs here
   * rather than in a blanket rule inside {@link stream}.
   */
  explain(stderr: string, code: number | null): string | null
}

/** A running stream. Dropping the handle does nothing; `stop()` ends it. */
interface StreamHandle {
  /** Write one line to the child's stdin. No-op unless `stdin` was `pipe`. */
  send(line: string): void
  stop(): void
}

/** How much of stderr to keep for the exit message. */
const STDERR_TAIL = 2_000

function stream(spec: StreamSpec): StreamHandle {
  // Spawned through two literal calls rather than one with a computed `stdio`:
  // the tuple has to be a literal for TypeScript to know `stdout` and `stderr`
  // are streams rather than `null`, and a cast would be claiming that instead of
  // showing it.
  const child = spec.stdin === 'pipe'
    ? spawn(binary(), [...spec.args], { stdio: ['pipe', 'pipe', 'pipe'] })
    : spawn(binary(), [...spec.args], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stopped = false
  let complaint = ''

  // An unhandled `error` on a child stream is an unhandled exception in the dsh
  // Host process, not just a failed write. The child exiting between a decision
  // being made and written is ordinary — the `close` handler already reports it.
  child.stdin?.on('error', () => {})

  child.stderr.setEncoding('utf8')
  // Consumed even though most of it is discarded — see the module note above.
  child.stderr.on('data', (chunk: string) => {
    complaint = `${complaint}${chunk}`.slice(-STDERR_TAIL)
  })

  child.on('error', err => {
    if (!stopped) spec.onError(`cannot run \`${binary()} ${spec.args.join(' ')}\`: ${err.message}`)
  })
  child.on('close', code => {
    // A stop we asked for is the documented shutdown path, not a fault.
    if (stopped) return
    const message = spec.explain(complaint, code)
    if (message !== null) spec.onError(message)
  })

  const lines = createInterface({ input: child.stdout })
  lines.on('line', line => {
    if (line.trim() !== '') spec.onLine(line)
  })

  return {
    send(line: string): void {
      if (!stopped) child.stdin?.write(`${line}\n`)
    },
    stop(): void {
      if (stopped) return
      stopped = true
      lines.close()
      child.kill('SIGTERM')
    },
  }
}

/** Parse one NDJSON line, or `undefined` when it is not JSON. */
function parseLine<T>(line: string): T | undefined {
  try {
    return JSON.parse(line) as T
  } catch {
    // The stream's problem, not ours: skip it and keep reading.
    return undefined
  }
}

/**
 * Subscribe to everything happening on this machine.
 *
 * `swarmdrop watch` deliberately does **not** start a node and does not fail
 * when none is running: it emits a baseline from local records and waits. That
 * is what lets us spawn it at plugin load without caring whether the user has
 * started SwarmDrop yet.
 *
 * @param onEnded - the subscription is over, for whatever reason. **Every**
 *   unrequested exit reaches it, including a clean one: `swarmdrop watch`
 *   handles `SIGTERM` and exits 0, so a subscription killed by anything other
 *   than this plugin's own `stop()` ends *quietly* unless code 0 counts as
 *   trouble here. It used to not count, and the result was a panel that went on
 *   serving a frozen mirror — devices, inbox and node liveness all stuck at
 *   whatever they were when the process died, with nothing on screen saying so.
 * @returns a stop function. It sends `SIGTERM`, which the CLI treats as a
 *   normal shutdown — `stopped` is what keeps that from reaching `onEnded`.
 */
export function watch(
  onFrame: (frame: WatchFrame) => void,
  onEnded: (message: string) => void,
): () => void {
  const handle = stream({
    args: ['watch', '--json'],
    stdin: 'ignore',
    onLine: line => {
      const frame = parseLine<WatchFrame>(line)
      if (frame !== undefined) onFrame(frame)
    },
    onError: onEnded,
    // The subscription's own failures are structural (binary gone, node
    // unavailable) and the exit code says more than a stray tracing line would.
    // No code is exempt: for a stream that is supposed to run forever, having
    // exited *is* the news.
    explain: (_stderr, code) => `\`${binary()} watch\` exited with ${String(code)}`,
  })
  return handle.stop
}

/** One line off `swarmdrop invite create --json --decide-from-stdin`. */
export interface PairFrame {
  /** `inviteCreated` | `pairingRequest` | `pairingDeclined` | `pairingRequestExpired` | `paired`. */
  readonly event: string
  readonly [field: string]: unknown
}

/** A pairing window that is open for as long as this handle is alive. */
export interface PairSession {
  /** Answer one pending request. Unknown ids are ignored by the CLI. */
  respond(pendingId: number, accept: boolean): void
  /** Close the window. Every further inbound request is refused by the node. */
  stop(): void
}

/**
 * Open a pairing window and let the caller decide who gets in.
 *
 * ## The window is the process
 *
 * SwarmDrop's node refuses every inbound pairing request unless something is
 * waiting for one, and `invite create` running *is* that signal. So this is not
 * a request/response call: the handle stays alive, and stopping it closes the
 * window. That is also the security property — an invite that leaks is useless
 * once nobody is at the desk.
 *
 * ## Who decides
 *
 * `--decide-from-stdin` routes each request to *this program* instead of a
 * terminal: the CLI writes `{"event":"pairingRequest","pendingId":N,…}` to
 * stdout and reads back `{"pendingId":N,"accept":true}`. It is deliberately not
 * `--auto-accept`, which admits the first device to present any valid invite
 * with nobody checking — here the request travels to a panel a human is looking
 * at, which is the whole point.
 *
 * @param onFrame - each NDJSON line the CLI emits.
 * @param onError - the CLI could not be run, or exited unexpectedly.
 * @returns the live session; `stop()` closes the window.
 */
export function pair(
  onFrame: (frame: PairFrame) => void,
  onError: (message: string) => void,
): PairSession {
  const handle = stream({
    args: ['invite', 'create', '--json', '--decide-from-stdin'],
    stdin: 'pipe',
    onLine: line => {
      const frame = parseLine<PairFrame>(line)
      if (frame !== undefined) onFrame(frame)
    },
    onError,
    explain: explainPairingExit,
  })

  return {
    respond(pendingId: number, accept: boolean): void {
      // One JSON object per line, matching what the CLI's decision channel reads.
      handle.send(JSON.stringify({ pendingId, accept }))
    },
    stop: handle.stop,
  }
}

/**
 * Turn a pairing process's exit into something the user can act on.
 *
 * **Exit 0 is not a failure**: the CLI exits the moment a device is admitted,
 * and the `paired` frame already said so. Reporting it would put an error under
 * every successful pairing.
 *
 * Three failure cases, and the first is the one worth the code:
 *
 * 1. **The CLI is too old.** `--decide-from-stdin` arrived in 0.5.0, and an
 *    older binary answers with clap's `unexpected argument`, followed by a usage
 *    block ending in "For more information, try '--help'". Relaying the last
 *    line — the obvious thing — shows exactly that, which tells the user
 *    nothing. This is the likeliest failure for anyone who installed the plugin
 *    before the CLI caught up, so it gets a sentence of its own.
 * 2. **The CLI refused for a real reason** (no node, no dialable address). Its
 *    own words are the best available, and it puts them on the line beginning
 *    `error:`.
 * 3. **Anything else** — fall back to the exit code rather than inventing a
 *    cause.
 */
function explainPairingExit(stderr: string, code: number | null): string | null {
  if (code === 0) return null
  if (stderr.includes("unexpected argument '--decide-from-stdin'")) {
    return 'pairing from the panel needs swarmdrop 0.5.0 or newer; this machine has an older one'
  }
  const lines = stderr.split('\n').map(line => line.trim()).filter(line => line !== '')
  // `error:` is where both clap and the CLI's own failures put the sentence
  // that matters; the lines around it are usage text and tracing.
  const stated = lines.find(line => line.startsWith('error:'))
  return stated ?? lines.at(-1) ?? `pairing exited with ${String(code)}`
}
