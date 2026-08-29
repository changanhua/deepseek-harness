---
description: "将 GitHub Issue snapshot 导入不可变 Personal Delivery contract revision 的 Consumer。"
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-github-intake

[English](README.md) | 中文

## 摘要

`dsh-delivery-github-intake` 是一个纯 Consumer，把一个精确 GitHub Issue snapshot 转成不可变 Delivery Contract revision。它导出 `importGitHubIssue`，接收显式、由 host 提供的 `fetch`，且只能读取 `Delivery.snapshot()` 并调用 `Delivery.adoptContractRevision`。它不保存 GitHub credential、不同步所有 Issue、不注册 service，也不拥有 Delivery storage。

## 使用此包

传入 canonical Issue URL 与必需的已配置本地 repository identity。Intake 会从可信 Delivery snapshot 推导同一 Issue 的上一 revision；browser 不能选择或拼接 revision lineage。函数会在内容派生的幂等键下返回既有或新采纳的不可变 revision。

```text
const revision = await importGitHubIssue(
  { delivery: ctx.delivery, fetch },
  {
    issueUrl: 'https://github.com/example/project/issues/42',
    repositoryId,
    signal,
  },
)
```

Admission 只接受精确形式 `https://github.com/{owner}/{repository}/issues/{positive-safe-integer}`。它会在 `fetch` 运行前拒绝 credential、port、query string、fragment、尾随或额外路径、percent-encoded path segment、非公开 host、`github.com.evil` 等近似 host、零或补零 issue number，以及超出 JavaScript safe integer 范围的数字。caller 拥有认证并选择 URL。

Issue body 包含且仅包含一个权威 block：一行 `<!-- dsh-delivery-work-brief@1 -->`，后面立即接精确的 `yaml` fence。[`fixtures/work-brief.valid.md`](fixtures/work-brief.valid.md) 是可复制模板。严格 YAML value 必须包含 `format`、outcome、context、两组 scope array、带显式 id 的 acceptance clause 与 open decision、base-selection rule、verification source 和 reference link。Block 外 narrative 只是辅助 context。Clause、decision 与 inline-check 的稳定 id 必须匹配 `^[a-z][a-z0-9-]{0,63}$`；字段缺失会失败，不会获得默认值。导出的 parser 拒绝重复 block、alias、重复 YAML key、未知字段，以及超过 64 KiB 的权威 YAML。

## 理解实现

Request boundary 用 Zod 校验严格的公开 github.com Issue grammar，在任何 I/O 前闭合 authenticated-fetch SSRF 与 credential leak 路径。`parseGitHubIssueWorkBrief()` 与 `workBriefContractRevisionDraft()` 已冻结可执行 body grammar 及其精确 Delivery mapping。Network fetch、response validation、canonical-coordinate check、snapshot digest、同一 Issue predecessor lookup、idempotency 与 adoption 仍位于不可用的 `importGitHubIssue` boundary 之后。HTTP cache 状态与可变 GitHub status 永远不是持久 Delivery authority。

## 模型体验

### 导入的 Issue 上下文

#### 模型看到什么

此包不会向模型发送任何内容；下游 shaping 或 execution 代码可以渲染已采纳 `ContractRevision` 的字段，而此 Consumer 只保留精确 Issue snapshot 与已解析 contract structure。

#### Token 影响

Intake 不增加 prompt token、tool schema 或模型调用；保持一个紧凑 Work Brief 可以减少其他包组装的 execution context。

#### KV Cache 影响

没有直接 KV cache 贡献；稳定 Issue template 可能让下游 prompt 更规则，但 cache 行为由相应 Consumer 自己拥有。

## 已知限制

- **Issue adoption 不可用**——校验精确公开 github.com Issue grammar 后，`importGitHubIssue` 会以 `DeliveryGitHubIntakeError('unavailable')` 拒绝；authenticated fetch、response validation、snapshot lookup 与 adoption 均不受支持。Work Brief parser 与 golden grammar 已可用。
- **不支持 GitHub Enterprise**——由于没有独立 trusted-host policy，任意 host 都会被拒绝，不会通过可配置 URL 准入。
- **每次调用只处理一个 Issue snapshot**——webhook、polling、bulk synchronization、comment、Projects、label 与 PR mutation 均不在范围内。
- **不自动发明需求**——每个权威字段都必须存在；未解决的歧义必须成为带显式 id 的 `openDecisions` entry，intake 不能悄悄把 Contract 变为 ready。
