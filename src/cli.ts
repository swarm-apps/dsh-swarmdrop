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
import { createInterface } from 'node:readline'

/** How long a one-shot CLI call may take before we give up on it. */
const CALL_TIMEOUT_MS = 120_000

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
const binary = (() => {
  let resolved: string | undefined
  return (): string => {
    if (resolved !== undefined) return resolved
    resolved = process.env['SWARMDROP_BIN'] ?? bundledBinary() ?? 'swarmdrop'
    return resolved
  }
})()

/**
 * The `swarmdrop` shim shipped alongside this package, if it is installed.
 *
 * Resolves `swarmdrop/package.json` rather than the package root: the root has
 * no `main`, so a plain `require.resolve('swarmdrop')` throws even when the
 * package is right there. What we want is its `bin` entry — a Node shim that
 * execs the real platform binary.
 */
function bundledBinary(): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    const manifest = require.resolve('swarmdrop/package.json')
    const bin = (require(manifest) as { bin?: Record<string, string> | string }).bin
    const entry = typeof bin === 'string' ? bin : bin?.['swarmdrop']
    if (entry === undefined) return undefined
    return new URL(entry, `file://${manifest}`).pathname
  } catch {
    // Not installed (it is optional, and platform binaries can legitimately be
    // skipped). Fall through to PATH.
    return undefined
  }
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
 * Run one `swarmdrop` subcommand and parse its structured result.
 *
 * ⚠️ **stdout only.** The CLI keeps diagnostics on stderr precisely so this
 * parse cannot be broken by a progress line; mixing the two back together here
 * would undo that.
 */
export async function call<T>(args: readonly string[]): Promise<T> {
  const { stdout, stderr, code } = await run([...args, '--json'])
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
function run(args: readonly string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary(), args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), CALL_TIMEOUT_MS)

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
      resolve({ stdout, stderr, code })
    })
  })
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
 * Subscribe to everything happening on this machine.
 *
 * `swarmdrop watch` deliberately does **not** start a node and does not fail
 * when none is running: it emits a baseline from local records and waits. That
 * is what lets us spawn it at plugin load without caring whether the user has
 * started SwarmDrop yet.
 *
 * @returns a stop function. It sends `SIGTERM`, which the CLI treats as a
 *   normal shutdown (exit 0) — the plugin's dispose path must not look like a
 *   crash in the user's logs.
 */
export function watch(onFrame: (frame: WatchFrame) => void, onError: (message: string) => void): () => void {
  const child = spawn(binary(), ['watch', '--json'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stopped = false

  child.on('error', err => {
    if (!stopped) onError(`cannot run \`${binary()} watch\`: ${err.message}`)
  })
  child.on('close', code => {
    // Exit 0 after a stop request is the documented shutdown path, not a fault.
    if (!stopped && code !== 0) onError(`\`${binary()} watch\` exited with ${String(code)}`)
  })

  const lines = createInterface({ input: child.stdout })
  lines.on('line', line => {
    if (line.trim() === '') return
    let frame: WatchFrame
    try {
      frame = JSON.parse(line) as WatchFrame
    } catch {
      // A malformed line is the stream's problem, not ours: skip it and keep
      // reading. Tearing the subscription down would lose everything after it.
      return
    }
    onFrame(frame)
  })

  return () => {
    stopped = true
    lines.close()
    child.kill('SIGTERM')
  }
}
