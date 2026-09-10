---
description: "供需要显式安装、页面和元素目标的消费方及提供方使用的会话寻址浏览器服务定义。"
kind: "package-reference"
---

# @changanhua/dsh-browser

[English](README.md) | 中文

## 摘要

当浏览器工作必须标识会话及其准确的安装、页面或元素目标时，请使用本包。消费方可以列出已授权实例，并通过 `ctx.browser` 提交操作；提供方决定如何执行该操作。不可用或丢失的结果保持为 `unknown`，因此消费方必须协调该结果而不是重放操作。该定义本身不挂载提供方或路由；扩展提供方连接 Chrome worker。

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

交互式 `snapshot` 操作接受可选的 `query`、`offset`、`limit` 和 `textLimit` 字段，用于语义控件搜索、分页和正文预算。它还接受 `tree`、`treeCursor` 和 `treeLimit`：树读取会从一份缓存的完整 DOM 层次分页返回稳定节点和父节点索引，元素引用仍是准确的快照局部节点。扩展提供方验证取值范围；工具负责模型可见的默认值与操作反馈。

条目操作使用明确的页面身份和内容区域。`entry_inspect` 是只读操作：它在一个区域内计算以 `:scope` 开头的条目选择器，报告匹配数、有效数、标题或链接缺失数、重复链接数和有界样本，而且不修改页面。`entry_mount` 可以使用相同区域和选择器，为每个有效条目添加一个受控操作；`entry_unmount` 删除准确的挂载标识。动态 Cordis Plugin 应使用运行器管理的 `harness.browser` facade，使 Session 身份、稳定挂载标识和生命周期清理不依赖生成代码。

动作类型还覆盖已准备的鼠标、键盘、表单、选择、拖放、上传、导航、标签、截图、滚动和等待操作。上传路径必须是绝对路径，并在当前用户消息中逐字出现，模型工具才会执行；该路径来源检查不增加新的批准框。

`isAuthorized(instance)` 同步复查旧实例快照是否仍符合当前身份、授权版本、权限和站点范围。异步工作结束后、返回保留的观察内容前使用它。离线本身不撤销权限；撤权一开始，此检查就必须失败。

`instances()` 报告已授权的浏览器安装，不暴露凭据。`execute()` 接受显式会话、安装和操作目标；`prepare()` 返回绑定到该提供方、epoch、Session 和操作且会过期的 ticket，`executePrepared()` 只能提交该 ticket。结果区分已观察到的本地操作、失败、取消和 `unknown` outcome。`unknown` 结果不构成重试许可，因为提供方无法证明浏览器没有执行变更性操作。

`observe()` 只在显式 observation grant epoch 以及 `browser:read` 和 `browser:observe` 两项 scope 下执行有限的 `tabs` 或 `snapshot` 读取。观察快照不会在交互元素缓存中分配或保留元素引用；浏览器不可用绝不报告为未变化的观察结果。

本包没有配置，也没有独立挂载路径。请与 [`@changanhua/dsh-browser-extension`](../browser-extension/README.zh.md) 等连接 Chrome worker 的提供方组合，并由消费方记录其需要保留的任何会话结果。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制 — 点击展开</summary>

`Browser` 是 `ctx.browser` 的服务定义。其 API 携带会话、安装、页面和元素的不可变引用，而不是发现隐式活动浏览器目标。提供方实现实例发现、准备和执行；消费方拥有其会话写入及恢复策略。[源代码](src/index.ts) 和[操作类型](src/types.ts)定义准确的公开形状。

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

无。本定义不注册模型工具、提示词区段或模型上下文，也不发起模型请求。消费方决定操作结果是否及如何成为会话事件；本定义不将结果写入会话。

#### KV Cache 影响

无。浏览器引用和操作结果不会通过本包进入模型上下文。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 本包仅定义抽象；它不提供浏览器执行器、持久化、模型工具或面向用户的路由。
- `unknown` outcome 保持未解决，直至负责的消费方完成协调；该定义绝不将其转换为自动重试。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>供维护者使用的工作上下文 — 点击展开</summary>

无。

</details>
