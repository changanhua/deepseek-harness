# @deepseek-ai/dsh-operation-run-task-queue

[English](README.md) | 中文

`@deepseek-ai/dsh-operation-run-task-queue` 注册 `operation.run@1` WorkHandler。它先把调用方选择的 operation id 解析为不可变的 host allowlist 条目并由 Queue 持久化，再通过 `ctx.subprocess` 启动该已解析 operation。

## 配置

插件只有一个 `operations` 对象。每个非空对象键都是调用方可见的 operation id；每个 revision 在该对象内唯一。

| 字段 | 契约 |
| --- | --- |
| `revision` | 非空、不可变的 host revision，随已准入工作持久化。 |
| `description` | 非空 host 描述；它不是调用方输入。 |
| `argv` | 由 host 选择的非空、固定 executable-and-argument 数组。 |
| `cwd` | 由 host 选择并在准备阶段检查存在性的目录。 |
| `resource` | 每次 attempt 声明的非空 Queue resource 名称。 |
| `units` | 每次 attempt 声明的正安全整数 resource units。 |
| `maxAttempts` | 正安全整数 Queue retry 上限。 |
| `collectBytes` | 保留 process output 的正安全整数上限。 |
| `resultBytes` | 成功 stdout 的正安全整数上限，且不大于 `collectBytes`。 |
| `failureTailBytes` | 失败 stderr tail 的正安全整数上限，且不大于 `collectBytes`。 |
| `graceMs` | 正安全整数终止宽限期，且不大于 runtime timer 上限。 |
| `timeoutMs` | 正安全整数执行 deadline，且不大于 runtime timer 上限。 |

Operation definition 是受信任的部署配置，且必须保持无秘密。加载期校验会拒绝字段和 argv 中已知的 credential carrier 结构，但通用 parser 无法证明任意不透明位置文本不是秘密；需要凭据的操作应属于持有 credential reference 并在 operation boundary 解析它的领域 capability 或 WorkKind。

该包不由 base bundle 挂载。opt-in composition 挂载 Queue service 和 local subprocess runtime，在准入可运行前声明 capacity，然后以 host-reviewed allowlist 添加此 handler。

```yaml
- id: task-queue
  name: '@deepseek-ai/dsh-task-queue-local'
  config:
    resourceCapacity:
      operation-run: 1

- id: subprocess
  name: '@deepseek-ai/dsh-subprocess-local'

- id: operation-run-task-queue
  name: '@deepseek-ai/dsh-operation-run-task-queue'
  config:
    operations:
      health.check:
        revision: health-check-v1
        description: Host-reviewed health check.
        argv: [host-reviewed executable, fixed host-reviewed argument]
        cwd: host-reviewed working directory
        resource: operation-run
        units: 1
        maxAttempts: 1
        collectBytes: 8192
        resultBytes: 4096
        failureTailBytes: 2048
        graceMs: 5000
        timeoutMs: 60000
```

## 准入、执行与结果

准入只接受 `{ operationId }`，拒绝未知 id 或扩展输入，并持久化已解析 revision、执行事实、retry policy 和 resource claim。准备阶段会在 process 启动前拒绝不存在的 working directory。每次 attempt 保留有界 stdout 和 stderr，在取消或超时时终止整个 process tree，并在写入终态前等待 tree quiescence。成功结果包含 operation id、revision、summary 以及可选的有界 stdout；通用且按 owner 限定的 Queue result 读取会暴露该 typed result。

## 失败与扩展边界

只有 operation 尚未启动时，spawn 失败才可 retry。非零退出以有界 stderr 记录 `operation-exit` failure；超时记录 `operation-timeout`；缺失 output 或无法确认 tree quiescence 时记录 unknown outcome。调用方不能选择 command arguments、environment values、credentials、working directories、timeout policy、resource claims 或 retry policy。通过修改 host allowlist 和 capacity composition 来添加 operation；通过注册另一个 WorkKind 来添加不同 execution model，而不是扩展 `operation.run@1`。

## 模型体验

### Queue 结果投影

#### 模型看到的内容

模型从 `@deepseek-ai/dsh-tool-operation-run-task-queue` 收到 `operation.run@1` admission schemas；通用且按 owner 限定的 Queue result 读取返回此 handler 持久化的结果。

#### Token 影响

直接 Token 影响为零；此 handler 不注册 prompt section 或 model-facing tool。

#### KV Cache 影响

没有直接失效；挂载或修改此 handler 不改变模型请求前缀，直到其 Consumer 改变已注册 tool schemas。

## 已知限制与延后工作

- 此 handler 只运行显式配置的 local operations，不提供任意 command-execution interface。
- 完成 output 是有界文本；streamed progress、structured per-operation output 和 operation-specific result renderers 不属于 `operation.run@1`。
