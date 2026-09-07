# Agent Note: Queue 重试时间与阶段恢复

Status: implemented

[English](2026-09-08-queue-retry-stage-recovery.md) | 中文

## Problem

短暂的准备失败可能在依赖恢复前就耗尽尝试次数。业务阶段 caller 也可能在准入后丢失 Work 绑定，或在 Queue 完成后丢失业务进度。恢复必须保留原有执行，不能把不确定的副作用转为自动重试。

## Decision

Local provider 对安全自动重试采用 1、2、4、8、16 秒，之后最多 30 秒的延迟。现有 fold 用保留可重试 `not-started` failure 的排队状态表示自动授权；其 `updatedAt` 保存授权时间，`attemptCount` 决定延迟。手动重试和 unknown 处置会清除 failure。这些持久事实使日志与快照恢复能重建执行时间，无需添加第二份持久时钟或改变 schema 3。修改该时间规则必须保留已授权的执行截止时间，或明确改变存储契约。

一个保持进程存活的计时器拥有下一次唤醒。等待工作不持有执行或资源占用。暂停与关闭会清理计时器；恢复调度与注册 Handler 会重建它。到期时重新检查当前状态与容量，包括到期恰好发生在调度轮次结束时的情况。Fold 会拒绝无效的自动重试时间，包括快照恢复路径。Operator 与浏览器读取会公开带有 `eligibleAt` 的 `retry-backoff`。

恢复复用作用域内的 `enqueue()` 与 `get()`。回执查询先于 Handler 查询，包括 Batch 准入。单项工作回执必须匹配请求的 kind，并且不能指向 Batch；尚未完成的准入合并也绑定 kind。持久输入摘要与 schema 保持不变。业务 caller 保存阶段标识、输入与配方版本以及结果绑定，Queue 拥有尝试与结果。审核退回是业务结果，不是执行失败。Unknown 执行需要 operator 处置。

[所有权决策](../architecture/2026-08-27-queue-v2-reuse-boundaries.zh.md)继续有效：Queue 拥有持久执行，Workflow 与业务模块拥有编排语义。[图像 canary 决策](../architecture/2026-08-26-queue-v2-image-canary.zh.md)仍约束格式隔离与产物所有权。这两项决策均未被替代。

## Alternatives considered

- 另存截止时间字段并更换 Queue 根目录：现有不可变授权事实已经能确定时间，无需增加该机制。
- 在运行中的尝试内休眠：工作无法推进时仍占用执行容量。
- 仅依靠完成通知恢复：业务 caller 错过投递时会失去进度。
- 添加持久阶段图或可恢复 worker 协议：超出本次 Queue 契约；业务 caller 可以使用已保存的输入和结果提交有限阶段。

## Consequences

重试仍受 Handler 策略与副作用安全限制。重启、重复提交或截止时间到期均不能授权 unknown 工作。固定延迟策略保持小范围；供应商额度窗口、公平调度、成本归账和业务发布是独立决策。恢复保留执行事实，不承诺任意 worker 中间记忆或外部副作用恰好执行一次。

## Testing

聚焦测试覆盖快照恢复后的时间保留、容量释放、延迟上限、暂停、取消、调度边界到期、缺失 Handler 时的回执恢复与并发 kind 冲突。构建产物的 `dsh --profile queue-stages` 测试通过多个独立拥有进程运行资料、草稿和审核，检查持久事件与执行产物，验证进程被终止后的恢复，以及空闲重试计时器维持 owner 存活。Worker 是确定性的测试代码；这些检查不衡量生成内容质量或模型用量。
