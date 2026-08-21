# 构建链路：哪一段该交给 tsdown，哪一段不该

写于 2026-08-22，对着本仓当前状态、`tsdown 0.22.14` / `rolldown 1.2.5` /
`rolldown-plugin-dts 0.27.14` 实测过。下面每条「实测」都真跑过并对比了产物，
标「取舍」的是没有唯一正确答案的。

起因是两个问题：`scripts/build-client.mjs` 是不是本该由打包器做的事？
`build:node` / `build:client` 两条线能不能合并？

> **本文修订过一次。** 初稿反对把 client 的 d.ts 交给 tsdown，理由是 bundle
> 会吃掉文件顶部的模块级 JSDoc。这条理由**经实测不成立**，已改写——见
> 「一条被自己推翻的理由」。
>
> **已落地**（2026-08-22）。落地时多解决了一个调研阶段没想到的问题：`clean`
> 的顺序——见「落地时改掉的一处」。

---

## 结论先行

| 问题 | 答案 |
|---|---|
| `build-client.mjs` 能否被 tsdown 配置替代 | **能，产物逐字节一致**。用 `banner` / `footer`，30 行脚本归零 |
| client 的 d.ts 能否也交给 tsdown | **能，12 个导出符号双向类型等价**（实测，含反向验证） |
| 两条 build 线能否合并 | **client 侧能合成一次 tsdown**；Node 侧留给 tsc |
| 4 个 tsconfig | **减到 3 个**：`tsconfig.client.build.json` 可删 |
| Node 侧改用 tsdown bundle | **取舍题**，倾向不换，理由只剩产物可调试性 |

净效果：`build` 从五段变两段，删掉一个脚本、一个 tsconfig、一条 300 字符的
命令行。**产物逐字节不变。**

---

## 现状：五段流水线

```
build:node    tsc -p tsconfig.build.json           → lib/*.js（17 个）+ lib/types/*.d.ts
build:client  ├─ tsc -p tsconfig.client.build.json → lib/types/client/*.d.ts（只 emit 声明）
              ├─ tsdown … --out-dir .client-build  → .client-build/index.cjs
              └─ node scripts/build-client.mjs     → lib/client.js（套壳）+ 删 .client-build
```

第五段做三件事：套 `window.__ModuleLoader__.load({ id, factory })` 壳、剥
sourcemap 注释、清中间目录。**只有第一件是它独有的**——另外两件是「因为用了
中间目录」才产生的工作。

两半必须是独立 TS program（dsh 对 `Context.sessions` 的 augmentation 在两侧
不同），这条约束不因换工具而消失：它决定的是「几个 program」，不是「几个工具」。
tsdown 的 `tsconfig` 选项按 config 指定，约束照样满足。

---

## 一条被自己推翻的理由

初稿写：dts bundle 会丢掉 `src/index.ts` 顶部那段 40 行模块文档，而注释是这个
仓的资产，所以 d.ts 必须继续由 tsc 出。

**前半句是事实，后半句不成立。** 那段注释在 `.d.ts` 里紧跟着的是 `import`
语句，不是任何导出符号——TypeScript 把 JSDoc 绑定到紧邻的声明，import 不是
可悬停的导出。拿 language service 实际查 `apply` 的 quickInfo：

```
悬停 apply 时 IDE 显示的签名:
  (alias) function apply(ctx: Context): void
悬停时显示的文档: (空)
文档里是否含那段模块注释: false
```

`apply` / `name` / `inject` 三个导出符号在 tsc 版 d.ts 里**本来就各自没有
JSDoc**。所以那段模块文档对 IDE 消费者从来就不可见，唯一的读者是「手动打开
`node_modules/dsh-swarmdrop/lib/types/index.d.ts` 去读的人」——那种人更可能
直接看 GitHub 源码。

**源码的注释一个字都没少**，打包不动源码。产物里丢的是一份没人读得到的副本。

真正该拿来判断的是类型等不等价，见下。

---

## 实测一：banner/footer 完全替代套壳脚本

tsdown 的 `banner` / `footer` 映射到 rolldown 的 `postBanner` / `postFooter`，
位置在 chunk 最前 / 最后。产物与现有 `lib/client.js` 对比：

```
3027c3027
< return module.exports; } });
---
> return module.exports; } });
\ No newline at end of file
```

**唯一差异是末尾换行符**，107317 字节内容完全相同。externals 照旧编译成
`require("react")`，`id` 仍等于包名（loader 按它查 factory）。

sourcemap 注释不用剥——不开 sourcemap 就不生成。中间目录不用清——直接输出到
`lib/client.js`。

## 实测二：tsdown 的 d.ts 与 tsc 的类型等价

导出符号集合完全一致（9 个类型 + `apply` / `inject` / `name`）。结构等价用
双向条件类型断言验证，12 个符号逐个断言：

```ts
type Exact<X, Y> = [X] extends [Y] ? ([Y] extends [X] ? true : false) : false
type _1 = Assert<Exact<Tsc.PanelState, Tsd.PanelState>>
// …12 条
```

全部通过。**并做了反向验证**——故意注入一条 `Exact<Tsc.PanelState,
Tsd.ConsoleState>`，编译如期失败（TS2344，退出码 2），移除后回到 0。证明这个
断言不是空转。

---

## 实测三：三个会咬人的地方

### 1. `clean` 与两个工具的先后顺序绑死

现在 `--clean` 清的是 `.client-build`，独立目录所以无害。一旦 `outDir` 指向
`lib`，tsdown **跑在 tsc 之后**时 clean 就是清空 tsc 刚写完的 17 个文件：

```
tsc 后文件数:    17
tsdown 后文件数:  1     ← clean: true，跑在 tsc 之后
```

调研阶段的结论是「必须 `clean: false`」。**落地时发现这是错的**——见下面
「落地时改掉的一处」。

### 2. banner 会注入进 .d.ts，产出坏的声明文件

字符串形式的 banner 对所有 chunk 一视同仁，包括 dts：

```ts
// .d.cts 的头部——TypeScript 无法解析
window.__ModuleLoader__.load({ id: "dsh-swarmdrop", factory: (require) => {
import { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
```

`ChunkAddon` 支持对象形式 `{ js?, css?, dts? }`，**只给 `js` 就天然不碰
dts**——比按 `fileName` 过滤的函数形式干净。实测 `.d.ts` 头部干净、`.js`
头部正确。

### 3. `react` 的双重身份

`react` 同时在 `devDependencies` 和 `peerDependencies` 里。tsdown 默认外置
peer/deps，但显式声明才稳妥：`deps: { neverBundle: ['react', 'react/jsx-runtime'] }`，
对应现在命令行里那两个 `--deps.never-bundle`。

---

## 建议的落法

新增 `tsdown.config.ts`：

```ts
import { defineConfig } from 'tsdown'

// dsh 的 loader 按包名查 factory，所以 id 必须等于它。
const id = 'dsh-swarmdrop'

export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  // client 是独立的 TS program：dsh 在两侧对 Context.sessions 的 augmentation
  // 不同，共用一个 program 会让浏览器半边编译到 Node 的服务面上去。
  tsconfig: 'tsconfig.client.json',
  outDir: 'lib',
  // 跑在 tsc 之前，正是为了能 clean：lib 与 Node 侧共用，没有别的东西清它。
  clean: true,
  dts: true,
  // react 同时在 devDependencies 里，不显式声明会被打进 bundle。
  deps: { neverBundle: ['react', 'react/jsx-runtime'] },
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  // 对象形式只作用于 js chunk；字符串形式会把这段注进 .d.ts，产出坏声明。
  // dsh 的 client 入口不是普通模块，它要自己向 loader 注册。
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {
var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: { js: 'return module.exports; } });' },
})
```

package.json：

```diff
-"build": "npm run build:node && npm run build:client",
-"build:node": "tsc -p tsconfig.build.json",
-"build:client": "tsc -p tsconfig.client.build.json && tsdown src/client/index.ts --format cjs --platform browser --target es2022 --tsconfig tsconfig.client.json --deps.never-bundle react --deps.never-bundle react/jsx-runtime --out-dir .client-build --clean --logLevel warn && node scripts/build-client.mjs",
+"build": "tsdown && tsc -p tsconfig.build.json",

 "exports": {
   "./client": {
-    "types": "./lib/types/client/index.d.ts",
+    "types": "./lib/client.d.ts",
     "default": "./lib/client.js"
   }
 },
 "files": [
   "lib/**/*.js",
-  "lib/types/**/*.d.ts",
+  "lib/**/*.d.ts",
 ]
```

同时删除 `scripts/build-client.mjs` 和 `tsconfig.client.build.json`，以及
`.gitignore` 里已经指向不存在目录的 `.client-build/`。

---

## 落地时改掉的一处：`clean` 的顺序

调研阶段说「输出到 lib 就必须 `clean: false`」。**这个结论只看了一边。**

`clean: false` 意味着 `lib` 再没有任何东西清理它，而 `files` 里是
`lib/**/*.d.ts`——**上一版流程留下的产物会被打进包**。实测：手动放一个
`lib/types/client/index.d.ts`（正是这次改动后不再生成的路径），重新构建，
它还在，而且 `npm pack` 带上了它。

```
造残留后 npm pack 是否带上它:
  lib/types/client/index.d.ts 在包里: true
当前顺序（tsc && tsdown, clean:false）重建后:
  残留仍在 ← 问题
```

对调顺序就同时解掉两边：**tsdown 先跑并 `clean: true` 清空 `lib`，tsc 随后
写入 Node 侧**。tsdown 的产物在清空后写，tsc 的产物在其之后写，谁也不删谁，
而每次构建都是一个干净的 `lib`。

```
"build": "tsdown && tsc -p tsconfig.build.json"
```

任何人本地留着旧流程产物的 `lib`，第一次构建就清干净了。CI 是干净 checkout，
本来碰不到这个问题——**但 `prepublishOnly` 是在本地也会跑的**，而它正是打包
前的最后一步。

**README 要改一处**：「The browser bundle is not an ordinary ESM build」那段说
wrapper 是「30 行的 `scripts/build-client.mjs`」。那段解释 why 的文字全部仍然
成立，只有 wrapper 的位置变了——现在是 tsdown 配置里的 banner/footer。

---

## Node 侧：取舍，不是对错

| | tsc（现状） | tsdown bundle |
|---|---|---|
| 产物 | 17 个 .js，与源码一一对应 | 1 个 index.mjs，71.63 kB |
| stack trace | 指向真实文件和行 | 指向 bundle 偏移（除非出 sourcemap） |
| 调用次数 | 1 次（js + dts 一起） | 1 次 |

**换不换都不省调用次数**——tsc 那一次同时出 js 和 dts。差别只在产物形态：
插件在 dsh 进程里跑，出错时 `lib/machine.js:123` 能直接对应到源码，bundle
偏移不能。现在 `sourceMap: false`，要换就得连 sourcemap 一起开。

倾向不换，但这是可调试性偏好，不是技术判断。

## 剩下 3 个 tsconfig 不冗余

```
              typecheck (noEmit)      emit
Node 侧       tsconfig.json           tsconfig.build.json
client 侧     tsconfig.client.json    ← tsdown 直接用它，不再需要第四个
```

`tsconfig.build.json` 除了 `noEmit: false` 还 exclude 了测试文件，这个 CLI
覆盖不了（`--noEmit false` 能覆盖，`exclude` 不能）。要再减得先把测试挪进独立
目录，为省一个文件动源码布局，不划算。

---

## 一个顺带的增值项

tsdown 内置 `publint` 和 `attw` 两个开关（各需装对应的包）：

```ts
publint: true,   // 包导出配置是否合规
attw: true,      // Are The Types Wrong：types 指向是否解析得对
```

这个包有双入口、`types` 与 `default` 分离——正是 attw 最容易发现问题的形状，
而这类问题只在别人安装后才暴露。**尤其是上面那个 exports 改动动了 types 指向**，
接一次正好验证。放 `ci.yml` 比放发布作业合适（理由同上次改动：在门口失败是
免费的）。

**没有实测**，只确认了选项存在。
