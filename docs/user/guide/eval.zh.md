---
description: "通过 CLI 运行已批准的 Eval Plan、检查独立决策，并消耗配置好的一次性续跑授权。"
---

# 运行已批准的评估

[English](eval.md) | 中文

## 摘要

Eval Profile 可以执行已批准的 Plan、保留证据、请求独立 verifier 作出决策，再投递一轮已授权 Goal。这些命令可用之前，Profile 管理员必须配置 Workspace、Plan、隔离运行时、凭据和有上限的 Budget。本指南从已配置的 Profile 开始；[可选 CLI overlay](../../../apps/cli/config/examples/eval.patch.yml)只添加命令入口。

## 目录

- [执行与验收](#execute-and-verify)
- [续跑一次](#continue-once)
- [读取与恢复](#read-and-recover)
- [开发备注](#dev-note)

<a id="execute-and-verify"></a>
## 执行与验收

使用 Profile 已批准的 Plan 和执行策略。重复同一次提交时保持 request id 不变：

```text
dsh --profile eval start --request nightly-17 --plan regression --version 1 --policy approved --wait
```

JSON 结果包含运行 id。运行达到 settled 且 outcome 为 `passed` 表示执行成功，不授予续跑权限。将返回的运行 id 提交给 Profile 的独立验收策略：

```text
dsh --profile eval gate evaluate <run-id> --policy release
dsh --profile eval gate show <gate-id>
```

Gate 可以保留历史 pass，而当前有效性已经 stale。续跑需要当前有效的 pass，且原始报告、输入、Manifest 和回执仍然完整。固定检查器支持输出相等和包含条件；case 要求 Grader 时，还需要已保留的 Grader PASS。

<a id="continue-once"></a>
## 续跑一次

管理员还必须安装明确的续跑策略，固定目标 Session、Goal、Budget 和 followup。在没有其他自动 Goal round driver 的专用 Profile 中，一次性消耗该策略：

```text
dsh --profile eval continue <gate-id> --grant approved --request continue-17
dsh --profile eval activation show <activation-id>
```

`consumed` 表示准确的已授权 Goal 消息已有持久 Session 回执。重复该操作或重启后读取它，不会再投递一轮。这不表示整个 Goal 已经完成。撤销 Budget 或授权过期会阻止新的续跑。

<a id="read-and-recover"></a>
## 读取与恢复

使用 `show <run-id>` 检查运行，不会派发工作。Attempt 不确定或 activation 为 `needs-attention` 时，应检查保留证据，不要更换 request id 来强行重跑。[CLI 契约](../../../packages/eval/eval-app/README.zh.md)说明显式 Queue 恢复控制；[续跑生产者](../../../packages/eval/eval-activation-local/README.zh.md)定义当前部署限制。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
