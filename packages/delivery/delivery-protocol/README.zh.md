# @deepseek-ai/dsh-delivery-protocol

[English](README.md) | 中文

为[个人交付](../../../docs/subsystems/delivery.zh.md)提供不依赖 Queue 的持久记录、严格运行时 Schema 与 canonical identity。本包冻结 Delivery 持久化、Git 工作区所有权、证据存储、Queue bridge、验证、GitHub intake 和 UI 投影共享的数据。它不注册 Queue `WorkKind`，不发布 executor service，不持久化工作流状态，也不执行 I/O。

## 公共契约

包根导出下列 TypeScript 声明及严格 Zod Schema：

- `SourceRef`、canonical GitHub Issue URL helper、`ContractRevision` 及派生函数 `contractReadiness()`；
- `VerificationCheck`、`VerificationPlan` 与 `WorkPacket`；
- `VerificationPlanDocument`、`parseVerificationPlanDocument()` 与 `resolveVerificationPlan()`；
- `DispatchBinding`、`CompletionClaim` 与 `ResumeCapsuleContent`；
- `EvidenceRef`、`VerificationVerdict` 与 `AcceptanceDecision`；
- `CodeChangeIntent`、`ResolvedCodeChange` 与 `CodeChangeOutput`；
- `CodeVerifyIntent`、`ResolvedCodeVerify` 与 `CodeVerifyOutput`。

两个 Queue kind 名称冻结为 `CODE_CHANGE_KIND`（`code.change@1`）和 `CODE_VERIFY_KIND`（`code.verify@1`）。本包刻意不导出 Queue declaration-merging augmentation，也不导出 Prepared 或 live executor 类型；这些运行时职责归 Delivery/Queue bridge 所有。

每个持久对象都有 `schemaVersion: 1`；Schema 拒绝未知属性，且不应用默认值。不透明 id 必须非空白。时间戳必须是以 `Z` 结尾的 RFC 3339 UTC instant。Git commit 与 blob id 必须是完整的小写 40 位十六进制 SHA-1 或 64 位十六进制 SHA-256 object id。内容摘要使用小写 `sha256:<64 hex>` 形式。

GitHub `SourceRef` 只接受精确的 `https://github.com/{owner}/{repository}/issues/{issueNumber}` 形式，并将该 URL 绑定到自身 repository owner/name 与正 safe-integer Issue number。Schema 拒绝 credential、端口、其他 host 或 protocol、query、fragment、尾随斜杠、编码后的坐标及坐标不一致。`canonicalGitHubIssueUrl()`、`parseCanonicalGitHubIssueUrl()` 与 owner/name predicate 向 intake adapter 导出同一 grammar，无需再实现一套 URL parser。

`contractReadiness()` 要求 outcome、已配置 repository、非空 scope、acceptance clause、base-selection rule、verification source，并且没有 open decision。它只是派生 projection，绝不是可写 Contract status。

```text
import {
  contractReadiness,
  contractRevisionSchema,
  workPacketSchema,
} from '@deepseek-ai/dsh-delivery-protocol'

const contract = contractRevisionSchema.parse(decodedContract)
if (!contractReadiness(contract).ready) throw new Error('Contract is not ready')

const packet = workPacketSchema.parse(decodedPacket)
```

## Canonical identity

`canonicalJson()` 只接受普通 JSON-safe 值。它递归排序对象键，并拒绝循环、稀疏数组、accessor、隐藏键或 symbol 键、非有限数值、类实例及不支持的 primitive。其算法有意与 Queue canonical JSON 保持逐字节兼容；parity 测试防止这个运行时独立的复制实现发生漂移。

本包还导出：

- 用于 canonical JSON 的 `canonicalDigest()`；
- 对精确 Issue title/body 快照求摘要的 `sourceRefContentDigest()`；
- 用于命令 identity 的 `verificationCheckDigest()`；
- 对 resolved checks 及 provenance 求摘要的 `verificationPlanDigest()`；
- 对 Packet 语义内容求摘要的 `workPacketDigest()`，不含生成的 id、digest 与创建时间；
- 用于不可变证据字节的 `evidenceBytesDigest()` 与 `evidenceBytesMatch()`。

`sourceRefSchema`、`verificationPlanSchema` 与 `workPacketSchema` 会在解析时校验其自含摘要。消费方必须使用上述导出函数计算这些值，不得维护另一套 canonicalizer。

## 路径与固定命令

`RepositoryRelativePath()` 拒绝绝对路径、Windows drive path、反斜杠、NUL、空 segment、`.` segment 和 `..` traversal。`repositoryPathMatchesRule()` 规定 `exact` 只匹配一个路径，而 `subtree` 同时包含根路径自身及所有以斜杠分隔的后代。`changedPathBoundaryFindings()` 把空 allowlist 解释为不限制正向路径，先应用 forbidden rule，并且每个不重复 changed path 最多产生一条 finding。Packet 必须至少包含一条 allowed 或 forbidden rule，不能悄悄丢弃路径边界。

验证检查可把 `.` 或 normalized repository-relative path 用作明确的工作目录。每条命令都是非空 argv，并带正数 timeout、声明的 severity，以及非空且不重复的预期 exit-code 集合。协议中没有 shell-string 字段；schema 也拒绝 `sh -c`、`bash -lc`、`pwsh -Command`、`cmd /C` 等 command-string 模式，包括通过 `env` 包装的形式。

词法路径校验不能证明物理 containment。verifier 在启动 check 前必须使用 `lstat`/`realpath` 证明解析后的物理 cwd 仍位于 active lease root 内，并拒绝任何逃逸该 root 的 symlink traversal。

`parseVerificationPlanDocument()` 是 Contract-owned Git blob 的唯一可执行 parser。它会拒绝 UTF-8 BOM、无效 UTF-8 或 JSON、未知 document 字段、错误 format、空 check 集合及重复 check id。`resolveVerificationPlan()` 随后为任一种 provenance 构造严格 plan 与 canonical digest。Provider 与 edge adapter 复用这些函数，而不复制 test fake 的行为。

resolved Git-blob plan provenance 固定 base commit、仓库相对路径及完整 blob id。Contract-field provenance 固定精确 Contract revision 与字段。Packet 与 resolved verification schema 还要求这些 provenance 坐标分别匹配自身 base commit 或 Contract revision。Packet 携带 resolved checks、其 provenance 与 digest，因此 branch 内容无法悄悄改变实际执行的验证。

## 局部与跨对象语义

单条严格记录 Schema 强制执行该记录内部可见的全部事实。例如，`completed` claim 必须有 checkpoint commit 和至少一个 evidence id；其他 disposition 必须有各自的 blocker、question 或 scope delta。每条 verification check result 都必须引用 evidence，Verdict manifest 也必须为每个被引用 id 提供且仅提供一条 integrity finding。局部 `passed` verdict 还必须满足 descendant ancestry、required check 均符合预期、没有 path finding、required evidence finding 完整，且不存在待审 reason。

需要另一权威对象的关系通过显式函数表达，而不是隐藏在 Zod lookup 中：

- `completionClaimEvidenceFindings()` 检查 completed claim 是否引用来自其 Queue Work 与 Attempt 的匹配 Git evidence；
- `changedPathBoundaryFindings()` 按冻结的 Packet 路径语义派生 forbidden 与 outside-allowlist finding；
- `verificationVerdictPlanFindings()` 把每条 result 绑定到精确 trusted check 与 plan digest；
- `acceptanceDecisionFindings()` 检查 verdict、Packet、target commit，并强制只有匹配的 passed verdict 才能 accepted。

这些函数返回 finding。所有服务决定是拒绝写入、投影 operator attention，还是请求人工 review；协议包不会发明生命周期状态。

## Golden fixture

[`fixtures/valid.json`](fixtures/valid.json) 是覆盖全部持久记录、严格 verification-plan document 及两组 WorkKind DTO 的稳定 V1 catalog。其 `fixtureIds` map 为每个可复用值提供稳定的点分隔 id，例如 `contract.ready`、`plan-document.git-blob`、`claim.completed` 和 `work-kind.verify-output`。[`fixtures/invalid.json`](fixtures/invalid.json) 保存稳定 case id，以及相对于该 catalog 的 JSON-Patch-like mutation。测试证明每个有效值都能通过 JSON round trip，且每个无效 mutation 都会被拒绝。消费方依赖协议 shape 时，应引用相应 fixture case id。

fixture catalog 只包含虚假的 repository、Queue、evidence 和 human id，不包含 Session、process handle、host object、secret 或可变 host path。

## 模型体验

### 持久值契约

#### 模型看到的内容

无。`@deepseek-ai/dsh-delivery-protocol` 不贡献 prompt、tool、command 或模型可见 diagnostic。后续获得授权的消费方可以展示这些记录的投影。

#### Token 影响

无。解析、canonicalization 与语义检查都在模型上下文之外运行。

#### KV Cache 影响

无。本包不修改任何模型可见前缀。

## 已知限制与暂缓事项

- **MVP 仅支持 GitHub source**：`SourceRef` 冻结 `github` provider；webhook 同步与 write-back 不在 MVP 范围内。
- **仅限 MVP work kind**：协议命名 `code.change@1` 与 `code.verify@1`，但 Queue 注册及执行生命周期属于 bridge 包。
- **Schema 无法访问证据字节**：`EvidenceRef` 校验 metadata；evidence provider 必须取回不可变字节，并在证据可满足验证前调用 `evidenceBytesMatch()`。
- **Schema 不执行跨 store lookup**：ancestry、repository identity、Queue existence 与 human authority 需要各自所有服务。导出的跨对象 finding 只覆盖 caller 提供完整输入的关系。
- **没有 migration compatibility**：V1 Schema 拒绝所有其他 `schemaVersion`；未来版本需要显式 migration 与新 golden fixture，而不是宽松解析。
