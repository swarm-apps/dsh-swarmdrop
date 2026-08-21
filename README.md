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

It comes along as an optional dependency. If you already have it
(`brew install swarm-apps/tap/swarmdrop`, or the install script), set
`SWARMDROP_BIN` to point at it instead.

**`swarmdrop` 0.4.0 or newer is required** — that is the release that added
`swarmdrop watch`, which this plugin subscribes to.

**Pair a device first** — the plugin has nothing to talk to otherwise:

```bash
swarmdrop invite create      # scan the QR from your phone's SwarmDrop app
```

Nothing here requires a SwarmDrop node to be running: the plugin loads cleanly on
a machine where you have not started one, and the tools say so rather than
failing mysteriously.

## Tools

| Tool | What it does |
|---|---|
| `swarmdrop_send_files` | Send files or directories to one of your devices. |
| `swarmdrop_send_text` | Send a short message to a device's inbox. |
| `swarmdrop_list_devices` | Your paired devices and whether they are online. |
| `swarmdrop_list_inbox` | What your devices have sent this machine. |
| `swarmdrop_inbox_files` | Local paths of one inbox entry's files. |

`presence` is three-valued (`online` / `offline` / `unknown`). `unknown` means no
SwarmDrop node is running to probe with — it is not the same as offline, and the
distinction is the difference between "your phone is asleep" and "start SwarmDrop".

## How it is put together

```
src/
  cli.ts         the `swarmdrop` binary: one-shot calls + the NDJSON subscription
  bridge.ts      machine-wide subscription  →  per-session events
  projection.ts  the inbox roll, as a Session projection (what `@` reads)
  tools.ts       what the model can call
  command.ts     what you can type
  types.ts       the Session event family this plugin owns
  client/        the browser half: conversation rows + the `@` source
```

Three decisions worth knowing before changing anything:

**The browser half has no back channel, by design.** dsh gives third-party
plugins no Client→Node RPC — UI state has to rebuild from the persisted event
log, and a bypass would break the moment you refresh, page history, or open the
same session twice. So the `@` menu reads a *session projection*: the Node half
registers a pure fold, the framework drives it over committed events in log
order, and the browser receives a finished value. The upside is that this works
under every dsh carrier — including reaching a dsh at home from your phone.

**Events record what happened, not what is.** `swarmdrop/sent`,
`swarmdrop/inbox-received` and `swarmdrop/transfer` are things that occurred at a
point in time, so replaying a conversation months later still explains it. The
one whole-value event, `swarmdrop/inbox-baseline`, answers "what did you have at
hand when this started" — which is exactly the context a reader needs.

**Every payload carries a `version`.** These land in your session log, which
outlives the process and gets replayed. A format change that still parses but
means something different is the worst failure available.

## Development

```bash
npm install
npm run typecheck   # both halves
npm run build       # lib/index.js + lib/client.js
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
tsdown preset that is not published, so `scripts/build-client.mjs` reimplements
the wrapper; it is 30 lines. `id` must equal the package name, because that is
the entry name the host composed into `window.__DSH_BOOT__`.

Two things a reader will otherwise rediscover the hard way:
Two things a reader will otherwise rediscover the hard way:

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

## License

MIT
