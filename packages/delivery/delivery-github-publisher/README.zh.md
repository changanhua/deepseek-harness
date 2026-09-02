---
description: "将已批准的 Personal Delivery Case revision 渲染为 GitHub Issue 并如实记录发布结果的 Host-only library。"
kind: "package-library"
---

# @deepseek-ai/dsh-delivery-github-publisher

[English](README.md) | 中文

## 摘要

`dsh-delivery-github-publisher` 让 Host Consumer 把一个已批准、ready 的 Delivery Case revision 发布到其已配置的 GitHub repository，同时不向 browser 或 model caller 提供 credential、repository path、idempotency key 或 external-resolution authority。[`delivery-remote`](../delivery-remote/README.zh.md) 提供 Delivery、credential、target-map、clock 与 HTTP boundary；本库渲染 Issue、在 network I/O 前持久化 intent、校验 201 response，并提交返回的 Issue binding。Transport uncertainty 与 request 后的无效 response 会成为耐久 `unknown` state，而不会触发自动重试。入口是普通 library API，不注册 Cordis service。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发注记](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

### 何时使用

从已经拥有 `RepositoryId -> GitHubRepositoryRef + CredentialRef` 配置映射与可选 Issue label 的 trusted Host Consumer 使用此库。需要 browser-safe operation 的 caller 使用 [`delivery-remote`](../delivery-remote/README.zh.md)；只导入现有 Issue 的 caller 使用 [`delivery-github-intake`](../delivery-github-intake/README.zh.md)。不要把此包作为 `cordis.yml` row 挂载。

### 入口

最小 publication 调用传入 capability，而不是 Context：

```text
const publication = await publishGitHubIssue(
  { delivery: ctx.delivery, credentials: ctx.credentials, fetch, targetForRepository, now },
  { caseId, revisionId, signal },
)
```

成功会返回耐久 `published` record。重复 logical call 会返回同一 binding，不再发出 POST。缺失配置会在 HTTP request 前失败；request start 后的 failure 会被记录为 `unknown`。只有在人类选择 candidate Issue number 后才使用 `resolveGitHubIssuePublication()`：该函数执行 fresh GET，且仅当完整 body、terminal marker 与 digest 匹配时确认 `published`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

Renderer 从 Case 与 revision id 派生唯一 publication id，输出便于人类阅读的 requirement section，并对 title 加 marker-free content 计算 `renderedDigest`。Terminal marker 随后携带真实 publication id 与 digest，不会形成 self-referential hash。Delivery 拥有持久化的 `prepared -> publishing -> published|failed|unknown` transition；本库拥有 HTTP side-effect boundary，且绝不缓存已解析 credential。

| 文件 | 作用 |
|---|---|
| [`src/render.ts`](src/render.ts) | 确定性 Issue body、有界 UTF-8 output、digest 与 terminal marker |
| [`src/index.ts`](src/index.ts) | Publication、response validation、failure classification 与 GET reconciliation |
| [`src/failures.ts`](src/failures.ts) | 不含 raw provider 或 credential detail 的稳定 Host error code |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion；mutable state machine 由 Delivery 拥有 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Delivery package group](../README.zh.md) — Case、execution、evidence、publication 与 UI 的 ownership map。
- [Delivery protocol](../delivery-protocol/README.zh.md) — 耐久 publication record 与 transition type。
- [Credential seam](../../credentials/credentials/README.zh.md) — 每次 operation 解析 credential reference。
- [Delivery Remote](../delivery-remote/README.zh.md) — Host configuration 与 browser-safe publication operation。
- [GitHub REST Issue endpoints](https://docs.github.com/en/rest/issues/issues) — 上游 Create/Get Issue behavior 与 token permission。

-----

<a id="model-experience"></a>
## 模型体验

间接影响，仅通过消费它的 Delivery Remote 或 UI；本库不注册 model tool、prompt、schema 或 result rendering。

#### KV Cache 影响

不会直接失效；Issue rendering 与 HTTP result 在本包内永远不会进入 model request prefix。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅支持 GitHub.com REST**——不支持 Enterprise host、alternate API root、GraphQL、proxy 与 custom trust policy。
- **不会自动提供 `confirm-not-created` proof**——在不确定的 create request 后，缺失 search result 不能证明不存在，而 create endpoint 不会预分配 Issue number；因此在未来出现 Host proof source 前，较低层的 Delivery transition 仍需要 human authorization。
- **完整 Issue body 上限为 64 KiB**——过大的已渲染需求会在 publication 前失败，不会被截断。
- **Repository mapping 留在 Host Consumer**——本库只消费 target lookup capability，不拥有 settings、discovery、RBAC 或 multi-host lease。
- **只创建 Issue**——创建时可以附带已配置 label；milestone、comment、Projects、PR creation、merge、close 与 bidirectional synchronization 均不属于此包。

<a id="dev-note"></a>
### 开发注记

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
