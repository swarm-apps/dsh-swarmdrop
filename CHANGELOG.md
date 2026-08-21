# Changelog

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
