---
description: "供需要显式安装、页面和元素目标的消费方及提供方使用的会话寻址浏览器服务定义。"
kind: "package-reference"
---

# @changanhua/dsh-browser

[English](README.md) | 中文

## 摘要

当浏览器工作必须标识会话及其准确的安装、页面或元素目标时，请使用本包。消费方在派发前生成请求 ID，列出已授权实例，并通过 `ctx.browser` 提交操作；提供方决定如何执行该操作。不可用或丢失的结果保持为 `unknown`，因此消费方必须协调该结果而不是重放操作。该定义本身不挂载提供方或路由；扩展提供方连接 Chrome worker。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当实现浏览器提供方，或实现已拥有会话范围内操作的可信消费方时，导入此定义。

### 语义与恢复

交互式 `snapshot` 操作接受可选的 `query`、`offset`、`limit` 和 `textLimit` 字段，用于语义控件搜索、分页和正文预算。它还接受 `tree`、`treeCursor` 和 `treeLimit`：树读取会从一份缓存的完整 DOM 层次分页返回稳定节点和父节点索引，元素引用仍是准确的快照局部节点。可信任务消费方还可以附加最多 32 个有界 `presentationQueries`，把预期文本绑定到 `mountId`；只有扩展隔离页面运行时仍拥有该挂载且实际面板仍连接时，才报告成功。模型可见的快照 schema 不暴露这项内部证据查询。扩展提供方验证全部边界；工具负责模型可见的默认值与操作反馈。

条目操作使用明确的页面身份和内容区域。`entry_inspect` 是只读操作：它在一个区域内计算以 `:scope` 开头的条目选择器，报告匹配数、有效数、标题或链接缺失数、重复链接数和有界样本，而且不修改页面。`entry_mount` 要求相同所有者与绑定已有成功预检，且区域、条目节点与字段仍然有效；没有证据返回 `inspect_required`，证据变化返回 `stale_binding`。无效替换不会移除仍有效的挂载。动态 Cordis Plugin 应使用运行器管理的 `harness.browser` facade，使 Session 身份、稳定挂载标识和生命周期清理不依赖生成代码。

`entry_unmount` 移除准确的所属挂载，并报告 `unmounted` 和 `remaining`。普通卸载保留文档内已确认的 `collected` 集合；恢复挂载前须重新预检。省略 `collected` 复用该集合，显式数组替换它，`[]` 清空它。卸载时传 `forgetCollected: true` 还会释放保留集合。导航与所有者释放不会把集合恢复到其他文档或 Session。复用节点不能派发之前的标题或链接。业务收集仍由消费方负责；按钮状态不是持久存储，也不是收集成功的证据。

动作类型还覆盖已准备的鼠标、键盘、表单、选择、拖放、上传、导航、标签、截图、滚动和等待操作。上传路径必须是绝对路径，并在当前用户消息中逐字出现，模型工具才会执行；该路径来源检查不增加新的批准框。

`isAuthorized(instance)` 同步复查旧实例快照是否仍符合当前身份、授权版本、权限和站点范围。异步工作结束后、返回保留的观察内容前使用它。离线本身不撤销权限；撤权一开始，此检查就必须失败。

`instances()` 报告已授权的浏览器安装，不暴露凭据。`execute()` 接受显式会话、安装和操作目标；`prepare()` 是只读的准入探测，返回绑定到该提供方、epoch、Session 和操作且会过期的 ticket；`executePrepared()` 只能提交该 ticket。准备不是已派发的 attempt。结果区分已观察到的本地操作、失败、取消和 `unknown` outcome。`unknown` 结果不构成重试许可，因为提供方无法证明浏览器没有执行变更性操作。

每个 `BrowserOperation` 都携带调用方在派发前生成的请求 ID。`browser/operation-intent` 准入逻辑操作，`browser/dispatch-intent` 是发送前的最终决定，`browser/operation-settled` 发布其不可改写的结果。提供方会在派发前记录该身份，因此完全相同的重复调用只读取同一份保留回执，不会再次执行页面操作。需要重启恢复的消费方会在派发时保存公开且不含动作的 locator，在发送前 flush 其持久状态，之后只查询状态。在线实例携带执行器握手：协议版本、已实现 action 种类和请求恢复支持。消费方必须把缺失 capability 快照或变化的授权 epoch 视为不可用 authority，而不是猜测 worker 的能力。

`page_map` 为 `region_render` 建立短时、精确文档证据，但最多返回 64 个不透明的 `regionRef`，而不是 CSS selector。`region_render` 接收一个引用和一个有界的 `BrowserRegionPresentation`；Host 解析私有 selector 并编译扩展 payload。公开 action 与 status 结果会递归移除展示 selector 和编译后的 blocks。这不改变条目适配：`entry_inspect` 和 `entry_mount` 仍是由提供方验证的 selector 动作。只有该引用仍命名所选区域时，提供方才可以追加扩展自有区域；替换还要求其 disposable 提示，并拒绝 protected 或未知区域。只有已观察到 `cleared:true`、已观察到精确的 `disposition:'absent'`，或已发送且返回 `document_replaced`，才能确认清理；`target_url_stale` 表示资源仍未解决，必须重新观察或作出恢复决定。Host registration 带有 generation：晚到的 clear 或 unmount 只能结算其捕获的 generation，不能删除后来复用同一 ID 的 render 或 mount。

`observe()` 只在显式 observation grant epoch 以及 `browser:read` 和 `browser:observe` 两项 scope 下执行有限的 `tabs` 或 `snapshot` 读取。观察快照不会在交互元素缓存中分配或保留元素引用；浏览器不可用绝不报告为未变化的观察结果。

本包没有配置，也没有独立挂载路径。请与 [`@changanhua/dsh-browser-extension`](../browser-extension/README.zh.md) 等连接 Chrome worker 的提供方组合，并由消费方记录其需要保留的任何会话结果。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制 — 点击展开</summary>

`Browser` 是 `ctx.browser` 的服务定义。其 API 携带会话、安装、页面和元素的不可变引用及调用方生成的请求身份，而不是发现隐式活动浏览器目标。提供方实现实例发现、能力声明、准备和执行；消费方拥有其会话写入及恢复策略。[源代码](src/index.ts) 和[操作类型](src/types.ts)定义准确的公开形状。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [浏览器扩展提供方](../browser-extension/README.zh.md) — 为此定义连接经认证的 Chrome worker。
- [架构](../../../docs/architecture.zh.md) — 说明服务定义、提供方和消费方角色。
- [会话子系统](../../../docs/subsystems/session.zh.md) — 负责持久会话事实及其恢复语义。

-----

<a id="model-experience"></a>
## 模型体验

### 浏览器消费方

#### 模型可见内容

此定义不注册直接工具或提示词区段。组合的消费方可以暴露 `ctx.browser` 操作，但该定义本身不会把页面数据或操作结果加入模型上下文。

#### Token 影响

本包单独使用时没有影响；任何工具 schema 与结果成本属于组合的消费方。

#### KV Cache effect

本包单独使用时没有影响；消费方组合决定是否存在可缓存的模型前缀。

## 已知限制与后续工作

- 本包仅定义抽象；它不提供浏览器执行器、持久化、模型工具或面向用户的路由。
- `unknown` outcome 保持未解决，直至负责的消费方完成协调；该定义绝不将其转换为自动重试。
- 会话持久的任务验收、证据、回执和页面资源处置属于 [`@changanhua/dsh-browser-task`](../browser-task/README.zh.md)，而非此服务定义。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>供维护者使用的工作上下文 — 点击展开</summary>

无。

</details>
