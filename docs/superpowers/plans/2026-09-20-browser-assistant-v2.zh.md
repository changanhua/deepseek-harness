# 浏览器助手 V2 实施计划

[English](2026-09-20-browser-assistant-v2.md) | 中文

**目标 / 完成条件：** 交付已认可的个人扩展：独立首页、用户自主选择对话、Browser 工具与 Cordis 共用的固定目标、有证据的页面认知，以及新对话后仍能使用的全局/页面功能。完成需要真实扩展与模型链路，HTML 原型不算产品验收。

**架构：** 改造现有扩展控制器、Browser/BrowserTask 与 Dynamic Cordis。Host 拥有执行身份和生命周期，Chrome 拥有界面选择和草稿，UI 渲染投影。不另建浏览器任务引擎或通用功能注册表。

**依赖：** Windows/PowerShell、当前仓库和依赖、已连接的 Chrome 扩展及已配置的 DeepSeek V4.1 Flash 路由。普通 Codex 开发不属于 DSH 自开发；验收中的 DSH 执行网页任务，不修改源码或自证通过。

**真实验收路径：** 会话/目标接通后即固定页面 A、浏览 B，并通过扩展询问 A。随后创建、使用、修改并停止真实页面功能，在创建与停止之间新建对话。独立检查受影响的 DOM、模型请求路由、回执和资源所有权。

**广泛验证预算：** 首个真实切片执行一次完整 `pnpm run build` 和 `pnpm run build:chrome-extension`；后续源码变更才在最终阶段重建。最终冻结后运行一次受影响测试、`pnpm run lint:contracts-ready`、`pnpm run test:docs` 和 `pnpm run doc-sync`。耗时尚未实测。复用未失效证据，仅重跑失败或变更所属项，不循环全仓测试。

## 基线与交接

本文是实施计划，不是已交付能力说明。仓库：`C:\Users\xbh\deepseek-harness`，分支 `master`，HEAD `0e23e42b68da6cc65c41aba15cf23ebcd1896a89`。初始二进制 diff hash：`546e01fa87f27fc3d3f204c38cdbbf8e8ee22fb5`。HEAD 变化不推翻产品决定，但复用源码证据前必须检查相关差异。

认可的视觉源文件：`C:\Users\xbh\.codex\visualizations\2026\09\16\01a0aae0-e995-7ae3-9f8b-5956317badf7\dsh-browser-assistant-v2.html`；SHA256 `95DF8B40CFDEC428CC0A7AB3D1947DEB046DF782BD0B6F73574D2A2AE5DC659E`。保持其视觉层级和交互，用真实适配器替换模拟状态、回复与功能。

保护现有脏文件：`packages/browser/browser-extension/tests/{gateway,grants}.spec.ts`、`packages/browser/browser-task/tests/browser-task.spec.ts`、`packages/browser/tool-browser/src/schema.ts` 及 `packages/browser/tool-browser/tests/{diagnostics,loop,policy}.spec.ts`。尽量新增同目录专项测试；有重叠时先读并保留原有修改，不暂存或回滚无关工作。

2026-09-20 已执行基线：`pnpm run test -- apps/chrome-extension/tests/assistant-session.spec.ts apps/chrome-extension/tests/assistant-surfaces.spec.ts apps/chrome-extension/tests/sidebar.spec.ts`——3 个文件、41 项通过，耗时 12.35 秒。这些旧测试不覆盖 V2 验收。现有构建记录写的是 `a7cbead`，未重新验证，不能作为本候选版本的证据。

交付模式为 `governed`。Astra 负责本交接与边界决定，Sol 负责后续实现和集成，Terra 负责有界 UI 子任务。计划本身不授权新建 GitHub Issue、PR、推送、替换运行服务或后台监控。

## 已冻结的产品决定

| ID | 可观察需求 | 所属任务 / 证据 |
| --- | --- | --- |
| R1 | 无页面也能使用首页；继续、新对话和历史由用户决定；主导航为对话 / 页面认知 / 功能。 | I2 / 真实 UI |
| R2 | 可固定、切换目标；浏览其他标签绝不隐式改目标；Browser 和 Cordis 均遵守。 | I1、I3 / A-B 错页负向测试 |
| R3 | 按精确页面文档归并认知，并以语义页面地图展示。只展示实际送达 Agent 的内容/DOM，注明来源、时间、范围和遗漏。固定标签不读正文，小幅 DOM 变化不刷新认知。 | I4 / 日志与 UI 对照及读取次数 |
| R4 | 全局/页面功能具有真实打开、运行、停止、详情和自然语言修改入口，新对话不销毁它们。 | I5 / 独立 DOM 与生命周期观察 |
| R5 | 流式输出、编辑、重连与多界面不重复显示消息、不转投草稿、不重放未知提交；保留模型选择和图片附件。 | I1、I2 / 归约器与集成测试 |
| R6 | 验收行为来自准确绑定的扩展/Host 构建和实际模型路由，具备五层证据与独立审查。 | I6 / 验收记录 |

采集、监控和独立阅读退出主体验，但不删除其后端或数据。不做多页面任务编排、自动 DOM 轮询、新授权向导、新容量参数、跨进程功能持久化或页面自动重注入。全局可见不等于全浏览器操作权限。

## 共享约定

### 对话与目标

每个界面获得独立、不透明的身份和选择/草稿状态，并按连接地址与安装身份隔离。会话目标由 Host 拥有、带修订号，由明确选择该会话的界面共享。每次发送携带预期会话及目标修订号；不一致时在本地或接收处拒绝，不转投内容。新对话从未绑定目标开始；仅显示首页不创建会话。

固定的是稳定标签，不是永远有效的文档。操作接收时解析当前文档/框架身份，分发时再次约束。导航使旧元素/区域引用失效，但不改变用户的标签选择。标签关闭后显示不可用，绝不回退到前台标签。进行中的操作保留已捕获目标，切换不能重定向已发送的写操作。

绑定不是读取、浏览器授权或验收证明。模型可见的目标事实通过既有持久会话链路记录；复用 BrowserTask 精确目标和请求核对不变量，不能只靠提示词保证目标正确。

### 页面认知

Host 投影成功且已提交的工具结果或明确提交的上下文；待发送采集不是页面认知。每项记录会话、来源事件/请求、目标/文档、观察时间、实际读取模式、已读范围/节点及截断/遗漏。快照/树游标遵守实际有效期，不能把分页片段称为完整 DOM，也不能从 URL 推断已知正文。

认知按会话与精确文档区分。首次与页面有关的问题可触发有界读取，普通聊天不触发。后续问题复用证据，除非确需新信息。手动刷新要求真实且模型可见的读取。点赞等小变化不触发轮询、哈希或模型调用。导航后保留上次观察并标明来自先前文档，不把其中定位引用视为仍有效。

### 用户功能与临时资源

功能具有稳定身份、来源会话/插件/版本/运行身份、全局或精确页面范围、用途及真实运行/渲染/清理状态。全局/页面是展示范围，原执行权限仍受约束。停止功能与停止对话不同；更新功能必须结算旧运行后再安装新运行。

区分创建任务的临时执行资源与交付功能资源。仅经检查、精确移交给存活功能所有者的资源才能解除创建任务的清理义务。单个 `retained` 状态、UI 勾选或模型声称都不能令任务完成。接收者承担停止/核对责任；未知写入和清理在得到观察前仍未解决。禁止把脱离任务的清理通道扩大为任意执行通道。

V1 保留范围为同一 Host 进程内跨轮次、重开面板与新对话。明确交付的功能在现有 Cordis 注册表中提升为已认证个人安装所有者的资源；`createdBySessionId` 仅是审计来源，不再触发销毁。未交付插件维持现有 Agent 所有权。原 Agent 释放不能销毁已提升的功能。Host 丢失不等于重启持久化；导航/文档丢失后需显式重跑并获取新引用，不能自动注入。

每个显式用户功能命令经现有已认证扩展通道接收，并指定精确功能/版本。新运行或自然语言修改捕获当前存活 Agent/会话及重新验证的目标权限；旧运行保留原清理账本。跨会话可见本身不授予权限。不能伪装旧 Agent 仍存活，也不能让模型提供的所有者/会话字符串产生控制权。同一个人安装不需要新增同意弹窗。

### UI 适配器

Sol 在 `apps/chrome-extension/src/assistant-view.js` 及其测试中拥有单一视图模型适配器。它输出有文档的 `surface`、`session`、`target`、`cognition`、`functions` 状态；`session` 包含规范化消息/历史/模型选择，功能是 Cordis 交付物，不是设置卡片。Terra 只消费投影并分发命令，渲染代码不承担 Host 生命周期策略。

命令覆盖创建/选择/停止/加载历史会话、固定/选择/清除目标、附图发送、刷新/定位认知、打开/运行/停止/编辑/查看功能，以及现有连接/模型设置。Sol 在 I1 中冻结具体 JS 参数与测试数据后 Terra 才开始 I2。传输失败保留类型化错误和请求身份，不能以乐观成功状态替代回执。

冻结 `function/edit` 为 `{ type, requestId, functionId, expectedVersion, sessionId, expectedTargetRevision, instruction }`。页面修改需要匹配的目标修订号，全局修改使用 `null` 且不授予 Browser 访问权。安装所有权由已认证通道推导，Host 从经检查的会话解析当前存活 Agent；调用方不能提供所有者或 Agent 身份作为权限。陈旧版本/目标在模型执行前拒绝。精确选中功能引用与接收的用户指令一起记入日志。运行使用相同身份封装；停止指向捕获的运行及原清理目标，而非新选中的页面。

功能快照为 `{ availability, items }`，availability 是 `unavailable`、`loading` 或 `ready`；items 仅来自已认证 Host 目录，携带精确功能/版本/运行身份、范围及已观察的执行/渲染/清理状态。I5 接通前生产适配器返回 `unavailable` 且无条目。I1 的运行/清理测试数据只用于测试，I2 不能将其发布为回退数据。

## 交付依赖与所有权

`I1 →（I2 UI 与 I3 Host 目标并行）→ 尽早真实 A/B 切片 → I4 认知 → I5 交付功能 → I6 最终验收`。I5 生命周期约定由 Sol 串行实现，UI 控件随后接入。这些是本地任务编号，不是 GitHub Issue。

### I1 — 会话与适配器基础（Sol）

角色：消费方。修改 `apps/chrome-extension/src/{assistant-session,assistant-runtime,assistant-surfaces,worker}.js`，新增 `assistant-view.js` 与 `apps/chrome-extension/tests/assistant-view.spec.ts`。由现有 worker 向侧栏和独立窗口广播适配器真实状态。仅更新受影响的 session/surfaces/channel 测试。先以界面草稿隔离、发送时会话/修订不符、消息替换和断流重同步用例跑出 RED。复用正式 Host `assistant-stream` 及实时基线；有界重同步期间保留已结算内容。未知提交只核对状态，不重新提交。

完成：运行基线命令及 `pnpm run test -- apps/chrome-extension/tests/assistant-view.spec.ts`，提供未读/已读/流式/离线/功能运行/清理待定状态的具体适配器测试数据。如修改正式流代码，加入 `packages/api/session-controller/tests/assistant-stream.host.spec.ts` 与 `packages/api/session-controller/tests/assistant-stream.client.spec.ts`。本任务不代表目标约束或 V2 完成。

### I2 — 已认可的 UI（Terra）

角色：消费方；依赖 I1。独占文件为 `apps/chrome-extension` 下的 `sidebar.html`、`src/sidebar.js`、`src/sidebar.css`、`tests/sidebar.spec.ts`。迁入认可的布局、目标控件、认知与全局/页面功能标签。保留草稿、附件、键盘行为、可访问名称及已有模型选择。移除采集/监控/阅读主导航，不删除底层模块或保留数据。不支持或不可用的操作必须明确展示，不能硬编码演示成功。

完成：通过 `pnpm run test -- apps/chrome-extension/tests/sidebar.spec.ts` 跑出 RED/PASS，验证适配器命令及空白/错误状态。Terra 返回有界改动及命令结果，不声明功能完成。Sol 负责适配器集成及 `tests/sidebar-{activity,monitors}.spec.ts` 中过时导航预期的更新，保留后端测试。

### I3 — 统一目标约束与首个真实切片（Sol）

角色：桥接；依赖 I1 并集成 I2。拥有 `packages/browser/browser-task/src/{types,domain,fold,index}.ts`、`packages/browser/browser-extension/src/{types,index,sessions}.ts`、`packages/browser/tool-browser/src/{loop,index}.ts` 与 `packages/extensions/cordis-host-runner/src/index.ts` 中的浏览器入口。在 Browser-extension 测试旁新增 `target-binding.spec.ts`，不覆盖受保护 WIP。Host 绑定所有者为 BrowserTask 的会话投影，独立于单个任务，两条调用链共用。对普通读取/动作和 Cordis 均约束会话目标，覆盖后台标签、陈旧文档和切换竞态。保持浏览器权限及已有个人本地信任行为不变，不引入可重定向其他会话的 Host 全局选中标签。

新增专用 `packages/preset/agent-presets/presets/browser-assistant/agent.cordis.yml` 组合既有 Browser 和 Cordis 工具，通过 `sessions.ts` 在扩展创建会话时明确选择。保持 standard/cordis 预设不变。扩展 `packages/preset/agent-presets/tests/composition-inventory.spec.ts` 与 `packages/browser/browser-extension/tests/sessions.spec.ts`。现有会话保留其预设；能力不匹配时明确显示，不静默替换。此组合须先于首个真实切片，不留到最终验收。

完成：专项目标测试 RED/PASS 后执行完整构建与扩展构建；使用运行时前先核对身份。固定 A 并浏览 B，发起真实页面问题，在 A 上执行可撤销页面动作。独立观察 B 无动作，且会话/工具回执中的文档准确一致。本步骤先于广泛加固；失败后定点诊断，不重复全量测试。

### I4 — 有证据的页面认知（Sol，随后 Terra 接渲染）

角色：消费方；依赖 I3。按[语义页面地图计划](2026-09-21-browser-assistant-semantic-page-atlas.zh.md)的 P0–P4 顺序实施。`apps/chrome-extension/src/assistant-cognition.js` 及其测试负责确定性页面/区域/覆盖度投影；`assistant-runtime.js` 和 I1 适配器传递该状态，并负责既有刷新/定位命令的接收端。来源为已提交的 Browser 快照、页面地图、有界集合提取及明确接收的上下文。既有 follow 有界窗口无法供给来源时才补最小 Host 投影；渲染器不能自行读页，也不持久化第二份完整 DOM 数据库。

完成：`pnpm run test -- apps/chrome-extension/tests/assistant-cognition.spec.ts apps/chrome-extension/tests/browser-dom-tree.spec.ts apps/chrome-extension/tests/browser-context.spec.ts apps/chrome-extension/tests/sidebar.spec.ts`。RED/PASS 证明页面级归并、实际送达前未读、部分覆盖不夸大、会话/文档隔离、陈旧定位移除、点赞变化不增加读取及刷新仅走一次请求链路。真实页面地图必须与已提交来源事件及 page-map 几何对照，不能只检查模拟文案。

### I5 — 交付功能生命周期（Sol）

角色：桥接；依赖 I3/I4。改造 `packages/extensions/cordis-host-runner/src/{index,types,lifecycle,registry}.ts`、`packages/extensions/tool-cordis/src/{index,prompt}.ts` 与 BrowserTask 的 `src/{index,types,domain,fold}.ts`；扩展已有 browser-extension 网关，不另开无作用域路由。在 BrowserTask 测试旁新增 `function-handoff.spec.ts` 并扩展 runner 测试。复用 Dynamic Cordis 定义和操作回执提供发现/运行/停止/更新，遵守上述提升所有权规则。移交事实记录精确任务/资源/目标与插件/包/运行身份。只有已观察为 active 且无待定写入或清理的资源才能移交，`release-pending` 不能。归约/回放、BrowserTask 完成与 tool-browser 验证必须对这个经检查的处置保持一致。普通卸载留下的采集缓存不是 retained 可见资源。

完成：先用 RED 拒绝伪造移交、跨安装所有者、陈旧版本、未解决写入和伪造 retained 状态。PASS 必须证明回执支持的移交、临时资源已结算后的创建任务完成、新对话后功能可用、显式停止与已观察清理、失败/未知清理、更新顺序、导航和所有者丢失。先运行专项 BrowserTask 与 runner 测试，再跑真实创建/使用/新对话/停止场景；不得豁免清理以取得绿色结果。

### I6 — 组合、独立审查与验收（Sol 集成主代理）

角色：验收；依赖 I1–I5。保持现有 `base` BrowserTask 与 `web-app` Browser-extension/Cordis 组合。仅更新受影响 README、所属子系统类型、生成声明/目录及双语记录；实现通过前保持提案决策记录的真实状态。为新可见行为补录制会话回放和扩展浏览器覆盖。共享 manifest、锁文件、目录及广泛命令始终由主代理拥有。

对稳定改动与证据记录使用一次全新 Sol High 只读审查。检查错页/跨会话权限、资源移交、重放/未知结果及测试缺口，不提供预期结论。有证据的问题修复一次并仅重跑受影响检查；新证据揭示其他重大风险时才再审。

## 验收证据

使用自然语言目标，不规定工具调用脚本。例如在真实讨论/文章页提出：“比较这页已经展开的观点，做一个我能继续使用的小对比面板，点一条就能回到出处。期间我会看别的标签，你继续处理固定的这一页。”随后：“我新开了对话，把刚才的对比工具打开，再加一列出处。”最后通过扩展停止。不为此测试发布评论、购买、上传私人文件或修改外部账号。

| 层级 | 必需的闭环证据 |
| --- | --- |
| source-contract | 审查后的有界改动、RED/PASS 与 WIP 保全；无未检查的 retained 完成或仅靠提示词的目标策略。 |
| generated-declaration | 与候选源码绑定的最新 Host/Client 生成约定、扩展构建及受影响目录检查。 |
| composed | 准确的 web Profile/Bundle/Agent 可见性，以及普通 Browser 和 Cordis 两条链路。 |
| runtime-observed | Host PID/启动时间/构建、扩展安装/源码路径与版本、会话/请求/目标身份、实际提供方/模型 ID 与不含秘密的路由。 |
| behavior-verified | 独立前后 DOM 与截图；仅 A 有副作用；认知对应已送达数据；跨对话可用；停止清理精确资源；保留原始失败与独立审查。 |

本功能五层均必需。五层记录和原始证据保存在 `.artifacts/browser-assistant-v2/`，隐藏秘密及无关网页数据。提供方报告时记录请求次数/token 用量，不编造价格或预算。UI 模型标签不能单独证明 `deepseek-v4.1-flash`，需保留目录到请求的映射，替换模型前询问。

## 委派与升级

默认并行为 Sol 加一个 Terra。不递归委派、不重复全仓扫描、不让子代理跑广泛测试。Terra 仅接收认可原型、具体适配器约定、独占文件、专项命令与停止条件，并保留其他人的修改。Sol 集成并负责验收；确有独立且足够大的任务时才增加第二个工作代理。

仅在目标/权限/生命周期约定变化、计划外跨域重设计、两轮有证据诊断仍无根因，或审查发现错页/跨会话/重放/资源控制风险时升级 Astra。返回有界信息：预期、观察、准确身份、首个偏离边界、最小备选及需要的决定。常规失败由 Sol 处理。

无法保留的 WIP 冲突、缺少真实模型/扩展访问或需要新增外部/破坏性权限时停下。不能为简化测试停止无关服务或重装用户扩展，不能凭本交接、源码测试或原型验证宣称产品完成。

## 开发备注

当前约定核查发现 worker 全局会话绑定、前台标签取页、旧流渲染和无断流重同步。现有页面/树快照与 Dynamic Cordis 是复用基础，不是 V2 完成证据。[提案决策](../../../.agents/notes/proposed/feature/2026-09-20-personal-browser-assistant-v2.zh.md) 说明所有权拆分。I1–I6 实施状态均从未开始起算。

产品目标尚未完成；只有列出的验收证据才能闭环。
