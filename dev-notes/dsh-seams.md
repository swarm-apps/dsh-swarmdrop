# dsh 的扩展点：一个第三方插件真正能用的部分

写于 2026-08-21，对着 dsh `0.1.0-rc.8` 的源码核实过。**这不是 dsh 的文档**，是「我们撞过
之后知道哪些说法成立」的那一份——每条都标了判据在哪。

dsh 自己的文档在它仓里；这份只记**第三方插件视角**的事实，尤其是那些「看起来能做、其实
不能」和「看起来不能、其实能」的。

---

## 一句话推翻的旧认知

本仓的 `src/client/index.ts` 与 README 曾经写着「dsh 给第三方插件没有 Client→Node RPC」。
**不成立。** `ctx.connection.rpc.handle(channel, handler, options)` 就是给插件挂自己通道的
座位，`rpc.call` 是浏览器那半。

那句话想说的东西仍然成立，只是范围小得多，值得精确复述一遍：

| 数据 | 载体 | 判据 |
|---|---|---|
| 对话行、`@` 候选 | **会话日志** | 它们必须在刷新、翻历史、三个月后重放时逐字重建 |
| 节点在不在跑、设备在不在线、网络状态 | **RPC 通道** | 它们是「此刻」的事实；写进可重放的日志会让日志说谎 |

一条绕过会话日志去喂 transcript 的旁路，用户一刷新就散架。一条声称「节点是开着的」的会话
事件，是把某一瞬间的断言永久保存下来，下次读还当真。

---

## Slot：浏览器 UI 的唯一注册面

`ctx.slots.inject(name, () => ctx.slots.register(options, Component))`。

全部 47 个 slot 由 `packages/client/*/src/client/**` 的 `SlotMap` 声明合并给出。与我们相关的：

| Slot | kind | scope | 用途 |
|---|---|---|---|
| `sidebar.footer.action` | list | root | **本插件的面板挂这里**。「设置」旁边的常驻座位 |
| `shell.overlay` | list | root | 全框浮层。自由度最高，但没有入口、chrome 全自己画 |
| `settings.section` | list | root | 一整个设置分区（导航行 + 页面） |
| `settings.plugin.item` | keyed | root | 插件配置卡，**key 是 settings namespace** |
| `settings.onboarding` | list | root | 首启引导步骤 |
| `conversation.chat.node` | keyed | session | 对话行（本插件的传输行与收件行） |
| `conversation.session.header.actions` / `.utilities` | list | session | 会话头部按钮 |
| `tool.call.toolview` | keyed | session | 按工具名定制它的调用卡 |

### 为什么面板选 `sidebar.footer.action`

三条，缺一条就该换地方：

1. **scope 对。** SwarmDrop 的节点是机器级的，不属于任何会话。session scope 的座位意味着
   「没开会话就看不见节点死了」。
2. **常驻可见。** 用户的抱怨核心是「我不知道节点没在跑」。徽标是唯一能永远显示这件事的
   位置；设置页里的卡片解决不了它——没人为了查故障去开设置。
3. **有同形先例。** `packages/extensions/ui-cordis` 的 `CordisPanel` 挂的就是这里，做的正是
   「一个机器级子系统的运行控制」。

⚠️ 那个包的 README 说自己挂 `shell.overlay`，**是过时的**；代码与生成的 slot catalog 一致
指向 `sidebar.footer.action`。

### 组件永远拿不到 `ctx`

硬规则，写在 `packages/client/AGENTS.md`。数据与回调经 `register` 的 `inject` 面塞进 props：

```ts
inject: (): MyFace => ({
  hooks: { panel: someObservable },   // {getSnapshot, subscribe}
  onDoThing: () => { … },
})
```

`hooks` 是保留字段：`hooks.panel` 在组件那侧变成 prop `usePanel(selector)`。其余字段原样
成为 props。组件的 props 类型写成
`PropsRuntime<'slot.name'> & InjectFace<MyFace> & PropsLocale<'myns'>`。

---

## Client→Node：三条路，一条适合插件

| 路 | 能不能用 | 判据 |
|---|---|---|
| `ctx.connection.rpc.handle` + `rpc.call` | ✅ **本插件用这条** | 挂一个自己的 channel 前缀，零代码生成 |
| Typert `@Remote` + `$mount` | 可以，但要产物 | host 侧靠运行时反射（无白名单），client 侧要一份 descriptor（`dsh-typert-generator` 已发布） |
| `ctx.remote.commands.execute(sessionId, line)` | 可以，是官方认可的 | 但要一个活会话、每次点击在日志里留一行、只拿得回 admission 语义 |

### `rpc.handle` 的契约（`packages/client/connection/src/rpc-host.ts`）

```ts
ctx.inject(['connection'], c => {
  c.connection.rpc.handle(
    '/swarmdrop',
    async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult<unknown>> => …,
    { authority: 'trusted-host' },
  )
})
```

不可动的五条：

1. **`handle` 不是 `intercept`。** 后者只认 `/api` 且**全局只许一个**，那个位子被
   `TypertGatewayService` 占了。用 `intercept` 会在加载时抛 "already has an interceptor"。
2. **channel 只能一段。** `CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/`，`/acme/swarmdrop` 非法；
   要命名空间就写 `/acme.swarmdrop`。它是 webserver 的**前缀路由**，重名同步抛错。
3. **error code 是封闭 union。** 实际可用的只有 `bad-request`（要 `details:{issues:[]}`）、
   `internal`（`details:{}`）、`cancelled`。浏览器那半用 zod 解响应，**未知 code 会让
   `rpc.call` 抛 ZodError 而不是返回 `{ok:false}`**。
4. **业务失败不要 throw。** handler 抛出去只会变成裸 HTTP 500 + 文本体，浏览器分不清
   「服务器挂了」和「这一次失败了」。业务失败走返回值。
5. **不要 inject `webServer`。** `rpc.handle` 经 cordis 的 shadow context 在 connection 自己
   的 fiber 上解析它；写上只会让插件白等一个服务。

`handler` 收到的 `signal` 是**请求自己的** AbortSignal，浏览器走开时它 abort——所以**长轮询
可行**，且 host 侧没有超时（要自己设上限，代理会在 30–60s 掐掉空闲连接）。

### `authority` 取 `trusted-host` 而不是 `loopback`

面板能启停节点、解除配对，直觉是锁到 localhost。但那会是一道**与其他东西不同**的栅栏：
dsh 自己的 `/api`——agent 借它跑任意 shell 命令——就是 `trusted-host`。从另一台机器连到
自己 dsh 的人，能做的事远多于这条通道；而 `loopback` 在那种部署下的失败形态是**硬 403 +
纯文本**，面板静默死掉，是一份 bug 报告而不是一次安全收益。

---

## 只能拉，不能被推

dsh 把 Host 的 cordis 事件转发给浏览器，**走的是一张固定 allowlist**
（`packages/api/remotes/src/remote-events.ts` 的 `API_REMOTE_FORWARDED_EVENTS`，11 条），
第三方**加不进去**。

所以第三方插件的机器状态只有两条路到浏览器：

- **会话事件**（`session.append` 的转发**没有**白名单）——但那要求数据属于会话；
- **自己轮询**。

本插件用**长轮询**：host 侧把请求 park 到状态真的变了才答。它不是「退而求其次的推送」——
请求在变化发生时**已经挂在那里**，答案立刻发出，而不是等下一次定时器。

## 会话事件：一个第三方插件撞得到的硬缺口

dsh 拒绝读取含有它不认识的事件类型的会话日志，除非那条事件带 `ignorable: true` 标记
（`packages/session/session-persistence/src/coordinator.ts` 的 `assertEventsSupported`）。

**两条逃生口对第三方插件都不通**：

- 已知集合是 `KNOWN_SESSION_EVENT_TYPES`，**由 dsh 仓内声明的类型生成**；
- `Session.append()` 自己造 envelope，**没有任何参数能设 `ignorable`**。

dsh 知道这件事——`known-event-types.ts` 写着仓外插件事件「outside the list by construction;
a registration surface for them is deferred until such a consumer exists」。

后果很重：发一次文件就写下 `swarmdrop/sent`，此后**那个会话整个打不开**（不是少几行，是
整份日志被拒）。

我们的缓解是 `announceEventTypes()`：加载时把四个类型 `add` 进那个 `ReadonlySet`（运行时
它是个真 Set）。**两个它修不了的地方，都要如实说**：

1. 没有插件的 harness 仍然打不开那些会话——所以文档写「要停就 disable，别 uninstall」。
2. 它依赖插件与 dsh **解析到同一个 `@deepseek-ai/dsh-session` 模块实例**。普通安装成立；
   **dsh 从源码 checkout 用 `tsx` 跑时不成立**——两边拿到各自的模块图，`add` 落在一份没人
   读的副本上。实测过：插件那侧 48→52，coordinator 那侧恒 48。

正路是给 dsh 提 issue，让写入方能标 `ignorable`。

---

## 打包与加载

- `package.json` 的 **`dsh.bundle.patch`** 指向一份 `cordis.patch.yml`——**没有它，
  `dsh plugin add` 装得上但什么都不激活，且没有任何报错**。
- `dsh.client` 声明浏览器半边；产物必须自己包成
  `window.__ModuleLoader__.load({ id, factory: (require) => … })`，`id` 必须等于包名。
  dsh 的打包 preset 未发布，本仓的 `scripts/build-client.mjs` 是那 30 行的手写复刻。
- **dsh 的包必须进 `peerDependencies`**，否则 tsdown 会把它们打进 bundle——那样页面里会有
  第二份 UI kit，拿不到主题也拿不到服务实例。
- **没有 CSS 管道。** 仓内组件用 CSS module，第三方 bundle 没有那一层，所以本插件的面板用
  inline style 引用 dsh 自己的 `--dsw-*` 变量——主题（含暗色）照样跟随，且不必自建构建步骤。
- npm 上 `@deepseek-ai/*` 的 **`latest` 标签停在旧的 `0.0.1-rc.x` 线**，实际在维护的是
  `0.1.0-rc.x`。查版本用 `npm view <pkg> versions`，别信裸 `version`。
- settings namespace 注册后**不会立刻**出现在设置页的插件 tab 里——那份镜像只在 settings
  文档提交与连接重置两个信号上重读。首次装完刷一下页面。

---

## 可复用的具体位置

| 要找什么 | 去哪看 |
|---|---|
| 一个挂 `sidebar.footer.action` 的完整先例 | `packages/extensions/ui-cordis/src/client/` |
| `settings.plugin.item` 的端到端配方 | `docs/cookbook/adding-a-settings-card.md` |
| RPC 两侧的类型 | `packages/client/connection/src/rpc.ts` |
| 可用的 UI 组件与图标 | `packages/client/ui-primitives/src/index.ts` |
| 全部 slot 的生成目录 | `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` |
