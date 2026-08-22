## Context

动机见 `proposal.md — Why`；要满足的行为见 `specs/pairing-surface/spec.md`。这里只记
决定实现形态的那几条既有事实：

- **配对桌是一个活的 CLI 进程。** `PairingSession`（`src/pairing.ts`）持有
  `invite create --json --decide-from-stdin`，机器级单例，`cancel()` 杀进程即关桌。
  面板与控制台已经共用同一个 `port`（`src/client/index.ts`），所以「同一张桌子」是现状，
  不是要新建的东西。
- **二维码的编码在 SwarmDrop 仓库是单点。** `crates/invite/src/qr.rs` 服务桌面端
  （Tauri command）、落地页（wasm）、移动端（matrix），文档里点名要避免的正是「各端
  JS 库各写一遍导致漂移」。**CLI 是唯一没有 QR 出口的那个**，而本插件只能通过 CLI 说话。
- **`fit()` 按码面预算回收地址提示。** 它需要 `SignedInvite::decode` 解结构再重编码，
  浏览器侧做不到。且回收到无可回收时它**不报错**，而是交出那张超预算的码
  （`qr.rs` 的 `if !drop_least_valuable_addr(..) { return attempt }`）——密度不足是静默的。
- **面板的样式全部内联、走 `--dsw-*` 主题变量**（`panel.tsx` 文件头解释了为什么不引
  CSS module）。二维码是这套主题里唯一一块**必须不跟随主题**的区域。
- `Modal` 已由 `@deepseek-ai/dsh-client-ui-primitives` 提供（portal + 遮罩 + Escape +
  `headless`），且该包已在 `dsh.client.inject` 中。不需要新依赖。

## Goals / Non-Goals

**Goals:**

- 二维码与三端同源：本插件成为 `crates/invite/src/qr.rs` 的第四个消费者，而不是第二份实现
- 配对的两个环节各自获得与其重要性相称的画布，且请求决策不再依赖面板是否展开
- 配对界面从 `panel.tsx` 里析出为独立模块，面板与控制台共用同一份实现

**Non-Goals:**

- 不做桌面端 `/pairing/generate` 的全套配套：TTL 倒计时、「仅本地网络」开关、
  重新生成、三步指引一律不做。桌面端有一整页可用，这里是一个对话框
- 不做「粘贴邀请」方向（桌面端的 `/pairing/input`）。本插件是签发方，消费邀请是对端的事
- 不改配对协议、不改 `PairingSession` 的状态机（四个 phase 原样保留）
- 不为老版本 swarmdrop 保留无二维码的降级路径——见 D6

## Decisions

### D1 · 二维码由 CLI 产出，浏览器只渲染

**决定**：在 SwarmDrop 仓库给 CLI 开一个 QR 出口，本插件 Node 侧调用它拿 SVG 字符串，
浏览器侧只负责塞进白卡。

**备选**：在 client bundle 里引一个 JS QR 编码器（约 10–20KB）。**否决理由不是洁癖**：
`fit()` 的地址回收需要解开邀请结构，JS 侧做不到；而码面偏小时它又不报错，只交出一张
密度不足的码——两端会在「扫不动」这件事上无声分叉，且分叉发生在用户的手机上而不是
我们的测试里。`qr.rs` 的模块文档已经把这条路写成了要避免的东西。

**代价**：本仓库的落地被一个跨仓库发布挡住（见 Migration Plan）。

### D2 · CLI 出口做成独立子命令，而不是 `inviteCreated` 的字段

**决定**：`swarmdrop invite qr <invite> --size <px>`，纯计算，不碰节点也不碰 IPC，
SVG 走 stdout。

**备选**：`invite create --json --qr-size N` 在 `inviteCreated` 事件里多带一个 `qrSvg`。
省一次进程，但把码面尺寸焊死在开窗那一刻——而尺寸是 `fit()` 的地址预算，尺寸变了要重裁。
独立子命令让任何调用方按自己的码面各要各的，也不把渲染关注点塞进配对流。

**注意**：这与 `crates/cli/src/render/invite.rs:11`「终端里不画二维码」不冲突。那条拒绝的
是在终端里画 ASCII 码（69 列 × 35 行塞不进 80×24，换象限块会压成 2:1 扫不出来）；这里是
把 SVG 交给一个程序调用方。实现时应在该文件头写明这个区分，否则下一个人会以为它被推翻了。

### D3 · SVG 走独立 endpoint，不进 `PairingSnapshot`

**决定**：新增 `ENDPOINT_PAIR_QR`，浏览器拿到 invite 后按码面尺寸请求一次。

**备选**：把 SVG 放进 `PairingSnapshot`。但快照走 `ENDPOINT_STATE` 的长轮询，每次状态
刷新都要背一整张 SVG——**实测一条真实邀请的码是 64,832 字符**（583 字符的邀请编成 89
模块，每模块一段 path），比动手前估的「几 KB」大一个数量级。`panel-wire.ts:23` 已经定下的划分正好适用：
「设备与节点存活是*事件*，走 state；没人宣告的事实是*状态*，要问才有」——二维码属于后者。

### D4 · 请求对话框只由面板持有

**决定**：`phase === 'deciding'` 的对话框只在 `SwarmDropPanel` 里渲染；控制台只渲染
邀请对话框。

**理由**：`sidebar.footer.action` 是 `scope: 'root'` 且常驻挂载（按钮一直在），把对话框挂
它顶层就天然全局——`panel.tsx:313` 那段把配对区块置顶的排序 hack 因此可以整段删掉。
若控制台也挂一份，Settings 打开时会出现两层遮罩、两套按钮。

**必须注意**：对话框要挂在 popover **之外**的组件顶层。挂在 popover 内则 popover 一收
对话框跟着卸载，等于什么都没解决。

### D5 · 关窗不撤桌，「取消配对」是唯一杀桌入口

**决定**：Escape / 点遮罩只关对话框；`PairingSection` 在桌子开着时渲染一行
「配对中 · 等待设备 [查看]」，由它重开对话框；`cancelPair()` 只挂在对话框内的
「取消配对」上。

**理由**：这两件事在真实流程里必然错开——复制完链接要切窗口去粘贴，对话框必然被关。
而 `src/pairing.ts` 文件头写着关桌子的分量：它是泄露的邀请链接与陌生人设备之间唯一的
东西。让一次误触的 Escape 承担这个语义太重，让一个明确标注的按钮承担刚好。

### D6 · 抬 `MINIMUM_CLI`，不给配对单设门槛

**决定**：`src/client/format.ts` 的 `MINIMUM_CLI` 从 `0.5.0` 抬到 `0.9.0`。

**已知代价**（用户已确认）：`isTooOld()` 判的是整个插件是否 inert，所以停在 0.8.x 的
Homebrew 副本会被整体判为过旧，而不只是扫不了码。**备选**是像 `explainPairingExit()`
对 0.5.0 那样再加一条配对专属特判，但那意味着长期维护两个门槛和两条渲染路径；这次选
一个门槛。CHANGELOG 需要把这条写成 BREAKING。

### D7 · 配对界面析出为独立模块

**决定**：新建 `src/client/pairing-modal.tsx`，导出两个对话框组件与它们共用的白卡。
`panel.tsx` 里 `PairingSection` 瘦成一行状态 + 挂载点，`WaitingForDevice` 与 `RequestCard`
整体迁入新文件。

**理由**：这两个对话框现在有了第二个消费者（控制台）。留在 `panel.tsx` 里就得从面板
反向导出，而 `panel.tsx` 已经 829 行且它的职责是「面板」。`console-sections.tsx` 与
`panel.tsx` 之间此前没有共享 UI，`console-ui.tsx` 是控制台专用的——所以新文件是正确的
落点，不是 `console-ui.tsx` 的扩写。

### D8 · 码面固定 240px，并由界面保证下限

**决定**：向 CLI 请求 `size = 240`，与桌面端（`generate.lazy.tsx` 的 `InviteQr size={240}`）
一致；对话框宽度必须容得下 240 + 白卡内边距。

**理由与硬约束**：240px 的预算是 120 模块，典型邀请 69 模块——**不触发裁剪**，所以本插件
拿到的码与桌面端同 version。而码面低于约 138px 时 `fit()` 会一路裁到无可裁，然后**不报错
地**交出一张密度不足的码。因此「不要把码面缩到 138px 以下」是界面这一侧的责任：视口窄到
放不下 240px 的对话框时，走「二维码不可得」的降级说明（spec 里那条），而不是缩码。

### D9 · 二维码固定深模块 + 白底，不跟随主题

**决定**：白卡与卡内一切文字用固定色值，**不用** `--dsw-*` 主题变量。

**理由**：摄像头对反色 QR 识别很差。这是本插件里唯一一块要脱离主题的区域，而面板的样式
全是内联主题变量——很容易顺手写成 `var(--dsw-...)`，暗色主题下就变成浅灰压白底、既不可读
也扫不动。桌面端的 `invite-qr.tsx` 文件头把这条单独写成一段警告，这里同样值得。

## Risks / Trade-offs

- **跨仓串行**：CLI 0.9.0 未发布前，本仓的二维码路径无法端到端验证 →
  开发期用本地 `cargo build` 的二进制（`SWARMDROP_CLI` 那条 PATH 查找已经支持指定副本），
  先把 UI 与降级路径做完，二进制到位后补端到端。
- **0.8.x 用户整体 inert**：见 D6，用户已确认 → CHANGELOG 标 BREAKING，
  About 页本就有「版本过旧」的行，抬门槛后它自然承担告知。
- **每次开窗多一次进程 spawn** → 配对是低频动作（桌面端注释也这么判断），可接受。
- **点击对话框会让面板 popover 收起**（`useDismissOnOutsidePointer` 把 portal 里的点击
  判为外部点击）→ 这正是期望的观感（打开配对，面板让位），但必须是显式确认过的行为，
  且前提是 D4 的挂载位置正确。
- **控制台的对话框与面板的状态行同时可见** → 两者读同一份快照，不会打架；但需要确认
  控制台里的进行中指示不与面板重复到刺眼。

## Migration Plan

1. **Phase 0（`../SwarmDrop`）**：加 `invite qr` 子命令，发 0.9.0。纯加法，无既有行为变更，
   不需要回滚策略。
2. **Phase 1（本仓）**：先落 UI 与降级路径（二维码不可得时的呈现），再接 `pair.qr`。
   这个顺序让 Phase 0 未落地时本仓仍可开发和演示。
3. **Phase 2**：抬 `MINIMUM_CLI`、更新 CHANGELOG 与 README 的配对段落。

**回滚**：本仓 revert 即可恢复内联形态；CLI 侧的新子命令留着无害。

## Open Questions

- 控制台的配对入口放在 Invites 页顶部还是 Overview 页？两处都自洽，且不影响 spec、
  接口或任务拆解，实现时看版面决定即可。
