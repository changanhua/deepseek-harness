# 配置可信 Eval 来源与资源预算

[English](trusted-eval-and-budget.md) | 中文

在包含 [Eval](../../packages/eval/README.zh.md) 和 [Budget](../../packages/budget/README.zh.md) 包的检出中使用本指南。发送模型请求前，先配置独立的 Host 组合。这些包不会重启或修改已运行的个人实例。

## 1. 配置预算 owner

[已验证的 headless 配置](../../packages/budget/budget-local/tests/fixtures/profile/budget.patch.yml)展示 Storage Domain 路由、私有 SQLite、预算 owner 以及 Agent/LLM 桥接。使用现有 profile 对应的 realm：基础存储 realm 为 `web-host`，headless 也使用它。将 `resource_budget` 路由到配置了 `ownership: exclusive`、`journalMode: delete`、`synchronous: full` 和 `privateDirectory: true` 的后端，并明确选择账本容量。

在 Commands 旁挂载 `command-budget`。让 Agent 工作前，先发出明确列出全部上限的人工命令：

```text
/budget {"action":"set","scope":"session","limits":{"requests":4,"inputTokens":100000,"outputTokens":20000,"totalTokens":120000,"wallTimeMs":600000},"onExhausted":"pause"}
/budget {"action":"read","scope":"session"}
```

Goal 及其 Session 预算存在后，可使用 `scope: "goal"`。Goal 预算继承 Session 预算。对于 Workflow，在 `budget-workflow.workflows` 中配置确切的 workflow 名称、上限与耗尽策略。请求的模型配置还必须包含正数输出上限。空 Token 上限表示本层不增加限制，不会移除父级上限。

作用域定义不可变。相同设置是幂等操作；更改上限需要新的获准作用域或 Session。`revoke` 永久拒绝选定作用域。`receipt` 读取 request/attempt 回执；`reconcile` 还要求经操作人员核对的输入/输出计数，并且只结算未知用量。任何命令都不会将缺失用量静默变成零。

## 2. 审查 Plan 与 Suite

[示例 Plan](../../packages/eval/eval-plans-local/examples/minimal-v1.plan.json)引用具有十个确定性 case 和两个 route 绑定位置的[版本化 Suite](../../packages/eval/eval-plans-local/examples/minimal-v1.suite.json)。每个 route 在 [headless 语料库](../../snapshots/session/headless.snapshot.ts)中都有独立的人工编写 Session 记录。回放证明运行框架和确定性检查路径，不衡量真实模型质量。

通过普通项目文件复制或编辑 Plan/Suite。fixture 路径必须保持相对且受根目录约束。Plan 的 route 参数接受 `maxTokens`、`temperature`、`reasoningEffort` 和 `stop`，不接受凭据值、cwd 覆盖或 Queue payload。固定完整的仓库 commit。Suite 的源码 revision 和选定 route 身份必须与 Plan 一致。

解析 Suite 并计算 `evalContractDigest(parsedSuite)`，将身份填入 `suiteRef`，再解析和哈希完整 Plan。[示例批准值](../../packages/eval/eval-plans-local/examples/minimal-v1.approval.json)展示得到的 id/version/digest。审查后将该值复制进 Host 拥有的配置。可写项目中的批准文件本身不是授权。

## 3. 挂载来源并检查预检

[已验证的 Plan 配置](../../packages/eval/eval-plans-local/tests/fixtures/profile/plans.patch.yml)展示完整来源结构。设置受信绝对 `root`、相对 `planFile` 与 `suiteFile`、批准身份、明确的文件/cell 上限、所需产物身份及凭据模式。`workspaceId: null` 选择该确切根目录对应的已注册 Workspace；非空 id 还固定 registry 身份。将 `eval_plan_admissions` 路由到私有同步后端。

在 Host 配置中分别定义无密钥回放和真实调用。`mode: live` 要求 Plan 凭据引用与明确的 Host grant 匹配，且所有绑定凭据均已配置。必需预算必须由 Budget owner 解析。预算豁免只由完整的 Host 固定 Plan 授权，修改项目文件不能自行获取豁免。

挂载 `command-eval-plan`，明确配置由 Host 选择的 `entrypoint` 和 `maxOutputBytes`。使用发现结果中的相同 Plan id/version：

```text
/eval-plan {"action":"discover"}
/eval-plan {"action":"preflight","id":"trusted-plan-example","version":"1"}
/eval-plan {"action":"admit","id":"trusted-plan-example","version":"1","requestId":"reviewed-run-1"}
```

预检报告来源身份、Workspace 策略、入口权限、Provider/model 与 Preset 可用性、所需 Tool/Skill 身份、凭据和预算状态。Preset digest 对 CRLF 归一为 LF 后的组合文本进行哈希。Tool 身份覆盖已注册契约；Skill 身份包含 provider/source 和指令内容。缺少 owner、内容漂移、grant 不可用和预算耗尽都会阻止准入。修复对应 owner 或更新审查后的 Host 固定值，再重新解析。

准入重新检查 owner 签发的解析结果，并为相同请求保留同一运行标识，不启动 Queue 工作或模型请求。重新加载只发布完整来源代次；过期解析对象和调用方自行构造的 JSON 不能被准入。执行器、验证器、GateDecision 和自动 Activation 仍是独立职责。
