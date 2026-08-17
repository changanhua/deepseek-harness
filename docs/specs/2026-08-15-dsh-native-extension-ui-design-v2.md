# DeepSeek Harness 原生扩展 UI 设计规格 v2

日期：2026-08-15  
状态：三段交互方向已确认，待书面规格复核  
交付目标：据此制作一款新的单文件 HTML 原型，不修改本地 DeepSeek Harness 源码与运行数据

## 1. 设计结论

本轮不再把 Conversation、Queue、Skills、MCP、Trace 等对象强行压进一个“综合控制台”。产品继续以 DSH 原生会话工作区为主，按对象性质扩展：

- **Queue 是功能模块**：在左侧主导航直接提供入口，进入独立 Queue 工作区。
- **Skills 与 MCP 是能力管理**：加入现有会话标题栏的动作行，与 Agent preset、Subagents、Background jobs 并列，以轻量 Popover 快速查看和管理。
- **Conversation 与 Trajectory 保持原生主轴**：不重新发明对话、轨迹或执行流。
- **系统配置继续使用现有 Settings 外壳**：保留 General、Models、Agent presets、Plugins 等原有分区；Skills/MCP 的“管理全部”进入这里的对应管理页，而不是另建一个平行设置中心。
- **默认视图与高级诊断分层**：普通用户先看到状态、影响和可执行动作；原始事件、完整参数、重试细节与内部标识只在 Trajectory 或显式 Diagnostics 中出现。

## 2. 证据边界与非目标

本规格以当前本地 DSH 的插件化界面与能力语义为依据。当前可确认的原生界面构件包括 Sidebar、Conversation、Trajectory、Subagents、Background jobs、Agent presets、Settings 与 Skills；MCP 由 `mcp-client` 插件提供工具桥接能力。

本规格不做以下事情：

- 不替换 DSH 的会话、消息、轨迹、模式、子代理或后台任务展示。
- 不把 Queue、Job、Goal、Approval、Skill 和 MCP 混成同一种“任务”或同一种状态机。
- 不在首页暴露 event sequence、PID、原始 JSON、完整提示词、密钥或内部 receipt。
- 不假定 MCP 已支持 resources 或 prompts；当前 UI 只呈现其已桥接的 tools。
- 不把 HTML 原型中的模拟按钮描述为已经接通真实写接口。
- 不直接写入 `C:\Users\xbh\deepseek-harness`，不读取或修改真实用户配置、任务或密钥。

## 3. 产品壳与导航

### 3.1 左侧主导航

沿用现有侧栏结构与视觉语言，只新增一个一级入口：

```text
New session
Workspaces / Sessions
Queue                 ← 新增，一级功能模块
Settings              ← 原入口保留
```

Queue 入口可附加小型状态徽标，例如“2 running”“1 failed”或 service fault。徽标只传达需不需要关注，不把完整队列表塞进会话首页。

点击 Queue 后，主内容区切换为独立 Queue 工作区；侧栏仍在，因此用户可一步返回任何 Session。Queue 不是 Settings 子页，也不是标题栏 Popover。

### 3.2 会话标题栏动作行

保留既有会话标题栏，并在同一行补入 Skills 与 MCP：

```text
[Standard mode] [Skills] [MCP] [Subagents] [Background jobs]
```

顺序表达三类上下文：

1. 本会话采用的 Agent preset / mode；
2. 本会话可用的能力来源：Skills、MCP；
3. 本会话派生的执行对象：Subagents、Background jobs。

这些入口都采用 DSH 已有的标题栏按钮/Popover 交互，不增加第二条全局工具栏。按钮在首页始终可见，用户无需先进入 Settings 才能知道能力是否可用。

### 3.3 会话主内容

继续使用原生的：

- **Chat**：对话、工具摘要、审批与结果交付。
- **Trajectory**：Session / Turn / Step、工具调用、重试、错误、上下文压缩等执行事实。
- **Composer**：消息输入与当前模式相关的原生控制。

新增能力不能改变 Chat/Trajectory 的切换逻辑，也不能把 Queue 表格或 MCP 配置插入消息流。

## 4. Queue 独立工作区

### 4.1 首屏目标

进入 Queue 后，用户无需继续下钻即可回答四个问题：

1. 队列服务是否正常接收任务；
2. 当前正在执行什么、并发槽是否已满；
3. 哪些任务需要人工处理；
4. 选中任务的结果、错误和恢复动作是什么。

建议布局：

```text
Queue service / capacity / pause state
Filters + search + enqueue entry
Task list or compact board          Task detail
                                     status / attempt
                                     current run
                                     error / recovery
                                     artifacts / related session
```

在 1440px 桌面宽度下使用列表加右侧详情；窄屏改为列表后进入详情，不横向压缩成不可读的多列仪表盘。

### 4.2 状态语义

任务状态必须直接使用 Queue 的状态机：

| 内部状态 | 用户文案 | 允许的主要动作 |
|---|---|---|
| `pending` | 等待中 | 取消；若后端允许则调整优先级 |
| `starting` | 启动中 | 查看；必要时取消 |
| `running` | 运行中 | 查看当前执行；取消 |
| `stopping` | 正在停止 | 查看，避免重复取消 |
| `succeeded` | 已完成 | 打开结果、Artifacts、相关 Session |
| `failed` | 失败 | 查看原因；满足条件时重试 |
| `canceled` | 已取消 | 查看原因；满足条件时重新入队 |

`blocked` 不是新的 TaskStatus。界面中的“需要处理”是派生集合，可能来自待审批、失败任务、Goal blocked、Queue service paused/faulted 或恢复不确定；每一条必须显示真实来源。

Queue service 单独使用：

- `running`：正常接收与领取任务；
- `paused`：暂停领取，可执行 Resume；
- `faulted`：服务级故障，保持 sticky/fail-closed，普通 Resume 不可清除。

当 service 为 `faulted` 时，Resume 按钮禁用并说明需要检查持久化/恢复信息或完成操作员恢复流程，不能伪装成单任务失败。

### 4.3 当前执行与并发

Queue 顶部显示容量摘要，例如 `2 / 3 running`，任务详情显示当前 attempt、开始时间、耗时、executor 与最近进度。并发不是动画装饰；只有数据源能证明多个任务或多个工具同时运行时才显示并行关系。

从 Queue task 可深链到相关 Session。若没有可靠关联，只显示“无关联会话”，不得通过标题相似度推断。

### 4.4 错误、恢复和 Artifacts

失败详情必须同时显示：

- 可理解的错误摘要；
- 当前 attempt 与是否仍可重试；
- 下一步动作；
- 输出文件或 Artifacts；
- 高级诊断入口。

涉及跨重启进程状态不确定时，只在高级诊断展示 `orphan-unknown`、`terminationUnverified` 等字段。PID 仅供关联，不作为可直接终止进程的凭据。

## 5. Skills 标题栏 Popover

### 5.1 默认内容

点击 Skills 后直接显示：

- 已发现 Skill 数量与当前异常数量；
- 搜索；
- Skill 名称、简短说明、来源；
- `modelInvocable` 与 `userInvocable` 策略；
- 无效 frontmatter 或加载失败的明确警告；
- “管理全部”入口。

来源最少区分 project、user、bundled。Bundled Skill 标为只读；project/user Skill 只有在存在可靠写权限与写接口时才显示可编辑策略。

### 5.2 操作边界

快速操作只负责调用策略，不在 Popover 中编辑 Skill 正文、删除文件或改变安装来源。保存失败必须保留原值并给出错误反馈。

如果当前实现只有只读 registry，而没有策略写 API，原型必须把开关标为 Demo；正式实现应先补可验证的 provider/config 写入路径，不能只改前端内存。

## 6. MCP 标题栏 Popover

### 6.1 默认内容

点击 MCP 后显示每个 server 的：

- 状态：connected、reconnecting、disabled 或 error；
- transport：stdio 或 streamable HTTP；
- 当前工具数量与可展开的工具名；
- 最近错误或下一次重连提示；
- 在权限允许时提供 Enable/Disable、Reload；
- “管理全部”入口。

会话中的 MCP 工具调用继续作为普通 Tool Call 出现在 Chat 摘要与 Trajectory 中，通过 `mcp__server__tool` 来源标记识别，不另造一套 MCP 执行轨迹。

### 6.2 重连与停用语义

- reconnecting 时保留最近一次成功加载的工具清单供用户辨认，但明确标注调用当前不可用。
- 重连成功后更新状态和工具 generation。
- 重试耗尽后显示 error，并提供 Reload 或进入设置排查。
- Disable 后对应工具从可调用 generation 中移除。
- 密钥只显示引用是否配置，不显示值，也不提供复制明文动作。

若配置来自只读来源，则 Disable/Reload 仅显示解释或隐藏，不呈现可点击但永远无效的开关。

## 7. 原生运行信息的保留方式

### 7.1 当前执行与工具调用

当前执行仍由 Chat 与 Trajectory 表达。Chat 默认把完成的工具调用折叠为人类可读摘要；失败、等待审批或用户主动展开时显示详情。同一 Step 内的多工具并发在 Trajectory 中显示为并行分支，不改写成虚假的连续步骤。

### 7.2 Approval

审批继续紧邻发起它的 Tool Call，显示工具、风险摘要、作用范围与 Allow/Deny。完整参数放入详情。审批不变成 Queue task；“需要处理”可以聚合它，但必须深链回原始位置。

### 7.3 Agent preset、Subagents 与 Background jobs

三者保留现有标题栏入口和 Popover 行为：

- Agent preset / mode 在 Session 开始时确定；新 Session 可改变默认值，不承诺运行中热切换。
- Subagents 继续展示本 Session 的派生代理与状态。
- Background jobs 继续展示当前 owner/process 可见的后台任务，不与持久 Queue 混称。

### 7.4 Goal、Context、Compaction、Model 与成本

这些信息按使用时机投影，不全部塞进标题栏：

- Goal 在会话或相关运行中显示当前目标与阶段；blocked 时进入“需要处理”。
- Context 使用简洁占用/压力提示；Compaction 边界与替换范围进入 Trajectory/Diagnostics。
- Model 与 reasoning effort 沿用会话模式或运行详情中的原生呈现。
- Token/成本仅在存在可信计量与价格数据时显示；否则标为用量或估算，不冒充账单。

### 7.5 Artifacts 与文件变化

会话产物和文件变化继续跟随产生它们的消息、工具或 Trajectory 节点；Queue task 的输出文件也可在任务详情出现。入口提供打开、查看 Diff 或复制路径，不创建一个默认首页“大杂烩”面板。

## 8. Settings 的职责

Settings 继续是完整配置面，而不是日常状态首页。保留既有 General、Models、Agent presets、Plugins 等结构，并补充/承接：

- Skills：完整清单、来源、诊断与可写策略；
- MCP：server 配置、transport、启停、重载、错误与密钥引用状态；
- Queue：只有真正属于系统策略的容量或持久化配置才进入 Settings，日常任务操作仍在 Queue 工作区。

标题栏 Popover 与 Settings 使用同一数据源。Popover 负责快速判断与常用动作，Settings 负责完整编辑和诊断，不能各自维护一份会漂移的状态。

## 9. 数据与写权限矩阵

| 界面对象 | 权威来源 | 默认可操作性 | 限制 |
|---|---|---|---|
| Queue | `ctx.taskQueue` 与持久化日志 | pause/resume、cancel、retry 等后端已支持动作 | `faulted` 只能走操作员恢复；不得前端伪清除 |
| Skills | `ctx.skills` 与 provider | 浏览；有写路径时修改调用策略 | bundled 只读；正文编辑不在 Popover |
| MCP | `mcp-client` 插件与 Cordis 配置 | 浏览；配置可写时启停/重载 | 不暴露密钥；只显示 tools，不虚构 resources/prompts |
| Agent mode | Session 创建配置 | 新 Session 选择 | 不承诺当前 Session 热切换 |
| Subagents | 当前 Session 的子代理投影 | 沿用原生动作 | 不并入 Queue 状态机 |
| Background jobs | jobs provider / 当前 owner | 沿用原生动作 | 不声称跨进程或跨重启持久 |

任何数据源不可用时，界面显示 unavailable/unknown 与原因，不用本地缓存值伪装成实时状态。任何写操作都有 pending、success、failure 三段反馈，并在失败时恢复可确认的权威状态。

## 10. 默认视图与高级诊断

默认视图只展示：

- 当前状态与影响；
- 是否需要用户处理；
- 人类可读错误摘要；
- 可安全执行的下一步动作；
- 结果与 Artifacts 入口。

高级诊断通过 Trajectory、任务详情的 Diagnostics 或 Settings 诊断页显式进入，才展示：

- Session / Turn / Step 与 event type/sequence；
- attempt、runId 和 generation；
- 原始工具参数/结果片段；
- MCP 重连过程；
- Queue 恢复与持久化细节；
- Compaction 边界和 token buckets。

默认与高级视图必须共享同一事实，不允许一个显示“已恢复”而另一个仍显示 faulted。

## 11. 视觉与交互约束

- 延续 DSH 原生桌面 Web App 的布局、密度、边框、字号与现有图标语言；新入口看起来属于同一产品。
- 不使用装饰性渐变、营销式大卡片或满屏 KPI。
- 状态同时用文字、图标/形状与颜色表达，不能只依赖红绿。
- Popover 支持 Escape 关闭、焦点回到触发按钮、键盘遍历和合理的点击外关闭。
- 主要点击目标至少 44px；可见焦点不被移除。
- 1024px 仍可使用；窄屏 Popover 转为侧抽屉或底部面板，Queue 详情转为二级页面。
- 遵循 `prefers-reduced-motion`；运行状态动画不是理解信息的唯一方式。

## 12. 新 HTML 原型范围

下一版原型建议新增为 `05-native-extension-workspace.html`，保留前四款作为历史探索，不直接覆盖。

原型至少可点击验证：

1. 左侧 Queue 入口与 Session 往返；
2. Queue 状态筛选、任务选择、Pause/Resume、Cancel/Retry 反馈；
3. service faulted 时禁用普通 Resume；
4. 标题栏 Skills Popover、搜索、来源与策略状态；
5. 标题栏 MCP Popover、工具清单、reconnecting/error/disabled 状态；
6. Skills/MCP 的“管理全部”进入现有 Settings 壳；
7. 原生 Chat/Trajectory、mode、Subagents、Background jobs 入口保持可见和可用；
8. 默认信息与 Diagnostics 的显式切换；
9. Approval、并行 Tool Calls、Goal、Context/Compaction、Artifacts 与错误恢复的代表性投影；
10. 页面刷新后恢复 Demo 初始状态，并明确标注未连接真实 Harness。

## 13. 验收标准

### 信息架构

- 首页一步可达 Queue、Skills、MCP。
- Queue 明确是独立功能模块；Skills/MCP 明确是能力管理。
- 原生 Conversation、Trajectory、Agent preset、Subagents、Background jobs 与 Settings 没有被删除或降级。

### 语义

- Queue task 状态和 service 状态不混用；`blocked` 只作为派生关注集合。
- Background jobs、Subagents、Approval、Goal 不冒充 Queue task。
- MCP 只呈现工具能力；Skills 正确区分来源和只读权限。
- faulted、重连耗尽、保存失败等异常都有真实边界和恢复说明。

### 可用性

- 1440×900 与 1024×768 无关键内容遮挡或整页横向滚动。
- 键盘可进入所有主入口、Popover、筛选器与动作按钮。
- 每个模拟写操作都有进行中、成功或失败反馈。
- 普通用户无需阅读内部标识即可判断当前状态与下一步。

### 原型诚实性

- 明确标为 Demo 数据与页面内模拟交互。
- 不读写真实 DSH 配置、任务、密钥或 Session。
- 对尚缺写接口的 Skill/MCP 操作明确标注“建议交互”，不宣称已由当前后端支持。

## 14. 规格自检结果

- 未保留任何待补写标记或未决占位符。
- 导航层级与用户确认的“Queue 模块、Skills/MCP 管理入口”一致。
- 未删除或替换 DSH 已有的会话、轨迹、模式、子代理和后台任务展示。
- Queue、Skills、MCP 的数据来源、状态、权限与失败边界均有定义。
- 已明确区分当前能力、需要补充的写接口和仅用于演示的原型交互。
- 新原型的范围、交互与验收条件足以进入实现计划阶段。
