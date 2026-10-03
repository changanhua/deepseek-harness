---
description: "在 Windows 上用隔离的 Subject 和 Grader Agent 执行已准入的 Eval cell，提供经过认证的核心观测、Budget 回执和需确认的证据交接。"
kind: "package-library"
---

# @changanhua/dsh-eval-isolated

[English](README.md) | 中文

## 概述

可信 Host 可以用独立的 Subject 和 Grader Agent 运行已批准的 Eval cell。本库把 Plan 准入、真实 Queue Attempt、对应的仓库租约和 Budget 授权绑定到 Windows AppContainer 执行。在接收方 Host 确认保存材料后，返回实际身份和有边界的证据。执行或交接不确定时保留工作区，并进入 Queue Attention。

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

在组合了 EvalPlans、TaskQueue、RepoWorkspace、LLM 和 Budget 最终派发桥接的可信 Host 中导入 `admitIsolatedEval`。提供原始 Plan resolution、当前 Workspace 授权、锁定的核心产物、明确边界，以及完整保存每份材料后才返回其精确摘要的接收方。复制 resolution 或提供自称可信的摘要不能取得权限。[Host 集成测试](tests/host.e2e.ts) 展示了类型化 Queue 接线。

```text
const run = await admitIsolatedEval(ctx, access, resolution, requestId, config, signal)
const binding = run.bind({ caseId, routeId, repeatIndex })
// Store { eval: binding } as the existing typed Queue Work's resolved data.
const prepared = await run.prepare(binding, signal)
// Inside that WorkKind's start handler, with the Queue's actual StartContext:
return prepared.start(context, (cell, workspace) => ({ cell, workspace }))
```

每个角色的已批准核心目录包含 `node.exe`、含已构建 `@deepseek-ai/dsh/lib/bin.js` 的完整物理 `node_modules` 依赖图、放在目录根部的本包已构建 `worker.js` 和 `startup.js`、已批准插件，以及 `presets/<id>/agent.cordis.yml`。组装产物时解析包链接：镜像准入拒绝符号链接、目录联接和硬链接。使用 [build.ts](src/build.ts) 中相同的有界目录树观测来锁定完整摘要；Host 负责批准产物。分别配置 Subject 和 Grader 的核心目录、摘要及插件配置。固定核心是受信任的 Harness；租约仓库是任务材料，绝不隐式作为核心代码导入。

`runtime.root` 是与 case 工作区位于同一 DOS 卷的 Host 私有目录。边界覆盖镜像文件数和字节数、协议帧和交互次数、模型尝试次数和输出、执行及停止时间，以及证据材料数和字节数。已批准工具通过私有 `eval-isolated/task` 事件，以当前 Session id 和 JavaScript 源码请求执行任务代码；Host 用另一个 AppContainer 身份启动它。核心插件不得在自身进程内求值不可信代码。核心 Job 禁止直接创建子进程。只有 Host broker 持有模型凭据和网络能力。

`output-equals` 或 `output-contains` case 执行一次 Subject。model-grader case 还要求 Host 批准的评分提示词及版本、与 Suite evaluator 匹配的 Plan route，以及精确的能力期望。Grader 获得独立可写目录和 Subject 输出的只读副本，返回 `PASS` 或 `FAIL`。确定性条件和评分必须同时通过。执行完成与该业务结果分开，且永不授予续跑权限。

Plan 参数必须固定模型的有效设置，包括 Provider 会自动填入的默认 reasoning effort。worker 代理只暴露已批准的推理选项，并转发锁定参数；真实 Host adapter 仍会核验是否支持。最终派发若新增或改变未批准的参数，会在 HTTP 请求前被拒绝。

证据引用在已准入 run 内可解析，直到交接确认并释放。之后由接收方负责保留材料。接收方失败时，存活的 run owner 仍提供 `resolveEvidence`。确认等待受 `stopMs` 和调用方取消约束；未完成接收不能触发重复交接、自动清理或把 unknown 结果提升为成功。取消先请求 Agent 停止并刷新 Session，再等待进程 Job；有限宽限期结束后强制终止。usage 缺失、进程退出不确定、刷新失败或清理不确定均保留证据和租约。不自动重试。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

Host 按 run、角色和已验证 revision 复制并验证一次只读镜像，再通过 `dsh --profile eval-isolated` 为每个角色启动私有 home、存储和日志。每次执行的随机密钥通过私有继承启动句柄传入，并在 Agent 接收输入前清空载体。锁定核心认证注册表观测和协议帧；Agent 文本永不充当观测。Host 校验序列、进程身份、完整镜像和配置身份、真实 Tool/Skill/Preset 快照及最终模型派发事实。不匹配时保留实际值并拒绝完成。只有实际身份足够完整才生成 Manifest；提前拒绝会保留证据，不编造模型 route。

Task Job 使用不同的 AppContainer SID，不具备网络能力，仅获得明确的目录 ACL。核心进程和线程 ACL 配合单进程 Job，阻止任务代码窃取 observer 内存。模型请求经认证通道交给现有 Budget guard，在 HTTP 前校验最终 route，并返回 owner 回执。Session 事件、任务结果和派发身份保留为执行证据，与 Manifest schema 分开。[决策记录](../../../.agents/notes/implemented/architecture/2026-10-03-pinned-core-isolated-eval.zh.md) 负责威胁模型和备选方案。

本包不发布运行时不变量 companion：它持有存活执行的托管责任，没有独立缓存的业务投影。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [Eval 契约](../../../docs/subsystems/eval.zh.md)
- [Attempt 工作区桥接](../eval-repo-workspace/README.zh.md)
- [Budget 最终派发](../../budget/budget-llm/README.zh.md)

<a id="model-experience"></a>
## 模型体验

### Subject 和 Grader 输入

#### 模型可见内容

Subject 接收原始 case 提示词、已批准的 Preset 和可见 Tool/Skill 契约。Grader 接收已批准提示词、经过 JSON 编码的不可信 Subject 输出，以及精确返回 `PASS` 或 `FAIL` 的指令。凭据和 observer 认证密钥永不进入模型消息。

#### Token 影响

每个角色分别消耗其提示词、工具和响应 Token。评分增加一个包含 Subject 输出的独立模型轮次。Host 的现有 Budget scope 记录实际 usage；缺失 usage 保持 unknown。

#### KV Cache 影响

角色的提示词和历史彼此独立。稳定 Preset 前缀可以保持 Provider 的常规缓存；每个 Grader 提示词追加的输出取决于 case。本库不重写或合并模型缓存。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 执行需要 Windows x64 AppContainer 和 Job API，且私有 runtime 与 case 工作区位于同一 DOS 卷。不支持的平台直接拒绝。
- 信任 Host、锁定的 Harness 核心、已批准插件和操作系统。任意恶意核心改动及独立自开发认证需要另外的 verifier；Agent 自述不能认证这套基础设施。
- Session-snapshot 条件属于现有回放 executor。附件和图片缺少跨 runtime 的材料及预算契约，因此被拒绝。任务执行目前通过已批准工具接收有边界的 Node 源码。
- 协议和证据有有限的内存及输出边界。必填 diskLimits 对可写世界、临时数据和标准输出采样；增长超限或观测不确定时先请求正常取消，再强制等待 Job 静止。采样不等于文件系统配额，不能限制单次采样间隔内的超量或保留历史的总量。恢复使用新的 Host 世界，不复用不确定目录。run 保留、汇总、决策和用户控制属于下游 owner。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
