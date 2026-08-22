# Changelog

All notable changes to this project are documented here. The entries are
written by hand and the release workflow reads them back: `gh release create`
is given this file's section for the tag being pushed, so a version with
nothing written down does not get published.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-08-22

### Changed

- A `swarmdrop` on `PATH` now outranks the copy bundled with this package.
  SwarmDrop allows one node per user and its local channel has no version
  negotiation, so running a different binary than the user's terminal does is
  what produced the mismatch. `SWARMDROP_BIN` still overrides both.
- The bundled binary is no longer pre-fetched when it is not the one that will
  be run.

### Added

- About names the executable in use and where it came from, the running node's
  version, and warns when the two are out of step.
- About says so when the `swarmdrop` in use is older than 0.5.0, which the
  plugin needs to subscribe and to pair. Deferring to `PATH` makes a long-idle
  install the one that gets used, and its failures do not look like a version
  problem from the outside.
- A subscription that fails because the binary predates `swarmdrop watch` says
  that, instead of reporting exit code 2.

### Fixed

- Exit codes 2 and 3 carried the wrong hint for a version mismatch — "check the
  arguments" for a client with none to fix, and "start a node" for one that is
  already running. Both cases are now named, in English.

## [0.4.1] - 2026-08-22

### Fixed

- `swarmdrop_transfer_status` reported no failure code. `FailureCode` is a tagged
  object on the wire, and it was read as a string, so every failed transfer came
  back with `null` where the reason belonged.
- The conversation row could not show that a transfer had ended: it read the
  phase from the live channel, which drops a session the moment it reaches
  `terminal`. The log decides that now.
- The panel discarded a `recoverable` change, leaving Resume offered on a
  transfer whose checkpoint was gone.
- An inbound transfer awaiting the user's own confirmation was labelled "waiting
  for the other end". `offered` and `waiting_accept` point in opposite
  directions and no longer share a string.
- `transfer.control` accepted `toString`, `constructor` and three other
  prototype keys as actions, and any string as a transfer id — `--help` among
  them, which the CLI answers with exit 0 and the panel reported as success.
- A progress frame without a total zeroed the row's total for the rest of the
  transfer.
- Exit code 2 has a hint. It is how the CLI refuses a transfer verb the phase
  does not allow, and without one a model reads the usage text as its own
  mistake and retries forever.
- `waitingAccept` is not a phase; the wire is `waiting_accept`. Four documents
  and the model-facing schema said otherwise.
- `InviteRow`'s timestamps are seconds, not milliseconds — 0.4.0 swept them into
  a correction that only applied to the inbox and transfer ones.

## [0.4.0] - 2026-08-22

### Added

- Eight tools, bringing the agent surface level with SwarmDrop's own MCP server:
  `swarmdrop_node_status`, `swarmdrop_search_inbox`, `swarmdrop_inbox_item`,
  `swarmdrop_list_transfers`, `swarmdrop_transfer_status`, and
  `swarmdrop_pause_transfer` / `_resume_transfer` / `_cancel_transfer`.
- Live transfers in the sidebar panel: progress, rate and time remaining, folded
  from the subscription. The rate requires `swarmdrop` 0.7.0.
- `swarmdrop_list_inbox` reports `rootPath`, `contentKind`, `title` and `missing`.
- `swarmdrop_list_devices` takes `onlineOnly`.
- Every tool names what its call is doing on the pending card, with a category
  icon, instead of falling back to the tool name over raw arguments.
- The conversation row for a transfer shows live progress, rate and time
  remaining while it runs, and offers pause / resume / cancel — the verbs the
  CLI will accept in that phase. Requires `swarmdrop` 0.7.0 for the rate; the
  row falls back to the session log when no channel is available or on replay.
- `swarmdrop_search_inbox` requires `swarmdrop` 0.7.0; an older one is reported
  as a version requirement rather than a usage error. The bundled binary moves
  to `^0.7.0` with it — `^0.6.0` does not match 0.7.0, so leaving it would have
  shipped a tool that no bundled install could ever satisfy.

### Fixed

- `swarmdrop_inbox_files` always returned an empty list. It read `files` off the
  entry detail; the CLI reports them under `content.entries`.
- Timestamps are milliseconds, not seconds. Seven doc comments and the tool
  schema said otherwise; the code was already correct.

### Changed

- `tools.ts` is now `tools/`, split by domain (send · inbox · transfer · device)
  over shared projection and failure-translation modules.
- `controlsOf` — which of pause / resume / cancel a transfer's phase allows —
  moved to `console-wire.ts`, where both the settings page and the conversation
  row read it. It mirrors the CLI's own rule and there is now one copy of it.
- A transfer's `speed` is `null` rather than `0` when nothing can be said.

## [0.3.0] - 2026-08-21

### Added

- **A SwarmDrop page in dsh's Settings.** Seven sections behind a nav column:
  overview (node, network, devices), invites, inbox, transfers, this machine's
  settings, bootstrap nodes, and about. The sidebar panel stays what it was —
  a status light — and the page carries everything that needs room.
- **Invites can be revoked from the UI.** An invite is valid for 24 hours,
  survives restarts, and whoever holds it can pair; revoking was previously
  possible only from a terminal.
- **The inbox is listed in full**, with where each item landed and an export
  destination.
- **Transfers can be paused, resumed and cancelled**, with only the controls
  the CLI will actually accept offered per row.
- **The device name and receive directory are editable**, showing which of the
  three sources (environment variable / persisted / built-in default) a value
  comes from — and what is being held down when an environment variable wins.
  Requires `swarmdrop` 0.6.0.
- **Bootstrap / relay nodes can be listed, added and removed**, each with its
  connection and relay state and the kernel's own error text when a relay will
  not come up. Requires `swarmdrop` 0.6.0.
- **The panel's inbox count expands in place** to the newest few entries. It
  does not link to the page: dsh gives `openSection` only to onboarding
  entries, so a plugin cannot open Settings on its own section.
- **A section needing a newer `swarmdrop` says so in one sentence**, instead of
  surfacing clap's usage text to someone who typed nothing.

### Changed

- The panel's state answer now carries the newest few inbox entries, so
  expanding the count costs no process.

### Fixed

- **The panel's controls could stop responding, with nothing on screen saying
  why.** Two independent causes, both structural. `busy` was one flag for the
  whole panel, so a single unsettled call disabled node start/stop, unpair
  *and* pairing at once; it is now keyed per control, and a slow unpair leaves
  the node buttons usable. And browser-side RPC has no timeout of its own, so a
  request that never settled left the `finally` clearing `busy` unrun — the
  control stayed disabled for the life of the page. Every call now has a
  deadline, set above the matching Host-side bound so it is a watchdog on the
  transport rather than a policy on how long an action may take.

- **The machine subscription died silently and never came back.** `swarmdrop
  watch` exits 0 after handling SIGTERM, and the stream layer exempted exit 0
  from being reported — so any end of that process read as an expected one.
  Nothing restarted it, and the panel went on presenting a frozen mirror as
  current. Exits are now reported unless the caller asked for the stop, the
  subscription is supervised with exponential backoff (1 s to 30 s, reset on a
  frame rather than on a spawn), and while it is down the panel says so above
  the facts it qualifies — a mirror that stopped updating is otherwise
  indistinguishable from a machine where nothing is happening.

- **The sidebar entry used a generic share icon.** It is SwarmDrop's own mark
  now, drawn in `currentColor` so it follows the theme and hover state.

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

[Unreleased]: https://github.com/swarm-apps/dsh-swarmdrop/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/swarm-apps/dsh-swarmdrop/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/swarm-apps/dsh-swarmdrop/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/swarm-apps/dsh-swarmdrop/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/swarm-apps/dsh-swarmdrop/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/swarm-apps/dsh-swarmdrop/releases/tag/v0.1.0
