# Changelog

## [0.2.1] - 2026-08-21

### Fixed

- **Cancelling a pairing window left the process running, so the door stayed
  open.** The npm package's `bin` is a Node shim that spawns the real platform
  binary; spawning the shim meant SIGTERM landed on it and the real process,
  its child, kept going. For the pairing desk that is not a slow shutdown — it
  is the one thing that must not survive the user pressing Cancel, because the
  running process *is* what makes the node accept inbound requests.

  The plugin now resolves the real binary through `binary-install`'s own
  accessor and only falls back to the shim before the platform binary has been
  fetched. It also warms that fetch at load, so the fallback is a first-run
  detail rather than a standing condition.

  Only reachable through a real install: a developer pointing `SWARMDROP_BIN` at
  a build has no shim in the path, which is why it survived until the first
  clean end-to-end run.

## [0.2.0] - 2026-08-21

### Added

- **A SwarmDrop panel at the sidebar foot.** A dot beside Settings says whether a
  node is running; opening it gives node status and network posture, start/stop,
  the paired devices, and pairing — none of which previously existed anywhere in
  the dsh UI. Before this, the only way to see whether SwarmDrop was even running
  was to leave dsh for a terminal.

- **Pairing without a terminal.** "Add a device" issues an invite and staffs the
  desk; the link it shows opens SwarmDrop's own page, which draws the QR code.
  When a device shows up you see its name, system, link type and full node id
  before deciding.

  The security model is unchanged, only relocated: an invite is a one-shot
  capability that travels as a link, so a person still has to look at the far
  side's identity, and SwarmDrop's node still refuses every inbound request
  unless someone is at the desk. Closing the pairing view closes the desk.

  **Needs `swarmdrop` 0.5.0**, which added `invite create --decide-from-stdin`.
  On 0.4.0 everything else works and pairing says the CLI is too old.

### Fixed

- **A session containing this plugin's events could not be opened.** dsh refuses
  to read a log carrying event types it does not know, and neither escape it
  offers is available to a third-party plugin: the known set is generated from
  the types declared inside the dsh repository, and `Session.append()` has no way
  to mark an event `ignorable`. Sending one file was enough to make that
  conversation unreadable — not just its SwarmDrop rows, the whole thing.

  The plugin now announces its four event types to the running harness at load.
  See the README's "A limitation you should know about" for what this does *not*
  fix: uninstalling still leaves those conversations unopenable, and the
  announcement does not survive a dsh run from a source checkout under `tsx`.

- **The `swarmdrop watch` subscription could wedge and stay wedged.** Its stderr
  was piped and never read, so once the pipe's buffer filled — 64 KiB of the
  CLI's own tracing output — the child blocked writing to it and stopped
  delivering. Nothing reported anything; inbox arrivals simply stopped showing
  up. Both long-lived subprocesses now drain stderr and keep only a tail for the
  exit message.

- **A large transfer was killed at two minutes and reported as a plain
  failure.** `swarmdrop send` blocks until the transfer finishes, and it was
  running under the timeout meant for queries — so a file that legitimately took
  longer was SIGTERMed, and the user was told "failed" with no cause, which
  invites a retry that takes just as long. Transfers now get their own bound, and
  a timeout says it timed out.

### Changed

- `bridge.ts` no longer owns the `swarmdrop watch` subscription or folds state.
  The subscription is spawned once in `index.ts` and every frame goes to two
  readers: `machine.ts` folds what this machine looks like, `bridge.ts` decides
  which happenings deserve a row in which conversation. The panel needed the
  first half and had no business reaching through the second.

- The README's claim that dsh gives third-party plugins no Client→Node RPC was
  wrong and is corrected. `ctx.connection.rpc.handle` mounts a channel of the
  plugin's own; what remains true is that the *transcript* must rebuild from the
  session log, and nothing bypasses that.

## [0.1.1] - 2026-08-21

### Fixed

- Find the bundled `swarmdrop` binary instead of relying on `PATH`. The optional
  dependency lands in the profile's `node_modules/.bin`, which is not on dsh's
  `PATH`, so the previous release only worked for people who also had a global
  install.

## [0.1.0] - 2026-08-21

First release: tools, the `/swarmdrop` command, conversation rows for transfers
and received items, and the `@` inbox source.
