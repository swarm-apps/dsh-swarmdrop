# dsh-swarmdrop

Give your [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) agent a
channel to your own devices. It can push what it just produced straight to your
phone, and you can `@`-reference what your phone sent back — no account, no public
IP, end-to-end encrypted.

The transport is [SwarmDrop](https://github.com/yexiyue/SwarmDrop), driven through
its CLI.

> **Status: developer preview.** dsh itself declares breaking changes, and this
> plugin sits on its extension seams. Pin a version.
>
> **Pin the dsh line too.** The peer ranges target `0.1.0-rc.x`; npm's `latest`
> tag on the `@deepseek-ai/*` packages still points at the older `0.0.1-rc.x`
> line, so an unpinned install resolves to packages this plugin does not target.

## What you get

| In dsh | What happens |
|---|---|
| "send the report to my phone" | The agent calls `swarmdrop_send_files`; a transfer row appears in the conversation and follows it to completion. |
| `/swarmdrop send ./report.pdf phone` | Same, without a model round trip. |
| `@` in the composer | Your inbox — everything your devices sent this machine — as reference candidates. |
| Your phone sends a file | A row appears in the conversation, and the item becomes referenceable. |
| **The SwarmDrop button at the sidebar foot** | Node status and network posture, start/stop, your paired devices, and pairing a new one — without leaving dsh for a terminal. |
| **Settings → SwarmDrop** | Everything that needs room: invites and revoking them, the whole inbox, transfer history and its controls, this machine's name and receive directory, bootstrap nodes. |

### The panel

A dot beside Settings says whether a node is running: green for running, amber
for stopped, grey while the first answer is still in flight. Opening it gives you

- **Node** — running or stopped, its node id, and one button to change that.
- **Network** — NAT class, relay reservation, bootstrap, connected peers, listen
  addresses. Shown only while a node is running, because every field would
  otherwise read "unknown" and say nothing the node row did not.
- **Devices** — what is paired and whether it is online. `unknown` is its own
  state, not a synonym for offline.
- **Pairing** — "Add a device" issues an invite and staffs the desk; the link it
  shows opens SwarmDrop's own page, which draws the QR code for your phone to
  scan. When a device shows up you see its name, system, link type and **full
  node id** before deciding.

Pairing still requires a person to look at the far side's identity — that has not
been relaxed, only moved. An invite is a one-shot capability that travels as a
link, and whoever presents it first consumes it, so SwarmDrop's node refuses
every inbound request unless someone is at the desk.

**The desk stays staffed until you press Cancel**, not until you dismiss the
panel — you will usually be looking at your phone at that moment, and a popover
that closes when you click away would take the invite with it. The sidebar dot
turns amber-grey while a window is open, so a desk left staffed is visible
without opening anything.

### The settings page

The panel is a status light; the page is where the occasional work happens.
Seven sections, each read when you open it and re-read when you ask — never on
a timer, because every one of them costs a `swarmdrop` process.

- **Overview** — the panel's facts, unabbreviated: every listen address, the
  full node id, every paired device with its identity.
- **Invites** — what this machine has handed out, and one button to take it
  back. An invite is valid for 24 hours, survives restarts, and whoever holds
  it can pair, so this is the only way to stop one that leaked.
- **Inbox** — everything that arrived, where it landed, and exporting a copy
  elsewhere.
- **Transfers** — history, with pause / resume / cancel offered only where the
  CLI will accept them.
- **Settings** — this machine's device name and receive directory. Each value
  says where it comes from, and when an environment variable is winning it says
  what is being held down — otherwise you would edit a field that does nothing.
- **Bootstrap** — the relay and bootstrap nodes this machine uses, their
  connection state, and the kernel's own words when one will not come up. Your
  additions and removals layer over the built-in list rather than replacing it,
  so a release that changes the built-in addresses still reaches you.
- **About** — plugin and `swarmdrop` versions, and a check for a newer one.

The last two need **`swarmdrop` 0.6.0 or newer**; with an older one they say so
rather than showing you an argument-parsing error.

> **The panel cannot open this page.** dsh hands `openSection` only to
> `settings.onboarding` entries, so a plugin has no way to open Settings on its
> own section. The panel expands what it already has in place and leaves opening
> Settings to you — which is why anything the page is the only home for has to
> be findable from Settings alone.

## Install

```bash
dsh plugin --profile <name> add dsh-swarmdrop
```

That is all — the package declares a `dsh.bundle`, so dsh appends it to the
profile's bundle list and its config layer activates on the next start. Verify
before launching with `dsh --profile <name> --dump-config`, which should show a
`# == dsh-swarmdrop` layer.

`dsh plugin` forwards to pnpm inside the profile directory, so it takes any pnpm
target — no npm publish required:

```bash
dsh plugin --profile <name> add /path/to/dsh-swarmdrop     # a local checkout
dsh plugin --profile <name> add ./dsh-swarmdrop-0.1.0.tgz  # from `npm pack`
```

Remove it with `dsh plugin --profile <name> remove dsh-swarmdrop`, which drops
the dependency and the layer together.

### The SwarmDrop binary

**Your own install wins.** If `swarmdrop` is on `PATH` — Homebrew, the install
script, `npm i -g` — that is the one the plugin runs. A copy also comes along as
an optional dependency, used only when there is none of your own, so
`dsh plugin add` still gives you a working plugin with nothing else to install.
`SWARMDROP_BIN` overrides both.

The order matters more than it looks. SwarmDrop's data directory is per *user*,
and at most one process holds the node for it; everything else becomes a client
of that one over a local channel with **no version negotiation**. So whichever
binary starts the node decides what works, and running a different one than your
terminal does is how you end up with a daemon your own `swarmdrop` cannot talk
to. Deferring to `PATH` keeps both on one binary.

The About section names which binary is in use, where it came from, and the
running node's version — with a warning when the two are out of step. That
happens without two installs, too: `swarmdrop update` replaces the executable
and leaves the daemon running the old code until it is restarted.

You will see pnpm say `Ignored build scripts: swarmdrop` during the install.
That is fine: the npm package fetches its platform binary from a postinstall
hook, pnpm blocks those by default, and the shim falls back to fetching on first
use instead. The only visible effect is that the first SwarmDrop call after
installing takes a few seconds longer than the rest — and only if the bundled
copy is the one being used at all.

**`swarmdrop` 0.5.0 or newer is required.** 0.4.0 added `swarmdrop watch`, which
this plugin subscribes to; 0.5.0 added `invite create --decide-from-stdin`, which
is what lets the panel run the pairing desk. On 0.4.0 everything else works and
pairing reports that the CLI is too old.

**Pair a device** from the panel — the plugin has nothing to talk to otherwise.
The terminal route still works if you prefer it:

```bash
swarmdrop invite create      # scan the QR from your phone's SwarmDrop app
```

Nothing here requires a SwarmDrop node to be running: the plugin loads cleanly on
a machine where you have not started one, the tools say so rather than failing
mysteriously, and the panel offers to start one.

## Tools

| Tool | What it does |
|---|---|
| `swarmdrop_send_files` | Send files or directories to one of your devices. |
| `swarmdrop_send_text` | Send a short message to a device's inbox. |
| `swarmdrop_list_devices` | Your paired devices and whether they are online. |
| `swarmdrop_node_status` | Whether the local node is running, and how it is reachable. |
| `swarmdrop_list_inbox` | What your devices have sent this machine, and where it landed. |
| `swarmdrop_search_inbox` | Find an entry by keyword — title, sender, message body, file names. |
| `swarmdrop_inbox_item` | One entry in full: every file's real path, or the message body. |
| `swarmdrop_inbox_files` | Just the files of one entry, when that is all you need. |
| `swarmdrop_list_transfers` | Transfer sessions, in flight and recent. |
| `swarmdrop_transfer_status` | One transfer: phase, progress, rate. |
| `swarmdrop_pause_transfer` | Pause a transfer that is moving bytes. |
| `swarmdrop_resume_transfer` | Resume from a checkpoint. |
| `swarmdrop_cancel_transfer` | Stop one for good, telling the other end. |

**Nothing here can pair a device.** Accepting an inbound request is your decision
at the panel — a tool that could pair would be a tool that could hand a stranger
a channel into this machine.

Two values are three-valued rather than boolean, and both distinctions matter:

- `presence` is `online` / `offline` / `unknown`. `unknown` means no SwarmDrop
  node is running to probe with — the difference between "your phone is asleep"
  and "start SwarmDrop".
- a transfer's `speed` is a number or `null`, **never `0`**. The core reports
  zero for "no new bytes within a sliding window", which is what saving a
  finished file looks like; passing that on as a measured zero would have an
  agent telling you a healthy transfer had stalled.

`swarmdrop_search_inbox` needs `swarmdrop` 0.7.0; an older one says so in a
sentence rather than failing as though you mistyped something.

Every call names what it is doing on its card — `Send 3 files to 光印-华为410`
rather than `swarmdrop_send_files` over a dump of arguments. Live progress and
the pause / cancel controls are **not** on the card: dsh's tool cards are a
closed vocabulary of static shapes, and their presenters are pure functions
replayed months later, so a card cannot honestly say "right now". Those live in
the conversation row and the panel, both of which can.

## How it is put together

```
src/
  cli.ts         the `swarmdrop` binary: one-shot calls, the subscription, pairing
  machine.ts     what this machine looks like, folded from the subscription
  pairing.ts     the pairing desk: one window, and who is standing at it
  revision.ts    the shared "something changed" counter the panel parks on
  bridge.ts      machine-wide happenings  →  per-session events
  panel.ts       the panel's RPC channel (status, devices, pairing)
  panel-wire.ts  the panel's wire contract, compiled by both halves
  console.ts     the settings page's two routes: read a section, run an action
  console-wire.ts  the page's wire contract, compiled by both halves
  projection.ts  the inbox roll, as a Session projection (what `@` reads)
  tools/         what the model can call
    index.ts       the registry: every tool, registered once
    shape.ts       CLI output  →  this plugin's contract
    explain.ts     CLI failure →  the model's next move
    send.ts        the two that write to the conversation
    inbox.ts       what came in, and where it is
    transfer.ts    watching one, and steering one
    device.ts      who is reachable, and is this node up
    present.ts     what a call's card says while it runs, and after
  command.ts     what you can type
  types.ts       the Session event family this plugin owns
  client/        the browser half: the panel, conversation rows, the `@` source
```

Four decisions worth knowing before changing anything:

**Two kinds of data, two carriers.** Conversation rows and `@` candidates travel
in the *session log*: they must rebuild identically after a refresh, a history
page, or a replay months later, so the `@` menu reads a session projection — the
Node half registers a pure fold, the framework drives it over committed events in
log order, and the browser receives a finished value.

The panel's data does **not** go there. Node liveness, devices and network
posture are facts about *now*; a session event claiming "the node is up" would be
a claim about a moment, persisted forever, and read back as though still true. So
the panel has a channel of its own — `ctx.connection.rpc.handle('/swarmdrop', …)`
on the Host, `rpc.call` in the browser. Both work under every dsh carrier,
including reaching a dsh at home from your phone.

> An earlier version of this file said dsh gives third-party plugins no
> Client→Node RPC. That was wrong. What is true, and load-bearing, is the split
> above: the transcript rebuilds from the log, and nothing may bypass that.

**The panel long-polls, because it cannot be pushed to.** dsh forwards Host
events to the browser from a fixed allowlist a third-party plugin cannot extend.
So the panel parks a request on the Host until something changes — which is not
a downgrade from a push: the request is already waiting when the change lands, so
the answer leaves immediately rather than at the next tick of a timer.

**Events record what happened, not what is.** `swarmdrop/sent`,
`swarmdrop/inbox-received` and `swarmdrop/transfer` are things that occurred at a
point in time, so replaying a conversation months later still explains it. The
one whole-value event, `swarmdrop/inbox-baseline`, answers "what did you have at
hand when this started" — which is exactly the context a reader needs.

**The panel long-polls; the page does not poll at all.** The panel can afford a
parked request because the Host holds it open. Nothing on the settings page can:
every section is a `swarmdrop` process, so a section is read when you open it
and when you ask, and the live half (node liveness, devices, pairing) is not
re-read at all — it already arrives on the panel's subscription, and the page
reads the same store.

**Every payload carries a `version`.** These land in your session log, which
outlives the process and gets replayed. A format change that still parses but
means something different is the worst failure available.

## A limitation you should know about

dsh refuses to read a session log containing an event type it does not know,
unless the event is marked `ignorable`. Neither escape is available to a
third-party plugin: the known set is generated from the types declared inside the
dsh repository, and `Session.append()` offers no way to set the marker. dsh knows
— its own source says a registration surface for out-of-repo events "is deferred
until such a consumer exists".

This plugin is that consumer, so at load it announces its four event types to the
running harness. That makes them readable here. It does **not** put `ignorable`
on the events, so:

> **Disable this plugin rather than uninstalling it**, if conversations that used
> it still matter to you. A harness without the plugin refuses to open a session
> log containing its events — you would see "unknown to this harness", and the
> whole conversation, not just the SwarmDrop rows, becomes unreadable.

The announcement also relies on the plugin and dsh resolving the same
`@deepseek-ai/dsh-session` module instance. That holds for an ordinary install;
it does not hold when dsh is run from a source checkout under `tsx`, where the
two halves get separate module graphs and the announcement lands on a copy
nothing reads.

## Development

```bash
npm install
npm run typecheck   # both halves
npm run build       # tsc for the Node half, tsdown for the browser one
```

**The two halves compile as separate TypeScript programs, and that is not
optional.** dsh augments `Context.sessions` differently on the two sides (Node:
`SessionStore`; browser: `ISessions`), so putting both in one program makes the
browser half compile against the Node service surface and fail with errors that
point nowhere near the cause. The same rule applies inside the source: **client
files must never import a package root** — only `/types` and `/client`
subpaths, which carry no `Context` augmentation.

**The browser bundle is not an ordinary ESM build.** dsh's loader expects the
`./client` entry to register itself with
`window.__ModuleLoader__.load({ id, factory })`, resolving externals through an
injected `require` — no import map, no globals. dsh builds its own with a shared
tsdown preset that is not published, so `tsdown.config.ts` reimplements the
wrapper as a `banner`/`footer` pair. `id` must equal the package name, because
that is the entry name the host composed into `window.__DSH_BOOT__`.

Two things about that config are load-bearing rather than stylistic. **tsdown
runs before `tsc`, not after**, and that ordering is what lets it `clean`:
`lib` holds both halves and nothing else empties it, so with cleaning off,
output from a source file deleted three commits ago stays there and `files`
packs it. Run tsdown second and the same `clean` would delete the Node half
instead. And the banner is given in object form (`{ js: … }`) because a plain
string is prepended to *every* chunk: the declaration file would get the
wrapper too, and stop parsing as TypeScript.

**The two halves' declarations come from different tools**, which is why they
land in different places: `lib/types/**` mirrors the Node source file by file,
while the browser half is a single bundled `lib/client.d.ts`. Both are what
`exports` points at; neither is written by hand.

Three things a reader will otherwise rediscover the hard way:

- **The conversation-node cookbook's snippet does not compile as written.**
  `ChatNodeViewProps` bundles `t: TranslateNS<'conversation'>`, but the slot only
  injects `t` when the registration passes `locale`, and the namespace value
  first-party code passes is not exported. See `src/client/nodes.tsx`.
- **`exec.agent` is optional.** A nested Code-Mode dispatch has no agent, so a
  send still happens but has no conversation to attribute itself to.
- **npm's `latest` tag lags the real version line.** `npm view @deepseek-ai/…`
  reports `0.0.1-rc.1`, whose client packages depend on `@deepseek-ai/dsh-compact`
  — a package that is not published, making that line unresolvable. The line
  actually in use is `0.1.0-rc.x`, which resolves cleanly. Check
  `npm view <pkg> versions` rather than the bare `version`.

### Releasing

The changelog is the input to a release, not a record written after one. Write
the section first, then tag:

```bash
# 1. Describe the change in CHANGELOG.md under a new `## [x.y.z] - YYYY-MM-DD`
#    heading, and add its compare link at the foot of the file. Commit it.
# 2. Let npm set the version, commit it and tag it.
npm version minor
git push --follow-tags
```

**Set the version with `npm version`, never by editing package.json.** It
writes package-lock.json too, and a hand-edited manifest leaves the lockfile
behind — which stays invisible until some later `npm ci` refuses to install and
takes the release job down with it. The release job checks the two against each
other for that reason.

Pushing the tag runs `release.yml`, which typechecks both halves, tests,
refuses a tag that disagrees with package.json or a lockfile that disagrees
with either, reads the notes out of CHANGELOG.md — **failing if that version
has no section** — publishes to npm with provenance, and cuts the GitHub
Release from those same notes.

npm is published before the Release is cut, because npm is the half that cannot
be taken back. So the one failure worth knowing how to repair is a run that
died after publishing: do **not** re-run the job, which would try to publish a
version that already exists. Cut the Release by hand instead:

```bash
node scripts/changelog-section.mjs x.y.z > /tmp/notes.md
gh release create vx.y.z --title vx.y.z --notes-file /tmp/notes.md --verify-tag
```

Ordinary pushes and pull requests run `ci.yml` — the same typecheck and tests,
plus a real `npm run build`, so the browser bundle's wrapper is exercised
somewhere other than inside `npm publish`.

## License

MIT
