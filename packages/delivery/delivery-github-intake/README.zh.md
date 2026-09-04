---
description: "从 GitHub Issue snapshot 创建或修订 Personal Delivery Case 的 Consumer。"
kind: "package-reference"
---

# @changanhua/dsh-delivery-github-intake

[English](README.md) | 中文

## 摘要

`dsh-delivery-github-intake` 是一个纯 Consumer，把一个精确 GitHub Issue snapshot 转成 Delivery Case 的创建或修订。它导出 `importGitHubIssue`，接收显式、由 host 提供的 `fetch`，且只能读取 `Delivery.snapshot()` 并调用 `Delivery.createCase` 和 `Delivery.reviseCase`。这组窄依赖把需求批准排除在其权限之外，因此导入不会记录 requirement decision，也不会批准 revision。它不保存 GitHub credential、不同步所有 Issue、不注册 service，也不拥有 Delivery storage。

## 使用此包

传入 canonical Issue URL 与必需的已配置本地 repository identity。Intake 会定位 root revision 带有匹配 `github-import` origin 的唯一 Delivery Case，因此 Case 内后续 human revision 不能使其脱离原始导入；重复 revision identity、损坏的 Case chain 或多个匹配 Case 都会 fail closed。首次导入一个 Issue 时，会使用确定性 root key `github:{owner}/{repository}:issue:{n}:root` 创建 Case；其 `github-import` origin 对精确 title 与 body 取 digest，并把 Issue title 作为 revision title。Issue 内容变化时，会在 expected-head compare-and-set 下使用 key `github:{owner}/{repository}:issue:{n}:previous:{headRevisionId}` 修订该 Case。若导入 snapshot 的内容已与当前 head 相同，则直接返回该 revision，不执行 Delivery write；若 Case 绑定到另一个 configured repository，或 head 带有 human revision，则拒绝导入。函数返回已导入 Case 的 revision head。

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

Request boundary 会在任何 I/O 前校验严格的公开 github.com Issue grammar，闭合 authenticated-fetch SSRF 与 credential leak 路径。它通过 host 提供的 `fetch` 读取一个派生的 GitHub API snapshot，要求 HTTP 200 与 `application/json`，并拒绝 malformed、coordinate 已漂移或无效的 immutable snapshot。`parseGitHubIssueWorkBrief()` 与 `workBriefContractRevisionDraft()` 冻结可执行 body grammar 及其精确 Delivery mapping。在同一进程中，同一 Delivery instance 与 Issue coordinate 的调用会把 snapshot 到 commit 串行化，并在该 turn 内重新读取权威 snapshot；无关 Issue 不会共享这条临时 tail。取消会在 fetch/body read 后以及 Delivery snapshot 前后检查，并一直有效到紧邻的 `createCase()`/`reviseCase()` commit point；一旦 Case write 已开始，就以 Delivery 的结果或失败为权威，不会把它重标为未提交的 abort。导入绝不记录 requirement decision：生成的 revision 保持未批准状态，在 human 作出决定前不能创建 Work Packet。HTTP cache 状态与可变 GitHub status 永远不是持久 Delivery authority。

## 模型体验

### 导入的 Issue 上下文

#### 模型看到什么

此包不会向模型发送任何内容；下游 shaping 或 execution 代码可以渲染已导入 `ContractRevision` 的字段，而此 Consumer 只保留精确 Issue snapshot 与已解析 contract structure。

#### Token 影响

Intake 不增加 prompt token、tool schema 或模型调用；保持一个紧凑 Work Brief 可以减少其他包组装的 execution context。

#### KV Cache 影响

没有直接 KV cache 贡献；稳定 Issue template 可能让下游 prompt 更规则，但 cache 行为由相应 Consumer 自己拥有。

## 已知限制与延期工作

- **只支持一次公开 Issue 读取**——intake 只读取由 canonical Issue URL 派生的公开 GitHub API endpoint，不接受 Enterprise host、credential、cache、webhook、polling 或 write-back authority。
- **不支持 GitHub Enterprise**——由于没有独立 trusted-host policy，任意 host 都会被拒绝，不会通过可配置 URL 准入。
- **每次调用只处理一个 Issue snapshot**——webhook、polling、bulk synchronization、comment、Projects、label 与 PR mutation 均不在范围内。
- **不自动发明需求**——每个权威字段都必须存在；未解决的歧义必须成为带显式 id 的 `openDecisions` entry，intake 不能悄悄把 Contract 变为 ready。
- **较晚返回的旧 HTTP 响应会追加 revision**——version-2 contract 不保留导入的 GitHub `updatedAt`，所以延迟到达的 stale response 会成为当前 head 的 expected-head child，而不会被识别为更旧；重复的相同内容仍保持幂等。
