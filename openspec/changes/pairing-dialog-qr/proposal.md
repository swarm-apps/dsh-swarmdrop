## Why

面板里的配对是**照着 CLI 的形态抄的**，可它跑在浏览器里。CLI 不画二维码有实打实的理由
（`crates/cli/src/render/invite.rs:11`：69 模块 = 69 列 × 35 行，塞不进 80×24 的终端，
换象限块又会压成 2:1 扫不出来），于是它打印链接并告诉用户「去浏览器打开，那儿有码」。
这套说辞被原样搬进了 `panel.tsx:629`，结果是 SwarmDrop 四个图形界面里，唯一一个把
两百多字符的邀请链接怼在用户脸上、且不给二维码的，是这个本来最该给码的浏览器面板。

同一处还藏着一个真缺陷：入站配对请求内联在 sidebar popover 里，面板一关就没人能答，
对面只能等超时。`panel.tsx:313` 那段把配对区块置顶的排序逻辑，就是在跟这个问题搏斗
而没解决它。

## What Changes

- **配对升为两个 Modal**，不再是 320px popover 里的一段：
  - 生成弹窗——二维码是主体，由「添加设备」打开
  - 请求弹窗——`phase === 'deciding'` 时**无条件弹出**，与面板开合无关
- **二维码进入生成弹窗**，SVG 由 CLI 新出口 `swarmdrop invite qr` 产出，复用
  `crates/invite/src/qr.rs` 的三端统一编码（原样编码 + 最优分段 + ECL::M + quiet zone
  + 按码面预算回收地址提示）。浏览器端不引入第二份 QR 实现
- **邀请链接原文不再展示**（`inviteStyle` 那块 mono 文本块删除），只保留「复制链接」与
  「打开」两个按钮——「打开」必须留：dsh 可能就跑在手机浏览器里，那时二维码扫不了自己
- **关闭生成弹窗不撤销配对桌**。面板改留一行「配对中 · 等待设备 [查看]」可重新打开；
  杀掉 CLI 进程的唯一入口是弹窗内的「取消配对」
- **Settings 控制台加配对入口**，复用同一个生成弹窗；请求弹窗**只由面板持有**，
  避免 Settings 打开时两层遮罩
- **BREAKING**：`MINIMUM_CLI` 从 `0.5.0` 抬到 `0.9.0`。它判的是整个插件是否 inert，
  所以停在 0.8.x 的 Homebrew 副本会被整体判为过旧，而不只是扫不了码

## Capabilities

### New Capabilities

- `pairing-surface`: 面板与控制台上的配对界面——邀请以二维码呈现、配对请求以对话框
  抵达决策者、配对桌的存续与界面开合解耦，以及这三件事在两个 surface 之间的归属划分

### Modified Capabilities

（本仓库 `openspec/specs/` 此前为空，无既有能力被修改。）

## Impact

**前置：SwarmDrop 仓库（`../SwarmDrop`，需先发 0.9.0）**

| 文件 | 改动 |
|---|---|
| `crates/cli/src/cmd/mod.rs` | `InviteAction` 增加 `Qr { invite, size }` |
| `crates/cli/src/cmd/invite.rs` | 一个纯计算分支 → `swarmdrop_invite::invite_qr_svg`（不碰节点、不碰 IPC；`crates/cli/Cargo.toml:57` 已依赖该 crate） |
| `crates/cli/src/render/invite.rs` | `render_qr()`；并在文件头说明「终端不画码」与「给程序输出 SVG」是两回事 |

**本仓库**

| 文件 | 改动 |
|---|---|
| `src/cli.ts` | `qr(invite, size)` 一次性调用 |
| `src/panel-wire.ts` | `ENDPOINT_PAIR_QR`（不进 `PairingSnapshot`——它走 `ENDPOINT_STATE` 长轮询，每次刷新背几 KB SVG 不可接受） |
| `src/panel.ts` | 路由一条 |
| `src/client/panel-port.ts` | `qr()` 动词 |
| `src/client/format.ts` | `MINIMUM_CLI` → `0.9.0` |
| `src/client/pairing-modal.tsx` | 新文件：两个 Modal，面板与控制台共用 |
| `src/client/panel.tsx` | `PairingSection` 瘦成状态行；`WaitingForDevice` / `RequestCard` 迁出；`inviteStyle` 删除；`:629` 与 `:313` 两段注释重写——它们正是本次改动的对象 |
| `src/client/console-sections.tsx` | Invites 页加「添加设备」入口 |
| `src/client/index.ts` | console 的 `inject` 补上三个配对动词（同一个 `port`，`PairingSession` 本就是机器级单例） |
| `src/client/locales.ts` | `pairingHint` 那句「打开链接，页面会显示二维码」失效；新增配对中 / 查看 / 取消配对 / 二维码不可用等键，中英各一份 |

**依赖**：不新增 npm 依赖。`Modal` 已由 `@deepseek-ai/dsh-client-ui-primitives` 提供且已在
`dsh.client.inject` 中。
