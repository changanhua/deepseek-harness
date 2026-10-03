---
description: "在进程退出后恢复 Eval 准入和控制，并保留精确的私有执行证据。"
kind: "package-reference"
---

# @changanhua/dsh-eval-runs-local

[English](README.md) | 中文

## 摘要

一次提交批准的 Plan，重启后恢复原运行与 Queue Batch。保持 unknown Attempt 的不确定性，先持久化操作控制再执行。读取经校验的证据身份、真实角色 Session、模型用量和耗时，同时保护原始提示和文件位置。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在可信 Profile 中将本实现与 [Plan 实现](../eval-plans-local/README.zh.md)、Queue、Workspace Registry 和私有同步 Storage Domain 一起挂载。容量、保留时间和执行 policy 都必须明确配置。[真实 Profile 恢复 fixture](tests/profile-crash.e2e.ts)绑定既有 Workspace 与冻结核心；用户命令由 [CLI 调用方](../eval-app/README.zh.md)负责。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现说明</summary>

账本保存准入、控制意图和接收 Host 已确认的材料，不复制 Queue 的 Attempt 状态机。提交复用原 Plan 与 Queue 幂等身份，条件式 Queue 变更把控制限制在已观察的 Attempt 上。[私有快照工厂](src/host-snapshot.ts)在可信验证前重新核对原 tuple、材料摘要和 Budget owner。执行服务单独注入，因此历史查询不要求模型路由可用。视图直接派生而无独立缓存，本包不发布 invariant companion。

</details>

<a id="further-exploration"></a>
## Further Exploration

- [包组](../README.zh.md)
- [Eval 契约](../../../docs/subsystems/eval.zh.md)
- [架构](../../../docs/architecture.zh.md)

<a id="model-experience"></a>
## Model Experience

无，本包不增加模型提示或工具，呈现与执行提示由调用方负责。

#### KV Cache effect

本包不改写提示前缀，模型调用由执行与续跑 owner 控制。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 超过明确的保留期限后，证据不可用于核验。容量拒绝或持久化结果不确定会阻止后续写入，直到重新打开 owner。
- 私有材料受账本容量限制；本实现不提供通用制品存储、公开原始证据下载或自动到期删除。
- 新 Attempt 受执行器的 Windows 与锁定核心限制。历史恢复不授权重用未知目录，也不绕过当前 Plan 和 Budget 检查。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者工作背景</summary>

无。

</details>
