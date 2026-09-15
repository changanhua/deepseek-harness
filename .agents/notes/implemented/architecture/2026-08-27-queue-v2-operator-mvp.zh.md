# Agent Note: Queue v2 operator MVP

Status: implemented

[English](2026-08-27-queue-v2-operator-mvp.md) | 中文

## Problem

Queue 页面直接暴露全部 durable 生命周期状态，提供没有依据的 reconcile 操作，并允许重叠的浏览器读取覆盖更新的状态。标准 Web composition 还把无认证的 operator surface 绑定到所有网络接口。

## Decision

Queue v2 Remote 把 durable 记录投影为四种 operator 状态：queued、running、attention 和 done。终态 done 行另带 succeeded、failed 或 canceled outcome；durable 生命周期事件和恢复语义保持不变。四状态投影刻意小于 durable 状态词汇表；operator 紧急度排序是客户端投影，绝不是持久化的优先级。

浏览器工作台使用一条串行刷新链、主从布局、四个筛选与大小写不敏感的标题或 ID 搜索。行按 operator 紧急度与更新时间排序。动作限定在选中的行：待执行或运行中的任务可取消，失败任务可重试，需处理任务可决策。未知重试描述为“确认重试”，并要求显式勾选已知悉可能产生重复副作用；确认失败需要 operator 填写原因。UI 不提供 reconcile 或成功确认，因为它无法验证任一声明。Owner 始终只是路由元数据，绝不是授权保证。

store 在刷新失败时保留最后一次成功的行、详情与刷新时间戳，并如实标注。待定的 mutation 只锁定其自身 work ID，因此搜索、筛选、选中、刷新与无关行仍可用。工作台复用共享 primitives 中的 `RiskConfirmation`、`Toast` 与 `JsonTree`，而不是包内自制等价物。Batch 操作、分析、任务创建与结构化成功确认保持缺失。

标准 Web bundle 默认绑定 loopback；在存在带认证的 operator surface 前，CLI 拒绝全接口绑定。

## Alternatives considered

**压缩 durable 状态机。** 拒绝，因为 starting 与 unknown 即使在 operator 不必区分时仍保护 dispatch 与 crash recovery。

**保留一键 reconcile。** 拒绝，因为它在未证明 executor 仍拥有任务的情况下，把 unknown durable attempt 改成 running。

**保留带警告的 LAN 发布。** 拒绝，因为 Queue Remote 授予 operator authority，浏览器没有登录边界。

**用卡片网格取代主从工作台。** 拒绝，因为紧凑列表加单个详情面板能以更少扫视满足“找到并处理”路径。

**在四状态之外再增加 UI 状态。** 拒绝，因为 starting 呈现为 running、unknown 呈现为 attention，无需额外的 operator 可见状态。

**始终可见的原始 JSON。** 拒绝，因为 operator 需要结构化摘要、尝试与结果检查，而非原始转储。

**全局 pending 锁。** 拒绝，因为一个进行中的 mutation 会阻塞无关行与刷新。

**用原生 `window.confirm` 承担风险确认。** 拒绝，因为共享的 `RiskConfirmation` 对话框提供勾选确认与一致的键盘行为。

**Batch 控件。** 拒绝，因为本版本的 operator 工作一次只处理一个任务。

## Consequences

工作台足以处理日常任务管理，同时保留 durable Queue v2 模型。Batch 操作、artifact 浏览、服务端分页与结构化成功确认仍延后。未来 LAN operator surface 必须先增加认证，才能重新启用非 loopback 绑定。

## Testing

定点 Remote 测试固定四状态投影。客户端测试固定视图模型的排序与圆点、保留刷新证据、串行刷新，以及带精确 Remote 输入的可访问 attention 工作流。真实浏览器 smoke 验证 Queue 页面、durable Work ID 与 loopback listener。
