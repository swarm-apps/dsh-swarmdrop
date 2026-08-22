## 1. SwarmDrop 仓库：CLI 的 QR 出口（跨仓前置，见 design D1/D2）

> 这一组的编辑对象是 `../SwarmDrop`，不在本仓库内。它落地前，第 3 组之后的任务都可以
> 照常进行——降级路径本来就要做（design Migration Plan 第 2 步）。

- [x] 1.1 `crates/cli/src/cmd/mod.rs`：`InviteAction` 增加 `Qr { invite, size }` 变体，
      按该文件既有风格写 clap 文档注释（说明 `size` 是二维码实际占据的边长，同时是地址预算）
- [x] 1.2 `crates/cli/src/cmd/invite.rs`：`run` 的 match 增加 `Qr` 分支，调
      `swarmdrop_invite::invite_qr_svg`，不触节点、不走 IPC
- [x] 1.3 `crates/cli/src/render/invite.rs`：`render_qr()` 把 SVG 写 stdout；`--json` 时
      包成一行对象。在文件头注释里写明「终端不画码」与「给程序输出 SVG」是两件事，
      避免下一个人以为 `:11` 那条决定被推翻
- [x] 1.4 加一个回归测试：给定确定性邀请，`invite qr --size 240` 的产出模块数与
      `invite_qr_svg` 的直接调用一致
- [x] 1.5 发布 0.9.0 —— 已发（tag `cli/swarmdrop-cli-v0.9.0`，npm/homebrew/GitHub
      Release 均已产出）。更正一处：CLI **有**自己手写的 `crates/cli/CHANGELOG.md`
      且 `release-cli.sh` 会硬性校验版本条目；git-cliff 生成的是根 CHANGELOG（桌面端
      版本线），两者无关

## 2. 本仓 Node 侧：把 SVG 接上管线

- [x] 2.1 `src/cli.ts`：加 `qr(invite: string, size: number): Promise<string>`，走既有
      一次性调用的封装；进程失败按该文件的 `explain*` 惯例给出可读原因
- [x] 2.2 `src/panel-wire.ts`：加 `ENDPOINT_PAIR_QR` 与其请求/应答类型，登记进
      `PANEL_ENDPOINTS`；在文件头那张「事件 vs 状态」表里补一行说明它为什么不进
      `PairingSnapshot`（design D3）
- [x] 2.3 `src/panel.ts`：路由 `ENDPOINT_PAIR_QR` 到 2.1；参数按该文件既有做法做防御性
      读取（不信任浏览器传来的 size）
- [x] 2.4 `src/cli.test.ts` 补一例：`qr()` 的参数拼装与失败路径

## 3. 浏览器侧：配对界面析出为独立模块（design D7）

- [x] 3.1 新建 `src/client/pairing-modal.tsx`，文件头说明这个模块为什么独立于
      `panel.tsx` 与 `console-ui.tsx` 存在
- [x] 3.2 实现 `InviteQrCard`：固定深模块 + 白底白卡，**不使用 `--dsw-*` 变量**
      （design D9，注释里写明理由）；加载中给骨架而非空白；接受一个「不可得」的覆盖态
- [x] 3.3 实现 `PairInviteDialog`：二维码为主体，「复制链接」「打开链接」「取消配对」
      三个动作；不渲染邀请链接原文；复制失败时明示失败而非显示「已复制」
      （沿用 `panel.tsx` 现有 `writeClipboard` 的处理方式，一并迁入）
- [x] 3.4 `PairInviteDialog` 在拿到 invite 后请求一次二维码，`size = 240`；
      对话框宽度必须容得下 240px 码面，容不下时走「不可得」覆盖态而**不缩码**
      （design D8 的硬约束）
- [x] 3.5 实现 `PairingRequestDialog`：`RequestCard` 的内容整体迁入，完整 peerId 不截断，
      接受/拒绝两个动作
- [x] 3.6 `src/client/panel-port.ts`：加 `qr(invite, size)` 动词，按该文件既有的
      `act()` 模式接线

## 4. 面板改造

- [x] 4.1 `src/client/panel.tsx`：`PairingSection` 瘦成——idle 时一个「添加设备」按钮，
      桌子开着时一行「配对中 · 等待设备 [查看]」，paired 时保留既有的完成行
- [x] 4.2 把 `PairInviteDialog` 与 `PairingRequestDialog` 挂在组件顶层、**popover 之外**
      （design D4；挂进 popover 内等于没改）
- [x] 4.3 删除 `inviteStyle` 与 `WaitingForDevice`、`RequestCard`（已迁出）
- [x] 4.4 删除 `:313` 那段「配对置顶」的排序逻辑与它的注释——请求对话框接管了它的职责
- [x] 4.5 重写 `:629` 那段「这里不画二维码」的注释：它是本次改动的直接对象，
      新注释要说明码现在从哪来、以及为什么不在浏览器里编码（design D1）
- [x] 4.6 关窗语义接线：Escape / 遮罩只关对话框，`cancelPair()` 只挂「取消配对」
      （design D5）

## 5. 控制台接入

- [x] 5.1 `src/client/index.ts`：`SwarmDropConsoleFace` 的 `inject` 补上
      `onBeginPair` / `onCancelPair` / `onRespondPair`，走同一个 `port`
- [x] 5.2 `src/client/console.tsx`：`SwarmDropConsoleFace` 接口补上对应三个方法
- [x] 5.3 `src/client/console-sections.tsx`：Invites 页加「添加设备」，打开
      `PairInviteDialog`；**不**挂请求对话框（design D4）
- [x] 5.4 确认两处的进行中指示不重复到刺眼（design Risks 最后一条）

## 6. 文案与版本门槛

- [x] 6.1 `src/client/locales.ts`：删除或改写 `pairingHint`（「打开链接，页面会显示
      二维码」已不成立）；新增中英各一份的键——配对中、查看、取消配对、扫码指引、
      二维码不可用、二维码加载中
- [x] 6.2 `src/client/format.ts`：`MINIMUM_CLI` → `0.9.0`，并更新它上方那段解释门槛
      由来的注释（补上「0.9.0 加了 `invite qr`，配对界面的二维码依赖它」）

## 7. 验证

- [x] 7.1 `npm run typecheck`（两个 program 都过）与 `npm test` 通过
- [ ] 7.2 面板收起状态下触发一次入站配对请求，确认对话框仍然弹出并可决策
      （spec: 入站配对请求以对话框抵达决策者）
- [ ] 7.3 Settings 打开时再触发一次，确认只出现一份请求对话框
- [ ] 7.4 关闭邀请对话框后确认配对桌仍在：面板出现进行中指示，由它可重新打开；
      点「取消配对」后指示消失（spec: 配对桌的存续与界面开合解耦）
- [ ] 7.5 用手机扫一次弹窗里的二维码，走通一次真实配对
- [ ] 7.6 暗色主题下确认白卡与卡内文字仍可读（design D9）
- [x] 7.7 把 PATH 上的 swarmdrop 换成 0.8.x，确认插件报「版本过旧」而不是二维码渲染失败

## 8. 文档

- [x] 8.1 `CHANGELOG.md`：新增一节，`MINIMUM_CLI` 抬到 0.9.0 标为 **BREAKING**
- [x] 8.2 `README.md`：更新第 40 行附近那段配对说明（「链接打开 SwarmDrop 自己的页面，
      那页画二维码」已不再是面板的行为）与第 140 行附近的 CLI 版本要求
