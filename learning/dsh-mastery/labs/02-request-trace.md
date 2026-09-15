# Lab — Trace One Real DSH Request

## Capability Target

`source_navigation`, `request_tracing`, `runtime_mental_model`

## Why this lab exists

第一课的 Agent Runtime 图如果不能落到真实源码，就仍然只是“听懂了一个架构故事”。

本 Lab 的目标不是通读 DSH，而是训练一种固定能力：

> 给定一个可观察行为，只追最短源码路径，还原事实怎样进入 Session、怎样成为模型输入、怎样经过 Tool，再怎样回到下一次模型请求。

## Source Baseline

本次训练固定到：

```text
repository: changanhua/deepseek-harness
commit:     894fa35e5a3defe51c5615103e993efaa67680f8
```

对应机器可读记录：`references/source-baseline.yaml`。

如果当前源码已经明显偏离该 commit，不要偷偷用新版本回答；先更新 baseline，再重新验证本 Lab。

## Phase A — Prediction Before Reveal

**先不要打开 `references/source-baseline.yaml` 里的 source anchors。**

只根据 Lesson 01，画出你预计的一次请求：

```text
User input
  ↓
?
  ↓
Session / Inbox ?
  ↓
Agent Loop ?
  ↓
Context / Prompt ?
  ↓
Model
  ↓
Tool Call ?
  ↓
Tool Result ?
  ↓
next model request ?
```

至少先写下：

1. 用户输入第一次进入 Runtime 时，你猜谁拥有它？
2. 你猜模型请求中的 `messages` 从哪里来？
3. 你猜 Tool Result 会先回到“当前局部变量”，还是先成为 Session 事实？
4. 为什么下一次模型调用应该能看到 Tool Result？
5. 哪一步是事实真值，哪一步只是投影？

这部分必须进入 evidence 的 `attempt.prediction_before_reveal`。

## Phase B — Find the Minimum Source Path

完成预测后，才允许查看 `references/source-baseline.yaml` 的 anchors。

不要从仓库目录开始漫游。只围绕下列行为寻找答案：

### Trace 1：输入如何启动一个 turn

找到：

- Agent 接收 follow-up / waking input 的位置；
- 输入先进入哪个队列/投影；
- 谁打开 `turn/start`；
- 被 claim 的输入何时成为 `user/message`。

### Trace 2：模型请求如何构造

找到：

- system/context 在哪里 assemble；
- request 的 `messages` 从哪里取得；
- provider/model 如何确定；
- request header/context 为什么要进入 Session 日志。

### Trace 3：assistant 输出如何成为事实

找到：

- streamed chunk 怎样记录；
- 完整 assistant message 怎样记录；
- 没有 tool call 时 turn 为什么可以结束。

### Trace 4：tool call 如何形成下一步模型上下文

找到：

- model 返回的 tool-call block 怎样进入 scheduler；
- `tool/call` 在什么时候 append；
- `tool/result` 在什么时候 append；
- 为什么下一 step 的 request 能看到该 tool result。

这里最后一个问题是本 Lab 的核心。不要用“框架会自动加进去”作为答案；必须追到具体的 Session surface / `deriveMessages()` 关系。

## Phase C — Write the Trace as Responsibilities

不要抄代码。最终 trace 每个节点只写四件事：

```text
<symbol / component>
- receives:
- does:
- records/changes:
- hands off to:
```

推荐最终压缩成类似：

```text
Input surface
  ↓
Agent inbox
  ↓
Turn/step boundary
  ↓
Session append
  ↓
Session-derived model history
  ↓
LLM request
  ↓
Assistant event
  ↓
Tool scheduler
  ↓
Tool result event
  ↓
Session-derived model history
  ↓
next step
```

这只是**形状提示**，不是文件级答案；实际 symbol、顺序和边界必须由源码证明。

## Phase D — Prediction vs Actual

至少列出 3 个：

- `prediction_correct`
- `prediction_wrong`
- `unexpected_design_choice`

尤其关注：

- 你有没有误以为 Agent Loop 自己持有消息历史？
- 你有没有把 Session 和 Persistence 当成同一件事？
- 你有没有误以为 Tool Result 直接塞回某个 model-call 局部数组？
- 你有没有忽略 turn / step 两级边界？

## Transfer Check

完成主 trace 后，再选一个不同输入类型，例如 steer/inject，回答：

> 它与普通 follow-up 共用哪些机制？在哪个边界开始不同？

不要求再追完整一遍，但必须证明你的心智模型能迁移，而不是只记住一条路径。

## Evidence Required

对应 `CURRICULUM.yaml`：

```yaml
evidence_items:
  source_trace_with_files_and_responsibilities: pass | partial | fail
  prediction_vs_actual_diff: pass | partial | fail
```

Evidence 还必须包含：

```yaml
source:
  repository: changanhua/deepseek-harness
  commit: 894fa35e5a3defe51c5615103e993efaa67680f8
```

建议 `observations` 至少引用这些类别的证据：

- concrete source file + symbol；
- Session append event；
- `deriveMessages()`；
- tool call/result commit；
- next-step request assembly。

## Acceptance

只有同时满足以下条件才算通过：

1. 预测是在读完整 source trace 前写下的；
2. trace 至少覆盖 Input → Model → Tool Result → next Model request；
3. 每个关键节点有 file/symbol 证据；
4. 能解释 Session 为什么是交互历史真值，而 model messages 是派生投影；
5. 能具体解释下一轮模型为什么看到上一轮 Tool Result；
6. 至少指出一个自己的原始预测错误；
7. 用另一个输入类型完成一次 transfer check。

完成后再运行：

```bash
pnpm exec tsx learning/dsh-mastery/tooling/dsh-mastery.ts check
pnpm exec tsx learning/dsh-mastery/tooling/dsh-mastery.ts status
pnpm exec tsx learning/dsh-mastery/tooling/dsh-mastery.ts next
```
