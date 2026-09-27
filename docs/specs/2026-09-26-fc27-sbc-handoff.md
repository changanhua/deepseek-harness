# FC 27 SBC 助手交接快照

续接入口：[FC Web App 应用模型与 Agent 自动化交接](2026-09-26-fc-web-app-model-handoff.md)。后续采用轻量扩展、Agent 驱动与共享应用模型；本文保留其记录时刻的 SBC 现场证据，页面与运行状态需重新核对。

记录时间：2026-09-26 00:19（香港时间）。这是接手续办用的时间点记录，不替代[整体设计](2026-09-25-fc27-sbc-assistant.md)或当前源码。页面、安装、会话和报价状态会变；接手时先重新读取，不把本文件当作实时授权或验收结果。

## 接手入口

- 工作目录：`C:\Users\xbh\deepseek-harness`；记录时在 `master`，HEAD 为 `6ddb5ca503`。工作树有大量相关及无关的未提交修改，FC SBC 模块和整体设计稿也尚未跟踪；不要 `reset`、清理或覆盖既有 WIP。
- 本线程的 SBC Goal 记录时为 `paused`。本次写交接文档不代表恢复 Goal；后续继续目标工作前确认其状态及用户意图。
- 先读[整体设计](2026-09-25-fc27-sbc-assistant.md)、[扩展入口](../../apps/chrome-extension/src/assistant-runtime.js)、[SBC 页面探针](../../apps/chrome-extension/src/fc-sbc-page-probe.js)及[浏览器工具](../../packages/browser/tool-browser/src/index.ts)。整体设计稿是提案，开头的源码状态清单须与当前工作树逐项核对。
- 不为重载配置而停止 Codex/ChatGPT 桌面应用、其 app-server 或本任务 MCP。扩展源码更新是否进入用户实际安装的 Chrome 扩展，仍需单独证明；源码测试和构建不等于已安装扩展的实页验收。

## 本轮实际到达的位置

DSH 在标题为“FC 27 重大比赛页面只读勘察”的会话中，通过固定的 EA FC 27 Web App 标签读取了 SBC 页面、四关详情、俱乐部汇总和部分 SBC 仓库。目标绑定对该会话有效；此前另一会话出现的 `browser_target_unbound` 是按会话隔离的绑定没有落在同一会话，不能据此说用户选错 FC 标签。

下表来自该 DSH 会话的浏览器工具结果和其最终报告；交接整理未重新逐关独立核验。数字和文案只代表当时的已加载页面，不是永久任务数据库。

| 关卡 | 当时读取的要求 | 奖励 |
| --- | --- | --- |
| 意大利对比利时 | 意大利或比利时至少 1 人；至少 3 个俱乐部；至少 3 名白银；品质至少青铜；默契至少 14 | 迷你黄金组合包 |
| 挪威对葡萄牙 | 挪威或葡萄牙至少 1 人；同一俱乐部至少 3 人；联赛不超过 5 个；至少 2 名黄金；品质至少白银；默契至少 18 | 小型混合球员组合包 |
| 荷兰对德国 | 荷兰或德国至少 2 人；同一俱乐部不超过 2 人；同一联赛至少 4 人；至少 2 名黄金；品质至少白银；默契至少 22 | 小型黄金球员组合包 |
| 英格兰对西班牙 | 英格兰或西班牙至少 2 人；同一国家/地区至少 4 人；同一俱乐部不超过 3 人；联赛不超过 5 个；球队评分至少 75；默契至少 26 | 大型琥珀金球员组合包 |

群组当时为 0/4 已完成、不可重复，群组奖励为大型黄金球员组合包。俱乐部页显示球员 311 件、消耗品 168 件、经理 25 件；球员列表是虚拟滚动，一次只见约 20 张。SBC 仓库见到 8 张卡，但没有总数。未取得完整实例清单、稳定关卡 ID、已验证的市场购买权限或带来源与时间的站外报价；“转会”导航存在不等于可购买。不能据此给缺卡清单、整组预算或自动购买许可。

## 尚未收尾的页面状态

DSH 为回到“重大比赛”群组多次点击整张泛型卡片，工具回执显示页面先后出现加入、移除、再次加入收藏的提示。交接时通过只读 DOM 独立确认：当前在 SBC 列表页，“重大比赛”卡片的 `.btn-favorite` 带 `checked`；因此它仍在我的最爱，原来的第一关视图也未恢复。此后没有替用户点击 EA 页面。

最后的浏览器请求因 `journal_capacity` 停止。不要以另一条未经核对的浏览器操作通道绕过该停止结果；先确认请求状态、扩展实际加载的代码及当前页面，再决定是否恢复收藏和视图。恢复时只能瞄准精确的收藏控件并读回 `checked` 状态，打开群组应瞄准标题而非整卡中心；任何已发送而结果不明的写动作仍按原请求核对，不自动重放。

## 源码与验证分层

| 层次 | 当前事实 | 尚未证明 |
| --- | --- | --- |
| SBC 领域 | `fc-sbc-*` 源码已有探针、库存快照合同、报价预检、只读方案/预演、风险与批准预览；侧栏有 SBC 只读梳理入口 | 真实 EA 完整库存适配、实时报价接入、购买/填阵/提交运行链路 |
| 侧栏连接与目标 | [连接状态](../../apps/chrome-extension/src/assistant-surfaces.js)及[侧栏](../../apps/chrome-extension/src/sidebar.js)已有 presence/retry 和多窗口候选标记的源码修正；目标固定写入当前侧栏 Session，不会自动转给另一 DSH 对话 | 用户当前安装版本是否包含这些修正；断线重连与跨窗口选择的实机复验 |
| 浏览器点击 | [Puppeteer 点击](../../apps/chrome-extension/src/browser-puppeteer-actions.js)和[DOM 点击](../../apps/chrome-extension/src/browser-page.js)对含唯一可见标题的 pointer 泛型行选择标题；有独立控件而标题落点不可信时拒绝整卡点击 | 用户实际安装的扩展是否已重载新代码；实页重新点击后是否切换正确、不会误触收藏 |
| 请求日志 | [扩展 journal](../../apps/chrome-extension/src/assistant-journal.js)在容量或字节压力下回收较早、已完成的只读回执；保留写入、未决请求和本次结果 | 真实旧 journal 重载后的恢复结果；若无法回收且全是必须保留的回执，仍会拒绝新请求 |
| 测试构建 | 最后一次聚焦测试为 6 文件、113 项通过；相关文件 `oxlint`、`node --check`、`git diff --check` 与 `pnpm run build:chrome-extension` 通过 | Chrome 已安装扩展、DSH Web Profile 与 EA 实页的端到端验收 |

`fc-sbc-inventory-snapshot.js` 规整已给定的库存输入，不会自行遍历俱乐部；`fc-sbc-quote-preflight.js` 检查已给定的报价，不是实时价格来源；`fc-sbc-page-probe.js` 只读当时已渲染内容。不要把这三个模块的存在写成库存或报价已接通。

这些测试针对当时的脏工作树，不是可复用的通过证书；受影响代码变化后重跑相应检查。不要把构建的 Puppeteer vendor 文件当成扩展脚本已经在 Chrome 内刷新。

## Token 与页面模型

“页面认知”约 20 条是[侧栏从已交付工具结果派生的展示项](../../apps/chrome-extension/src/assistant-cognition.js)，删除展示项本身不会移除模型历史。该 DSH 勘察会话的 `tokenUsage` 投影为新增输入 135,381、缓存读取 1,840,128、输出 7,680，合计约 198 万；用户所说的 20M 可能是其他任务或汇总口径，不能混称。最后一步的提供方提示词约 13.4 万 token，模型上下文窗口为 100 万。

[浏览器工具](../../packages/browser/tool-browser/src/index.ts)每次 `browser_action` 后默认把最多 64 个控件和 4,000 字正文的反馈快照以完整 JSON 交给模型；25 次工具调用、26 个模型步骤令历史反复进入后续请求。`browser-assistant` [预设](../../packages/preset/agent-presets/presets/browser-assistant/agent.cordis.yml)已挂载工具结果修剪器，但默认压缩在上下文窗口约 80% 才触发，此会话未达到。优先减少模型可见的重复页面数据和模型往返，不要把 UI 认知条目数当作 token 根因。

建议建立范围很小的 FC 页面语义模型，而不是训练另一套 AI：识别 SBC 列表、群组详情、俱乐部和 SBC 仓库；输出关卡要求/奖励、当前选中态、页面身份、读取时间、来源与覆盖状态。关卡名称、顺序和要求指纹只可作为当前页面内的临时定位依据，不伪装成稳定 EA ID；虚拟列表未遍历完成时保持 `coverage=partial`。模型可以把多次完整快照收敛为有来源的结构化事实，但每次页面点击仍须经过现有浏览器权限、journal 与结果核验。

## 接手顺序

1. 重新核对工作树、当前 Goal 状态、扩展实际安装来源和当前 DSH/FC 页面身份；不要因文档中的旧 tab/document/session 标识直接操作页面，也不要重启正在服务 Codex 的宿主进程。
2. 在用户明确允许恢复页面状态后，先用只读方式确认旧请求没有未决写入及 `journal_capacity` 的现状。若 Chrome 安装的是此仓库的未打包扩展，重载扩展以装入新源码，然后用有界只读请求验证 journal 能继续；失败仍停下，不删除 journal 或清空授权。
3. 精确读回“重大比赛”的收藏状态；只有确认原状态与要恢复的状态后才进行一次可逆收藏操作，并再次读回。随后通过标题进入群组，核对默认第一关；不要把 generic 卡片中心当安全落点。记录操作数及是否恢复。
4. 先在保存的会话/页面样本上优化 `browser_action` 模型可见反馈，保留新鲜引用、页面身份、截断标志和源码证据；用相同四关事实、无误触与 token 用量做回放对比，再考虑有界 FC 页面模型。不要仅调低压缩阈值替代输出治理。
5. 任务读取完整后，分别证明俱乐部 311 张的实例覆盖、SBC 仓库总量/去重与锁卡、市场权限和同平台报价。任何一项未知都只交付缺口，不进入购买、填阵或提交。后续批准只覆盖用户选定的整组方案、卡版本、价格上限与提交范围。

聚焦回归入口：`pnpm run test -- apps/chrome-extension/tests/assistant-journal.spec.ts apps/chrome-extension/tests/browser-page.spec.ts apps/chrome-extension/tests/browser-puppeteer-actions.spec.ts apps/chrome-extension/tests/browser-puppeteer.spec.ts apps/chrome-extension/tests/browser-executor.spec.ts apps/chrome-extension/tests/sidebar.spec.ts`。实页验收需另行记录已加载扩展版本、页面身份、观察到的状态和所有副作用；单元测试不能代替这一层。
