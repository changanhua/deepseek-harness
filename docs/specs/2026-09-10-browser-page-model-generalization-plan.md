# 浏览器页面模型 V1 泛化验收计划

状态：实施中，尚未冻结模型验收。2026-09-11 用户授权全部实验累计费用不超过 5 RMB，单次不得超过剩余总额度。WP5 还需补齐具体模型入口、计费上界、样本清单并提交，才可启动 WP6/WP7。本文定义交付与验收要求，不代表这些机制已经通过模型运行验收。

**目标与完成条件：** 在从未见过、未参与调参的页面结构上，系统仍能先观察、再绑定、失败可解释、停止可确认。只有 HN 通过时，结论只能写成「HN 场景通过」；HN、Lobsters 与结构歧义留出集全部通过后，才可称「V1 页面模型具备初步泛化能力」。任何在开发集上的修复，未经留出集复验不得升级结论。

**核心纪律（先于一切工作包）：**

1. **经验二分。** 通用护栏（协议与生命周期规则）可以进入运行时和 Skill；站点事实（具体选择器、标题结构、URL 模式）只能留在测试证据和示例中。换站点时必须重新观察，不得复用旧选择器。
2. **冻结验收口径。** 全部数字口径在第一次正式模型实验之前提交（见 WP5）。此后不得为任何失败样本临时放宽；确需修改口径的，只能开新版本计划并重跑全部实验。
3. **开发集与验收集分离。** HN 与 Lobsters 属于开发集（允许看着调）；留出集由未参与本计划讨论和调参的人准备、封存。任何用于定位失败或修订代码、Skill 的留出样本都转入回归集，不再提供盲测证据；修复后重跑开发与回归集，再以未披露的新留出批次验收。
4. **经验转机制，不转答案。** 沉淀的方向是「从新快照取得页面身份」「从 DOM 证据推导选择器」「检查 `collected` 并更新挂载」，而不是记住某个 `documentId`、`#hnmain` 或某段插件代码。

## 1. 基线与现状（源码基线，运行验收另行记录）

基线 worktree：`C:\Users\xbh\deepseek-harness\.worktrees\browser-page-model-v1`，分支 `codex/browser-page-model-v1` @ `964fd9d5b4`，**含 160 项未提交 WIP**（82 改 / 77 未跟踪 / 1 删，截至 2026-09-10 16:12）。WIP 中已包含本计划涉及的页面模型与扩展工作区文件。

### 1.1 现有机制（源码及既有测试位置）

| 机制 | 位置 | 行为 |
| --- | --- | --- |
| 页面身份 | `packages/browser/browser/src/types.ts` | `BrowserPage{tabId,frameId,documentId,url}`；`BrowserElementReference` 是快照局部引用，注释明确「never a selector to be rematched later」 |
| 挂载前检查 | `apps/chrome-extension/src/browser-page.js` `entryInspect`（约 423–478 行） | 区域必须唯一（`ambiguous_region`）；选择器必须 `:scope` 起始且匹配落在区域内（`binding_outside_region`）；返回 `matched/valid/missingTitle/missingLink/duplicateLinks/truncated/samples` |
| 挂载 | 同文件 `entryMount`（约 479–549 行） | 幂等 `mountId`；`collected` 由调用方传入；`MutationObserver` 对新增节点补挂；URL 变化拒绝（`stale_document`） |
| 卸载 | 同文件 `entryUnmount`（约 550–559 行） | 断开 observer、移除 `[data-dsh-entry-mount-id]` 按钮，返回 `unmounted:true` |
| 失效重选 | `packages/browser/tool-browser/src/index.ts` `dispatchWithFeedback` | `stale_element/stale_document/stale_preparation/target_unavailable` 转为提示「从新引用重新选择」并附带新快照 |
| 有界任务环 | `packages/browser/tool-browser/src/loop.ts` | `MAX_STEPS=12`、`MAX_SAME_FAILURES=3`、verified/unknown/cancelled/budget_exhausted/repeated_failure 状态机；turn 边界注入续轮消息 |
| AbortSignal | `tool-browser/src/index.ts` | 全链路传 `exec.signal` |
| e2e 模式 | `apps/web/tests/browser-*.e2e.ts`、`packages/mcp/control-mcp/tests/browser-extension.e2e.ts` | 本地 fixture server（`127.0.0.1`）+ Playwright 加载真实 MV3 扩展 + 真实 Host |
| 模型入口 | `tool-browser/src/schema.ts`、`packages/extensions/cordis-host-runner/src/index.ts` `browserEntryFacade` | `browser_action` 不开放 entry 操作；动态插件通过 `harness.browser.inspect/mount/unmount` 调用页面模型 |
| 挂载所有权 | `cordis-host-runner/src/index.ts` `cleanupBrowserMounts`、`packages/browser/browser-extension/src/index.ts` | runner 保存运行实例拥有的挂载与待清理挂载；BrowserExtension 保存授权及点击路由记录。现有 runner 在 stop/update/失败等路径卸载，清理回执与失败保留需要 WP1.2 补强 |

`agent/turn-stopping` 是可继续注入工作的正常停止边界，不是所有终止路径的通知；Agent loop 在它之前检查 abort。用户取消不保证触发该事件，也不保证销毁 agent。现有 `BrowserTaskLoop` 的 verified 只检查页面文本、URL 或控件条件，不能独立证明条目已收集；`MAX_STEPS` 同时约束已计入的 action 次数与续步次数，不等于整个模型实验的调用预算。

### 1.2 五条通用护栏现状核对

| 护栏 | 现状 | 缺口 |
| --- | --- | --- |
| ① `documentId` 必须来自新快照 | ✅ 已机制化（失效拒绝 + 重选提示） | 无 |
| ② prompt 必须传 `AbortSignal` | tool-browser 已传 `exec.signal` | 动态插件异步工作还需绑定运行实例的 disposer；清理使用独立有界信号 → WP1.2 |
| ③ 入口挂载前必须 `inspect` | ❌ 无强制 | `entry_mount` 不校验是否先成功 `entry_inspect`，纯靠约定 → WP1.1 |
| ④ 更新要保留 `collected` | ⚠️ 机制支持但靠模型自觉 | `entry_mount` 幂等替换时若调用方不回传 `collected`，已收集状态丢失 → WP1.3 |
| ⑤ 停止必须核对清理结果 | runner 已有卸载与待清理记录 | 核对回执、取消收尾及失败后保留证据仍需补齐 → WP1.2 |

### 1.3 站点事实分布现状（已核实）

- HN 结构（`tr.athing`、`.titleline`、`#feed`、`table.items`）只出现在 `apps/chrome-extension/tests/browser-dom-tree.spec.ts` 的测试 fixture 中，**生产代码无 HN 选择器** ✅
- `apps/chrome-extension/src/zhihu-feed.js` 是 manifest 显式声明的站点适配 content script（`matches: https://www.zhihu.com/*`），属「阅读流」功能而非页面模型；与页面模型的通用机制是两条线，但需要在文档中显式划界 → WP1.4
- `tool-browser` 工具描述与 preset 中未发现站点词（`agent.cordis.yml` 仅有 tool-browser 注册）✅，需在 WP1.4 复核全部新增文件

## 2. 经验二分清单（冻结）

### 2.1 通用护栏（允许进入运行时与 Skill）

| 护栏 | 机制落点 |
| --- | --- |
| 页面身份取自新快照；`documentId` 变化即失效 | 既有失效拒绝 + 失效后强制重选提示 |
| 挂载前必须对同一 binding 成功 `entry_inspect`，且同文档内的区域、目标和字段证据仍有效 | WP1.1 新增强制 |
| 区域必须唯一、选择器必须 `:scope` 且匹配落在区域内 | 既有 `ambiguous_region` / `binding_outside_region` |
| 同一所有者和页面上的更新或卸载后重挂默认保留 `collected`，显式传空数组清空 | WP1.3 |
| 插件明确停止、失败或所属实验任务终止后卸载并核对零残留；普通 turn 结束不提前移除持久插件入口 | WP1.2 |
| 拒绝而非勉强挂载：区域不唯一、快照过期、页面换站为机制拒绝；标题缺失、链接重复为证据拒绝（inspect 报告 + Skill 硬性指引，见 WP4） | 混合，见 WP1.5 与 WP2 |

### 2.2 站点事实（只允许出现在测试证据与示例）

| 事实 | 允许位置 |
| --- | --- |
| `#hnmain`、`tr.athing.submission`、HN 标题结构 | 开发集 fixture、e2e 断言、Skill 的「示例」小节（须标注选择器由现场观察得出） |
| Lobsters `ol.stories`/`li.story` 等结构 | 同上 |
| 知乎 `.ContentItem-title` 等 | `zhihu-feed.js` 既有站点适配线（manifest 显式声明），不参与页面模型泛化判定，文档须声明此边界 |

禁止位置：`packages/browser/**/src`（除 `zhihu-feed` 这类 manifest 显式站点适配外）、`tool-browser` 工具描述、preset 与 Skill 的规则部分、Host 侧任何默认值。

## 3. 工作包

### 3.0 执行环境分工（本地 vs 云端）

本计划按「是否需要真机环境」切分执行责任。云端执行者指通过 GitHub 读写本分支的远程 agent：它只承担纯代码、fixture 与文档的编写。一切需要本机 Windows、真实 Chrome/MV3 扩展、Playwright、DSH Host、真实模型与费用的工作留在本地。云端提交只声明「未运行测试」，测试结论由本地执行者或仓库 CI 给出。

| 工作包 | 云端可做 | 本地必须做 |
| --- | --- | --- |
| WP0 基线固定 | — | 落基线提交、推送本分支（已完成） |
| WP1.0 实验入口与计量 | — | 接通 subject 工具路径、Host 计数与运行日志 |
| WP1.1 挂载前置强制 | `browser-page.js` 预检记录、`stale_binding`/`inspect_required`、类型与错误说明、runner facade 及 README | 运行扩展单测与 e2e；`browser-entry.spec.ts` 用例的实际执行结果 |
| WP1.2 停止清理核对 | runner 收尾与回执核对、controller 终止路径代码、扩展残留计数 | 真实 Host、取消/离线/在途挂载的 e2e |
| WP1.3 collected 默认保留 | 缓存键与所有者释放路径代码 | 卸载→重新 inspect→重挂保留态的 e2e |
| WP1.4 站点事实审计 | grep 审计与 `docs/subsystems/browser.md` 边界小节 | 审计在本地基线复核 |
| WP1.5 证据拒绝防线 | `entry_mount` 无链接条目处理 | 单测执行 |
| WP1.6 节点复用 | 观察器与点击前核对代码 | 节点复用 e2e |
| WP1.7 业务结果核验 | checker 与只读状态读取代码 | 真实 Host 上的 collection 核对 |
| WP2 Skill 沉淀 | 全部文本（含 `cordis-plugin-development` 更正） | `pnpm vitest run packages/preset/agent-presets` |
| WP3 开发集 fixture | 静态页面、期望数据、fixture server 用例 | 真实浏览器加载扩展跑通 |
| WP4 结构变化与拒绝矩阵 | e2e 用例代码与 B1–B6 构造 | 运行 e2e 并断言真实回执 |
| WP5 冻结验收口径 | 表格补值（费用上限除外）与清单模板 | 提交冻结 commit；费用上限由用户给出 |
| WP6 多模型对比 | — | 真实模型、Host、浏览器实例、隔离与计量 |
| WP7 留出集执行 | — | 同上；留出集由准备者封存后本地执行 |

云端执行者边界：只修改本分支内文件；不推送 `master`、不开 PR、不合并；不得把站点事实写进运行时路径、Skill 规则或提示（第 2.2 节）；不得读取或写入封存留出集的内容；无法在本地验证的行为按「未验证」表述；需要真机事实才能决定的实现细节提出而不猜。云端改动的返回值以本地测试结论为准，不以 agent 自述为准。

### WP0 基线固定（已完成，本地执行）

1. （已批准）160 项 WIP 已按主题落为基线提交，位于 `964fd9d5b4` 之上：忽略本地运行时数据的 `.gitignore`、浏览器包族、扩展与 Web e2e、MCP control-mcp 接线、Cordis 扩展与 session 控制器、文档与 preset。本地运行时数据（`.dsh-page-model-verify/`，含凭证）与 `.codex/` 已排除且不入库。
2. 记录起点：`git rev-parse HEAD`、`git status` 快照存入实验记录目录（见 6.2）。
3. 确认 Windows 执行环境：Playwright 用 `C:\Users\xbh\node_modules\playwright`（1.58.2，chromium 已下载），不使用系统 Chrome/Edge `--headless`；脚本与截图放 `.playwright-mcp/`（gitignored）。

### WP1 护栏机制化

#### 被测路径与实现责任

本计划复用动态 Cordis 插件路径，不新增 entry 专用模型工具。subject 使用 `browser_instances/tabs/snapshot` 观察页面，通过 `cordis_inspect_list/query` 了解接口，以 `cordis_define/run` 创建或更新插件；插件用 `harness.browser.inspect/mount/unmount` 完成绑定，用 `harness.state` 保存收集结果，以 `cordis_stop` 结束。subject 对按钮的点击经 `browser_action` 执行。相关接口说明来自被测 preset 的既有 Skill 与 WP2，不得由 controller 临时提供站点答案。WP5 固定所有模型可见的同一套工具、Skill 和执行入口；Codex 基线也必须调用同一个 subject Host，不能用本机浏览器工具代行。

WP1.1 的预检记录以 `(sessionId, installationId, documentId, regionSelector, selector, titleSelector, linkSelector)` 为键，保存区域节点、匹配条目节点及其字段节点身份和标题/绝对链接。挂载前排空待处理变更并重新比较这些证据；区域替换、条目集合或顺序变化、字段节点或值变化均使旧记录失效，返回 `stale_binding`，从新快照重新 inspect。尚无记录返回 `inspect_required`；页面导航仍由 `stale_document` 拒绝。DSH 自身按钮的插入、更新和移除不算页面证据变化。挂载校验失败不得先卸载旧的有效挂载。该记录不复用普通动作的 preparation ticket。

WP1.2 沿用 runner 的 `ownedBrowserMounts/pendingBrowserMounts` 作为插件运行实例的清理责任记录，BrowserExtension 继续负责授权与点击路由；不在 tool-browser 另建挂载索引。显式 stop、update、失败激活、移除和所有者销毁均收敛到 runner 清理。实验 controller 在实际任务完成、错误、用户取消或预算终止的收尾路径调用同一 stop，并等待结果，不依赖 `agent/turn-stopping`。正常 turn 结束可以保留入口供后续交互；本次一次性实验的任务终止必须完成清理。subject 未自行执行要求的停止时，controller 收尾只保证资源回收，该样本仍失败。

清理先关闭该运行实例的事件处理与新挂载能力，再等待或核对在途挂载，然后卸载所有已拥有和待清理的条目；清理不使用已取消的 turn signal，沿用每次操作 5 秒的独立超时。扩展卸载回执增加所属 mount 的残留数量，只有 `outcome: observed`、`unmounted: true` 且残留为 0 才删除待清理记录。离线、拒绝、超时和未知结果必须保留待清理证据，不能报告零残留；页面已关闭或换文档只有经当前页面身份核对后才可标记原文档已消失。BrowserExtension 不得在卸载失败时丢弃后续核对所需记录。

WP1.3 将 `collected` 缓存与活动 observer 分开，键为 `(sessionId, installationId, tabId, frameId, documentId, mountId)`；同一稳定插件 slot 的更新保持该键。省略 `collected` 读取上次集合，显式数组替换集合，`[]` 清空；从未存在的键按空集合处理。普通卸载及插件版本更新仅移除按钮、observer 和预检记录，保留该键缓存至文档销毁或所有者释放；文档身份变化、授权撤销或 Session/插件永久移除须清除，禁止跨所有者恢复。缓存仅是已确认收集结果的显示副本：点击发送成功不新增 collected，只有插件接收事件、写入结果并回传集合才更新。沿用集合最多 512 个链接的既有限制；WP1.3 实施时记录缓存条目数及字节上限，并随 WP5 冻结，超限显式拒绝新增或扩大缓存，不静默丢失旧集合。

| 子项 | 内容 | 落点 | 验证 |
| --- | --- | --- | --- |
| 1.0 实验入口与计量 | 接通上述 subject 工具路径，在 controller 的模型调用和 Host Browser 执行边界分别计数；同一规则用于两模型 | 既有 `packages/mcp/control-mcp` 实验入口、测试 harness 与运行日志 | 工具清单确认可达 inspect/mount/unmount；插件内部 Browser 操作可计数；不得用 mock 结果替代正式模型验收 |
| 1.1 挂载前置强制 | 实现上述预检记录及同文档失效规则 | `apps/chrome-extension/src/browser-page.js`；Browser 类型、错误说明、runner facade 与对应 README | 未 inspect、同页替换、字段改值、刷新均拒绝；重新 inspect 后成功；失败重挂保留旧有效挂载 |
| 1.2 停止清理核对 | 实现上述 runner 收尾与回执核对，补齐 controller 的实际任务终止收尾 | `packages/extensions/cordis-host-runner/src/index.ts`、`packages/browser/browser-extension/src/index.ts`、扩展及实验 harness | 正常停止、取消但 agent 存活、错误、销毁、在途挂载与离线卸载；同一页面的非目标插件不受影响；任务结束零残留或明确清理失败 |
| 1.3 collected 默认保留 | 实现独立缓存与所有者释放，覆盖更新及卸载后重挂 | `browser-page.js`、runner/browser-extension 的所有者释放路径 | 收集确认→卸载→重新 inspect→省略 collected 重挂仍保留；`[]` 清空；跨 Session/文档不恢复；超限有明确失败 |
| 1.4 站点事实审计 | 全量 grep 生产 src / 工具描述 / preset / Skill：`hnmain\|athing\|news\.ycombinator\|lobste\|zhihu\.com`（`zhihu-feed` 线除外）；`docs/subsystems/browser.md` 增补「站点适配与页面模型的边界」小节，声明 `zhihu-feed.js` 是 manifest 显式站点适配、不参与页面模型泛化判定 | 审计脚本一次性执行（不留常驻脚本，若仓库既有 hygiene 已覆盖则复用） | 审计输出为空（除豁免清单）+ 文档更新随行为同 commit |
| 1.5 证据拒绝的挂载防线 | `entry_mount` 对无链接条目不生成可点击按钮（现状点击时静默 return）；`missingTitle/missingLink/duplicateLinks` 非 0 时的挂载决策归 Skill 硬性指引（WP2）与模型实验判定（WP6），机制上保持 inspect 报告不猜 | `browser-page.js` attach | 单测：无链接条目不出现按钮 |
| 1.6 节点复用 | 观察子树、属性和文本变化；按条目当前字段重新判定，变化时移除旧按钮，重新有效绑定前不可点击；点击时再次核对字段身份和值，禁止闭包回传旧内容 | `browser-page.js` attach/observer，复用 WP1.1 的字段读取与身份比较 | 同节点改 href、改文本、替换字段节点、跨行内容变化均不回传旧条目；新绑定按新绝对链接重算 collected；DSH 按钮变更不触发循环 |
| 1.7 业务结果核验 | 插件以 `harness.state` 的 `collection` 数组保存去重后的 `{title, link}`；独立 checker 读取结果并与 Host 接收的条目事件和 fixture 期望值核对 | 实验 harness 的只读状态读取与 checker，复用现有 runner 状态，不新增产品存储 | 数量不足、标题/链接错配、重复项、只有按钮但无结果均失败；正常结果在 stop 前后相同 |

每个子项按实际修改运行所属测试：页面条目重点是 `apps/chrome-extension/tests/browser-entry.spec.ts`，页面身份另测 `browser-page.spec.ts`；runner、BrowserExtension、tool-browser 与 control-mcp 使用各自测试目录。命令从仓库 `docs/testing.md` 的矩阵选择；WP4 使用既有真实 Host + MV3 扩展 e2e 入口，不以页面单测代替。

### WP2 Skill 沉淀（通用护栏 → Skill）

- 在拓展 worktree 的 Cordis preset skills 下新增 `browser-page-model` Skill，内容 = 第 2.1 节护栏、WP1 的实际工具路径与错误码应对表（含 `inspect_required/stale_binding/ambiguous_region/binding_outside_region/stale_document`）。既有 `cordis-plugin-development` Skill 同步更正更新时的 collected 规则并指向该 Skill，避免两处指引冲突。WP1.7 的 collection 字段及结果结构作为统一实验输出协议提供给两个模型，不含任何样本答案。
- 站点事实只允许出现在「示例」小节，每个示例必须带显式声明：「示例选择器来自该站点的现场观察，仅证明流程；换站点必须重新 `entry_inspect`」。
- Skill 中不得出现「HN 用 `#hnmain`」这类可复制规则句式。
- 验证：`pnpm vitest run packages/preset/agent-presets`（shipped-root 等既有 gate）+ dsh-prose-standard 检查。

### WP3 开发集（HN + Lobsters，允许看着调）

- 形式：本地 fixture server（沿 `browser-actions.e2e.ts` 的 `127.0.0.1` 模式），每站点一个静态结构页 + 一个动态变化页。
- HN 结构页：`table` 布局、条目跨行（投票行 + 标题行 + 元信息行）、`tr.athing`+`.titleline`、站内 `/item?id=` 与外链混合、子表嵌套。
- Lobsters 结构页：`ol > li` 列表、`h2 > a` 标题、标签列、侧栏含相似条目（供区域外混淆测试）。
- 两个页面均属开发集：允许在调试中修改 fixture。
- 真实站点人工校准（可选，需用户当场授权）：在授权浏览器实例上人工核对 fixture 结构与真实 HN/Lobsters 的关键差异，差异记录进实验记录，不回写进生产代码。

### WP4 结构变化与拒绝矩阵（e2e，全部本地 fixture）

新增一个 e2e 文件（建议 `apps/web/tests/browser-entry-lifecycle.e2e.ts`），矩阵分两组：

**A. 结构变化（在通过路径上验证仍能先观察再绑定）**

| # | 变化 | 断言要点 |
| --- | --- | --- |
| A1 | 标题层级变化（`h2`→`h3`→`div.title`） | 重新 inspect 后按新证据挂载；旧 titleSelector 失效可解释 |
| A2 | 外链与站内链接混合 | `linkSelector` 推导不依赖域名；href 解析为绝对地址 |
| A3 | 页面刷新导致 `documentId` 变化 | 旧引用被拒（`stale_document`），新快照后重挂成功 |
| A4 | 条目顺序变化（重排） | 引用按节点身份而非位置；已收集状态不因重排丢失 |
| A5 | 新节点插入（动态加载更多） | `MutationObserver` 补挂；新条目按钮可点击 |
| A6 | 节点复用（虚拟列表回收 DOM 改内容） | 按 WP1.6 分别改变 href、文本与字段节点；旧按钮不可回传旧条目，重新 inspect/mount 后点击只回传当前内容，collected 按当前链接重算 |
| A7 | 区域外出现相似条目（侧栏） | `:scope` + 区域包含校验拒绝越界绑定（`binding_outside_region`） |

**B. 拒绝错误绑定（好系统必须拒绝而非勉强挂载）**

| # | 场景 | 期望 |
| --- | --- | --- |
| B1 | 区域选择器匹配多个节点 | `ambiguous_region`，无按钮 |
| B2 | 标题缺失（titleSelector 匹配空） | inspect 报告 `missingTitle>0`；按 Skill 指引不得直接挂载（WP6 判定模型是否遵守） |
| B3 | 链接重复 | inspect 报告 `duplicateLinks>0`；同上 |
| B4 | inspect 后 DOM 替换目标或改变字段，URL/documentId 保持不变 | `stale_binding`，拒绝使用旧回执；重新观察与 inspect 后才可挂载 |
| B5 | 页面换站（URL 变化后携带旧 page 挂载） | `stale_document`，拒绝执行 |
| B6 | 未先 inspect 直接挂载 | `inspect_required`（WP1.1） |

B 组中 B1/B4/B5/B6 为机制拒绝（e2e 直接断言回执）；B2/B3 为证据拒绝（e2e 断言 inspect 报告数字正确；模型是否据此拒绝由 WP6 判定）。此分配为设计决定，理由：机制不知道「标题」的业务含义，猜测阈值会引入无据魔法数字；证据 + 指引 + 实验判定保持责任清晰。

机制 e2e 可以主动构造错误请求以验证 B1/B4/B5/B6，但这些脚本不属于模型独立完成样本。模型实验不得强迫 subject 选择错误 selector 或省略 inspect；B2/B3 的拒绝 fixture 必须由准备者确认目标条目本身缺少必要字段或无法满足去重收集条件，而非仅给出一个错误 selector。普通页面上模型重新观察后找到有效绑定属于恢复成功，不能因没有拒绝而判失败。

### WP5 冻结验收口径（必须先于 WP6/WP7 提交）

口径提交前不得开始任何正式模型实验。提交物 = 本节确定值、两模型的具体 model/provider 标识与参数、相同工具及 Skill 清单、实际执行命令、fixture 清单哈希、checker 版本和用户给定的单次/总费用上限，进入独立 commit（信息前缀 `docs(page-model): freeze acceptance budget`），此后只读。费用尚未给定、模型入口无法使用同一 Host 或清单缺项时，仅暂停正式实验，WP0–WP4 的实现与本地验证可以继续；不得自行购买或扩大费用额度。

| 维度 | 冻结值 |
| --- | --- |
| 成功标准 | 正向样本由独立 checker 核对恰好 N=3 条收集结果：标题与绝对链接逐条等于 fixture 期望，无重复，均有对应 Host 接收事件；挂载抽样首/中/尾至少 3 条正确；更新与卸载后重挂保留状态；subject 主动停止且结果仍保留、页面零残留。checker 签发该实验的 verified，单独保存 BrowserTaskLoop 原始状态，二者不得混称 |
| 拒绝样本 | 机制 e2e 按 WP4 覆盖 B1–B6；模型拒绝样本按 WP4 的 B2/B3 fixture 检查证据、不发生错误挂载/收集、解释符合证据且清理完成。正确拒绝不要求收集 N 条，也不伪造 BrowserTaskLoop verified；机制拒绝、模型拒绝与正向完成率分开统计 |
| 最大模型轮次 | 每任务模型请求 ≤12 次，由 controller 按实际请求计数，含续步、修复和重试；不是 MAX_STEPS 的别名。若使用 BrowserTaskLoop，其自身更严格限制仍生效，不为实验放宽 |
| Browser 调用额度 | 每任务 Host Browser 的 execute、prepare、executePrepared 调用尝试总计 ≤40 次，包含 browser 工具、动态插件内部操作、自动快照和重试；准备及提交各计一次，缓存回执查询的提交尝试也计数。安全收尾单独计数且不得因预算阻止，不能使超预算任务转为成功 |
| 修复次数 | 每个失败样本代码或 Skill 修复合计 ≤2 轮；每轮重跑开发与回归集。留出失败一旦用于修复即转回归样本，最终结论须用新的未披露批次；保留全部失败历史 |
| 技术干预定义 | controller 或人工向 subject 提供选择器、技术结构提示或答案，代写任务插件，执行任务点击/收集，或直接调用扩展内部 API 代行任务，均记失败。subject 按冻结的 browser_* 与 cordis_* 路径自主执行不算干预；预先冻结的 fixture 初始化、定时结构变化、只读 checker 和自动安全收尾不算纠偏，但不得根据失败临时调整 |
| 清理与保留判据 | 本次任务拥有的 `[data-dsh-entry-mount]` 残留 =0，逐 mount 卸载回执与独立页面检查均通过；卸载→重新 inspect→省略 collected 重挂保留确认态；stop 后业务 collection 仍可读。普通 turn 结束不等于插件停止 |
| 独立完成判定 | 正向样本无干预且满足全部成功条件；超预算、终止错误、结果错误、清理未知或 controller 代行停止均失败。两模型在开发集及最终未披露留出批次的所有正向与拒绝样本均通过，才可使用文首的初步泛化结论 |
| 真实模型预算 | 模型组为 Codex 基线、v4-flash；每模型每正向 fixture 和每模型拒绝 fixture 恰好 3 次全新会话。全部实验累计 ≤5 RMB（2026-09-11 用户授权），单次 ≤剩余总额度。每次请求按模型输入/输出上限和核实的单价先预留最坏费用，收到完整用量后结算；未知用量保留预留额，后续不可透支。具体 model/provider 与运行参数在冻结提交填入；新增模型必须先升级口径版本 |

### WP6 多模型对比（新会话，同任务）

- 模型、重复次数与工具路径按 WP5 冻结清单执行；每次新建 Session/插件状态，避免跨模型或样本共享 collected、预检记录和业务结果。
- 正向任务模板：「为此页面主列表添加收集入口，通过入口收集前 3 条条目，更新入口的已收集状态，卸载并恢复入口以确认状态保留，最后停止插件并报告结果。」模型拒绝样本使用同一目标，但 fixture 的期望按 WP4 由准备者预先标记；提示不得给出错误类型、选择器、技术结构或期望条目答案。
- fixture 准备者冻结期望条目的标题、绝对链接和顺序；动态页面同时冻结变化时机与对应期望值。checker 只读 Host 接收事件、插件 collection、清理回执及页面，不把期望数据提供给 subject；collection 是本实验的进程内结果，不宣称内容库或持久化验收。
- 记录指标：独立完成率、探索步骤数（inspect/snapshot 次数）、失败类型分类（区域歧义/选择器推导失败/过期处理失败/预算耗尽/干预）、修复次数、耗时、token 消耗。
- 隔离要求（自研自测边界）：controller 与 subject 分离的 DSH_HOME、独立 Profile；直接使用真实模型（已批准，不走 mock 前置），每次实验记录 run-id、目标、模型、额度与到期；subject 会话不得加载被测 Skill 之外的控制器策略。证据取自工件（工具调用日志、页面状态、回执），不以 subject 自述为准。mock LLM 仅可作为开发期诊断手段，不作为验收通道。
- 失败分析写回时只允许：机制缺口→WP1 修复、指引缺口→WP2 修订；禁止把站点答案写进任何生产路径（第 2.2 节）。

### WP7 留出集执行与报告

- 留出集来源：按 D4 由未参与本计划讨论和调参的人准备。隔离单位是具体页面、DOM 组合和期望数据，允许结构类别与开发集相同；至少各有一个独立 fixture 覆盖无语义 table、主列表+侧栏、跨行条目、节点复用、长列表和动态新增节点，并提供 B1–B6 拒绝场景。不能直接复制开发 fixture 改站名充当新样本。
- 准备者将 fixture、期望数据与完整清单冻结在独立提交中，执行前只向调参者披露数量、类别与提交/文件哈希。自动执行器可以读取封存文件，但在整批两模型运行结束前，不向开发者或后续 subject 会话反馈样本内容或失败分析；subject 只在当前任务中观察当前页面。
- 执行顺序：开发集与回归集全量 → 冻结代码/Skill/checker 版本 → 未披露留出批次全量。整批期间不改实现；用于任何修复的留出批次整体转为回归集，首次结果永久保留。修复后更换新的未披露批次再验收，预算不变；新批次或费用额度不足时报告尚未获得泛化证据，不能用旧集重跑替代。
- 报告结构：每站点/每结构 × 每模型的正向独立完成率、拒绝命中率与失败类型；首次盲测、转回归后的复测和新批次结果分别列出；B1/B4/B5/B6 为机制拒绝，B2/B3 为证据拒绝。结论按文首「目标与完成条件」表述。
- 报告与证据存实验记录目录（见 6.2），摘要写入 `.agents/notes/implemented/feature/`（中英三件套，含 supersession 检查）并更新 `docs/subsystems/browser.md`。

## 4. 依赖与不做的事

- 依赖：拓展 worktree 既有 WIP（页面模型、扩展、mcp 整合 e2e）、Playwright 本地安装、仓库测试脚本矩阵（`docs/development.md`）。
- 分支与发布：把本工作分支 `codex/browser-page-model-v1` 推送到 origin 是云端执行者读取基线的前提（已授权）；不推送 `master`、不开 PR、不合并（需用户逐项授权）；不动 `.worktrees/browser-page-model-v1` 之外的 worktree；不访问真实站点（除 WP3 可选人工校准且需当场授权）；不引入向量检索、语义选择器推导等新能力——本计划只验证既有机制与护栏的泛化。
- 提交纪律：WP1–WP4、WP5、WP7 的产物各自成 commit；站点事实只出现在测试与示例文件中。

## 5. 已裁决的决策（2026-09-10 用户批准）

| # | 决策点 | 裁决 |
| --- | --- | --- |
| D1 | WIP 160 项如何落基线（WP0） | 批准：按主题拆分提交为基线 |
| D2 | `collected` 默认保留（WP1.3）是否引入「上次集合」状态 | 批准：引入（护栏④要求），状态仅存扩展内存、随 `documentId` 失效 |
| D3 | WP6 模型通道与预算 | 否决 mock 前置：直接使用真实模型执行 WP6；费用上限作为冻结口径的一部分在 WP5 提交时一并定死 |
| D4 | 留出集由谁准备 | 批准：由未参与本计划讨论的人准备，完成后冻结 |

## 6. 实验工件与交付

### 6.1 冻结清单

WP5 提交同时记录被测代码与 Skill 提交、controller/checker 版本、模型/provider 的精确标识与参数、两模型的实际启动及调用命令、工具可见清单、fixture 与期望数据哈希、样本总数、模型请求与 Browser 调用预算、缓存容量限制、单次及总费用上限。已明确的规则见 WP5；执行者只能补全尚未给定的具体值，不能借补全放宽规则。封存 fixture 的正文不得提前进入 subject 的仓库上下文、Skill 或提示。

### 6.2 实验记录目录

该 worktree 的 `.artifacts/browser-page-model-generalization/<experiment-id>/` 保存实验记录，`experiment-id` 由 controller 在批次启动时生成且不可复用。根目录保存冻结清单、基线状态、汇总报告；每个 `<run-id>/` 保存模型/代码版本、样本哈希、工具和 Host 执行日志、checker 结果、stop 前后的 collection、挂载清理回执、页面检查及费用计数。截图与临时 Playwright 脚本可先放 `.playwright-mcp/`，报告依赖的截图须复制进对应 run 目录并记录路径。

记录区不得提交凭证、授权头或真实 Profile 配置；WP7 的报告摘要进入维护文档并链接可保留的证据。实施前按 `git check-ignore` 核对工件目录规则，忽略目录中的证据不默认视为已交付；报告须说明证据保留位置与缺失项。没有实际运行的项目写「未验证」，不得用计划表或 subject 自述填作通过。
