# Personal Delivery Case 与 GitHub 发布实施计划

[English](2026-08-30-delivery-case-github-publication.md) | 中文

**目标 / DoD：** Personal Delivery 拥有耐久 Case、需求修订、需求批准、执行、证据和人工验收；一个已批准且就绪的修订可以向已配置 GitHub 仓库发布一次，经现有 Queue/Git/Codex/verifier 链执行并由人验收，重启后仍能诚实恢复，且不暴露凭据或创建未受控的重复 Issue。

**架构：** 在保留 `ContractRevision`、`WorkPacket`、dispatch、evidence、verification 与 acceptance 归属的同时，向 Delivery protocol version 2 增加 `DeliveryCase`、`RequirementDecision` 与 `IssuePublication`。本地 Git 继续位于 `ctx.repoWorkspace` 后，Queue 执行继续位于 `delivery-task-queue` 后，GitHub 发布由 `delivery-remote` 消费的窄 Host-only library 承担；在出现第二个独立 Consumer 前，不增加通用 GitHub Service Definition。

**依赖：** 当前 checkout `master@6300ab8dbf7106c02e234ca2c8b19b93888ed052`；保留现有 `ui-delivery` WIP。真实 GitHub 纵切要求一个经用户批准的 canary repository，以及一个 token 只能在该选定仓库写 Issues 的 Host credential reference。执行者记录精确仓库并获得 canary 操作批准前，不发生外部 mutation。

**真实验收路径：** 在隔离 DSH home 与可丢弃本地 Git 仓库中创建并批准一个 Delivery Case，经 Host boundary 将其精确修订发布到批准的 GitHub canary repository，针对返回 Issue 验证持久化 `published` binding，经完整 Loader composition 执行并验证一个 Packet、记录人工 acceptance、重启，再证明 Case、publication、Packet、evidence、verdict 与 decision 仍可查询。Browser run 必须消费相同 Host records，不能使用 mock projection。

**广泛验证预算：** 每个 task 运行聚焦 Vitest 文件。Code freeze 后，Personal Delivery Loader acceptance suites、`pnpm run build`、`pnpm run test`、`pnpm run test:docs`、`pnpm run doc-sync`、`pnpm run lint` 与 `git diff --check` 各运行一次；本 checkout 的耗时未测量。只有相关 source、generated artifact、build input 或 environment 改变时才重跑广泛命令，并将既有失败与本 diff 分开。

## 全局约束

- 保留全部无关 WIP 与持久数据；不得 reset、clean、delete、overwrite、force-switch，也不得复用当前 Delivery v1 storage root 执行 destructive migration。
- Delivery 拥有 Case identity、requirement revision、readiness、requirement decision、publication binding、Packet identity 与 human acceptance。Queue 拥有 Work/Attempt lifecycle；Git 拥有 commit 与 worktree；evidence storage 拥有 bytes；GitHub 拥有已发布 Issue 与 PR facts。
- `DeliveryCase` 是产品锚点。本地 path、branch、Session、Queue Work、GitHub URL 或 Issue number 都只是 locator 或 projection，不是 Case identity。
- 保留 `ContractRevision`、`WorkPacket`、`DispatchBinding`、`CompletionClaim`、`VerificationVerdict`、`EvidenceRef` 与 `AcceptanceDecision` 语义，除非本计划明确命名 version-2 field change。
- Revision 必须 ready 且被显式批准，才能发布 Issue 或创建 Packet。Model-facing caller 可以 propose 或 revise；不能 approve、publish、dispatch、accept、waive、merge 或 resolve uncertain external side effect。
- Browser DTO 只携带 configured reference 与 bounded human input。GitHub token、actor authority、idempotency key、repository path 与 external-resolution authority 保持 Host-only。
- HTTP request 前持久化 publication intent 与到 `publishing` 的 transition。Request 可能已越过 side-effect boundary 后发生的 failure 进入 `unknown`；不得自动 retry 或报告为 published。
- GitHub import 保持为 optional secondary adapter。Primary product path 从 Delivery-owned Case 开始并向外 publish。
- 不增加通用 `ctx.github`、executor registry、project-management service、two-way free-form Issue synchronization、automatic PR/merge、GitHub Projects dependency、multi-repository Case、teams、RBAC、multi-host lease 或 quota-triggered launch。
- 中英文文档一起更新，重新记录每个已触及 pair，通过 owner regenerate catalog，不手工编辑 generated English output，并在同一 implementation PR 中更新 active Delivery Agent Note。

---

## 冻结的 Version-2 Contract

Contract task 拥有这些名称与 transition。后续 task 消费它们，不重新定义语义。

```ts ignore-check
type RequirementOrigin =
  | { kind: 'human'; actorId: string }
  | { kind: 'github-import'; repository: GitHubRepositoryRef; issueNumber: number; contentDigest: Sha256Digest }

interface DeliveryCase {
  schemaVersion: 2
  id: DeliveryCaseId
  repositoryId: RepositoryId
  headRevisionId: ContractRevisionId
  createdAt: string
  updatedAt: string
}

interface RequirementDecision {
  schemaVersion: 2
  id: RequirementDecisionId
  caseId: DeliveryCaseId
  revisionId: ContractRevisionId
  decision: 'approved' | 'rejected' | 'deferred'
  reason: string
  actor: { kind: 'human'; actorId: string }
  decisionNonce: string
  decidedAt: string
}

type IssuePublication = {
  schemaVersion: 2
  id: IssuePublicationId
  caseId: DeliveryCaseId
  revisionId: ContractRevisionId
  repository: GitHubRepositoryRef
  renderedDigest: Sha256Digest
  marker: string
  createdAt: string
  updatedAt: string
} & (
  | { phase: 'prepared'; issue: null; failure: null }
  | { phase: 'publishing'; issue: null; failure: null }
  | { phase: 'published'; issue: GitHubIssueRef; failure: null }
  | { phase: 'failed'; issue: null; failure: PublicationFailure & { sideEffect: 'not-started' } }
  | { phase: 'unknown'; issue: null; failure: PublicationFailure & { sideEffect: 'unknown' } }
)
```

`ContractRevision` 保持为 immutable requirement content，并增加 `origin: RequirementOrigin` 与便于人类阅读的 `title`（它是已移除 v1 `SourceRef.title` 的权威替代，供 Issue rendering、canary label 与 Case card 消费）；移除 GitHub-only `sourceRef` requirement。`WorkPacket.contractRevisionId` 保持不变。`DeliveryCase.headRevisionId` 通过 expected-head compare-and-set 前进，使 concurrent revision 不能静默产生同一 Case 的 branch。

Service operations 固定为：

```ts ignore-check
createCase(request: CreateDeliveryCaseRequest): Promise<{ case: DeliveryCase; revision: ContractRevision }>
reviseCase(request: ReviseDeliveryCaseRequest): Promise<{ case: DeliveryCase; revision: ContractRevision }>
recordRequirementDecision(request: RecordRequirementDecisionRequest): Promise<RequirementDecision>
createWorkPacket(request: CreateWorkPacketRequest): Promise<WorkPacket>
prepareIssuePublication(request: PrepareIssuePublicationRequest): Promise<IssuePublication>
markIssuePublicationStarted(publicationId: IssuePublicationId): Promise<IssuePublication & { phase: 'publishing' }>
completeIssuePublication(request: CompleteIssuePublicationRequest): Promise<IssuePublication & { phase: 'published' }>
failIssuePublication(request: FailIssuePublicationRequest): Promise<IssuePublication & { phase: 'failed' | 'unknown' }>
resolveIssuePublication(request: ResolveIssuePublicationRequest): Promise<IssuePublication>
```

`createCase()` 原子创建一个 Case 与 root revision。`reviseCase()` 要求 `expectedHeadRevisionId`，创建一个 child revision，并原子移动 head。每个 revision 最多一个 requirement decision；相同 revision 下互相冲突的 decision content fail closed。`createWorkPacket()` 与 `prepareIssuePublication()` 要求所选 revision 是命名 Case 的 revision、ready 且 approved。每个 revision 最多一个 IssuePublication：重复 `prepareIssuePublication()` 返回已有 record，不创建第二个；`failed` publication 是 terminal——重新 prepare 会让同一 record 回到 `prepared` 以便新 attempt——因此一个 revision 绝不会产生重复 Issue。

`resolveIssuePublication()` 由人授权，只支持：Host GET 验证精确 marker 与 rendered digest 后执行 `confirm-published`；或者执行 `confirm-not-created`，将 `unknown` 或 crash-stalled `publishing` publication 退回 `prepared`。`confirm-not-created` 要求把明确的 Host verification basis 与 resolution 一同记录——例如 POST error response 或 Host GET 对预期 Issue location 返回 404 等权威 HTTP response，能够证明未创建 Issue——operator impression 本身不能充当 basis。它绝不接受 browser-supplied Issue content 作为 proof，也不把 search result 中的缺失当成 Issue 不存在的证明。

---

### Task 1：冻结 Delivery protocol version 2

**依赖：** 无。

**Ownership：**
- 修改：`packages/delivery/delivery-protocol/src/brand.ts`、`src/types.ts`、`src/schemas.ts`、`src/semantics.ts`、`src/canonical.ts`、`src/index.ts`。
- 修改：`packages/delivery/delivery-protocol/fixtures/valid.json`、`fixtures/invalid.json`。
- 测试：`packages/delivery/delivery-protocol/tests/fixtures.spec.ts`、`tests/semantics.spec.ts`、`tests/canonical.spec.ts`、`tests/public-api.typecheck.ts`、`tests/github-source.spec.ts`。
- 修改：`packages/delivery/delivery-protocol/README.md`、`README.zh.md`、`README.i18n.yaml`。

**Interfaces：**
- 消费：现有 version-1 branded-id、strict-schema、canonical-digest、readiness、verification-plan、Packet、dispatch、verdict、evidence 与 acceptance conventions。
- 产出：上述冻结的 version-2 types 与 schemas，供全部后续 task 消费。

**验证：**
- 变更类型：高风险 durable public contract。
- Baseline 或 RED：增加 Case identity、expected-head revision、human-only requirement decision、publication discriminant 与移除 mandatory GitHub source 的 compile/runtime tests；确认它们在 version 1 上失败。
- 完成：`& .\node_modules\.bin\vitest.CMD run packages/delivery/delivery-protocol/tests` 与 `pnpm run doc-typecheck:contracts-ready` 对新 contract 通过。
- 升级条件：如果一个未变的 Queue intent/result、verification、evidence 或 acceptance invariant 需要 semantic redesign 而非 schema-version update，则停止。

**验收贡献：** 建立一个独立于 GitHub、本地 path、Session 与 Queue Work 的 portable Delivery Case identity。

1. 将 `DeliverySchemaVersion` 设为 `2`；增加三个新 branded ids、`RequirementOrigin`、`DeliveryCase`、`RequirementDecision`、`GitHubIssueRef`、`PublicationFailure` 与 `IssuePublication`。
2. 用 `origin` 替换 `ContractRevision` 上的 GitHub-only `SourceRef` field，同时保留全部 requirement、readiness、base、plan 与 Packet semantics。
3. 为每个 publication phase、unknown-side-effect classification、expected-head identity 与 human decision combination 增加严格 valid/invalid fixtures。
4. GitHub URL parsing helpers 只留给 optional importer 与 publisher response validation；从 generic requirement semantics 中移除 GitHub ownership。
5. 更新 protocol README pair，并仅在 source 与 tests 一致后记录。

### Task 2：实现 Case、decision 与 publication persistence

**依赖：** Task 1。

**Ownership：**
- 修改：`packages/delivery/delivery/src/types.ts`、`src/index.ts`。
- 修改：`packages/delivery/delivery-local/src/spec.ts`、`src/index.ts`。
- 修改：`packages/delivery/delivery-testkit/src/fake-delivery.ts`、`src/fixtures.ts`、`src/index.ts`。
- 测试：`packages/delivery/delivery-local/tests/persistence.spec.ts`、`tests/invariant.spec.ts`、`packages/delivery/delivery-testkit/tests/contracts.spec.ts`。
- 修改：`packages/delivery/delivery/`、`delivery-local/` 与 `delivery-testkit/` 下的 README triplets。

**Interfaces：**
- 消费：Task 1 schemas 与现有 Storage Domain atomic-write/idempotency contracts。
- 产出：供后续 importer、publisher、Remote、Queue 与 UI task 使用的 provider-independent `ctx.delivery` operations 和匹配 local/fake Providers。

**验证：**
- 变更类型：高风险 persistence、authorization、idempotency 与 transition boundary。
- Baseline 或 RED：增加 atomic Case+root creation、expected-head CAS、duplicate request、conflicting decision、approval-required Packet/publication、publication transition、restart reconstruction 与 v1-domain rejection without mutation tests。
- 完成：聚焦 local/testkit suites 通过，且重建 provider 以 stable order 返回 byte-equivalent Cases、revisions、decisions 与 publications。
- 升级条件：如果 Storage Domain 不能在打开 separate canary root 或 mutation 前失败时保留现有 v1 data，则停止；不要在本 task 引入 in-place migrator。

**验收贡献：** 在任何 external effect 存在前，使新锚点和全部 authority decision 耐久且 restart-safe。

1. 在 public Delivery boundary 用 `createCase()` 与 `reviseCase()` 替换 `adoptContractRevision()`；保留 `getContractRevision()` 供 Packet、runner、verifier 与 acceptance consumer 使用。
2. 为新 record families 增加 `getCase()`、`getRequirementDecision()`、`getIssuePublication()` 与 detached snapshot arrays。
3. 增加 Case、requirement-decision 与 Issue-publication tables；升级 local domain format，并在 write 前拒绝 v1。保留旧 root，version 2 acceptance 使用 separate canary DSH home。
4. 通过现有 local Provider write boundary 串行化 Case-head 与 publication transitions；commit 前用 Task 1 schemas 验证完整 candidate object。
5. 在 fake Provider 实现一致的 authority 与 failure behavior，然后更新全部 shared fixtures 与 README pairs。

### Task 3：迁移现有 Delivery consumers，同时不改变 execution meaning

**依赖：** Tasks 1-2。

**Ownership：**
- 修改：`packages/delivery/delivery-github-intake/src/index.ts`、`src/work-brief.ts` 与 focused tests。
- 修改：仅在 version-2 construction 要求时，更新 `delivery-task-queue`、`delivery-runner-codex`、`delivery-verifier`、`delivery-remote`、`delivery-evidence-local` 与 `repo-workspace-git-local` tests 中的 Delivery fixtures 与 direct Contract literals。
- 测试：六个 named Consumers 的 package-local suites 加 `packages/bundle/personal-delivery/tests/acceptance-safety.spec.ts`。
- 修改：`packages/delivery/delivery-github-intake/README.md`、`README.zh.md`、`README.i18n.yaml`。

**Interfaces：**
- 消费：Task 2 Case operations 与未变的 WorkPacket/dispatch/claim/verdict/evidence/acceptance semantics。
- 产出：可编译、behavior-preserving 的 execution chain，以及创建或修订 Case 但绝不批准它的 optional GitHub importer。

**验证：**
- 变更类型：Caller migration 加 behavior-preserving refactor。
- Baseline 或 RED：迁移前运行现有聚焦 Queue bridge、runner、verifier、Remote、repository、evidence 与 safety tests；记录全部 pre-existing failures。
- 完成：迁移后相同 suites 通过，且导入一个 valid Issue 产生未批准 Case revision；在存在 human decision 前不能创建 Packet。
- 升级条件：如果一个 consumer 在 execution time 需要 GitHub-specific requirement fields，则停止；将该 dependency 迁到 importer 或 publisher，不能拓宽 generic protocol。

**验收贡献：** 证明可靠 execution half 在 product-anchor 改变后保持不变。

1. 将当前 GitHub importer 从 direct Contract adoption 改为 Case creation/revision，并使用 `origin.kind='github-import'`；严格 Work Brief parsing 作为 optional path 保留，不作为 primary UI。
2. 移除 explicit import 与 requirement approval 之间的自动等价。
3. 将 direct fixtures 更新到 version 2 与 Case-owned revision lookup；除 protocol-version input 外，不改变 Queue intent digests。
4. 重跑 cancellation、unknown outcome、missing checkpoint、failed verification、corrupt evidence、distinct worktrees 与 human acceptance denial safety scenarios。

### Task 4：增加 Host-only GitHub Issue publisher

**依赖：** Tasks 1-3。

**Ownership：**
- 创建：`packages/delivery/delivery-github-publisher/package.json`、`tsconfig.json`、`src/index.ts`、`src/render.ts`、`src/failures.ts`、`src/invariant.ts`。
- 创建：`packages/delivery/delivery-github-publisher/tests/render.spec.ts`、`tests/publication.spec.ts`、`tests/invariant.spec.ts`。
- 创建：`packages/delivery/delivery-github-publisher/README.md`、`README.zh.md`、`README.i18n.yaml`。
- 修改：`packages/delivery/delivery-remote/package.json`、`src/index.ts`、`src/types.ts`、`src/failures.ts`、`tests/operations.spec.ts`、`tests/typert-wire.spec.ts`。

**Interfaces：**
- 消费：Task 2 publication transitions、`ctx.credentials`、Host `fetch`、configured `repositoryId -> GitHubRepositoryRef + credentialRef` 与现有 Typert cancellation boundary。
- 产出：`publishIssue()` 与 `resolvePublication()` Host operations 加 browser-safe publication views；不增加 Cordis service key。

**验证：**
- 变更类型：高风险 credential、authorization、external side-effect 与 recovery boundary。
- Baseline 或 RED：Fake-fetch tests 覆盖 rendered body、deterministic marker/digest、permission failure before start、I/O 前 `publishing`、201 response validation、known non-started failure、transport uncertainty、start 前后 cancellation、duplicate call、restart reconciliation 与 operator resolution。
- 完成：Publisher/Remote focused tests 通过；logs、errors、persisted records 与 wire snapshots 不含 token 或 credential value。
- 升级条件：如果本 task 完成前出现需要 publication 的第二个独立 caller，则停止；提升 provider-neutral Issue Publisher Service Definition，不能再增加 direct import。

**验收贡献：** 增加第一条 Delivery-to-GitHub functional projection，并诚实恢复 side effect。

1. 从精确 approved revision 渲染 human-readable Issue，包含 Outcome、Context、Scope、Acceptance、Open Decisions、References、Delivery Case/revision identifiers，以及一个包含 publication id 与 rendered digest 的 bounded HTML marker。
2. 在 `markIssuePublicationStarted()` 前解析 credential；missing target、credential、approval、readiness 或 repository mapping 必须在越过 side-effect boundary 前拒绝。
3. 持久化 `publishing`，发出一次 bounded GitHub REST request，根据 201 response 验证 owner/name/number/URL/body marker，然后 commit `published`。
4. Request start 后的 failure 归类为 `unknown`，除非 authoritative HTTP response 证明未创建 Issue。不得自动发出第二次 POST。
5. `confirm-published` 通过 fresh Host GET 和 exact marker/digest validation 解析。`confirm-not-created` 需要 explicit human authority。
6. Remote 只暴露 publication availability、phase、safe failure category 与 published Issue coordinates。

### Task 5：证明最早真实 GitHub publication 纵切

**依赖：** Task 4 与一次 canary mutation 的显式批准。

**Ownership：**
- 修改：`packages/bundle/personal-delivery/tests/acceptance-primary.spec.ts`，增加单独选择且默认 skipped 的 real-provider lane。
- 证据：Execution log 记录 canary repository、Delivery Case id、revision id、publication id、GitHub Issue URL、rendered digest 与 persisted phase，不记录 credentials。

**Interfaces：**
- 消费：Task 4 Host publisher 与 user-approved credential reference；该凭据只在 canary repository 拥有 Issues write。
- 产出：后续 UI 与 bundle work 可以信任的真实 external 与 persisted evidence。

**验证：**
- 变更类型：真实 external boundary acceptance。
- Baseline 或 RED：Read-only GET 验证 repository access 与 target identity，`ctx.credentials.describe()` 只证明 reference 已配置且不打印 token；write permission 在 approved canary POST 前保持 unverified，readiness 阶段不创建 Issue。
- 完成：一个 approved Case 精确创建一个 real Issue，返回 body 含 exact marker/digest，Delivery 存储 `published`，process reconstruction 返回同一 binding。重复 logical call 返回既有 Issue，不再 POST。
- 升级条件：Repository approval、token scope、network access 或 cleanup policy 缺失时，在 mutation 前停止；fake success 不能替代此 acceptance fact。

**验收贡献：** 在 UI expansion 与 final code freeze 前建立最早真实 side effect。

1. 使用 disposable Case title 与 documented canary label；不得以 production Issue backlog 为目标。
2. 捕获 authoritative Delivery 与 GitHub identities，重启 Host composition，再次验证 binding。
3. 只有 user-approved cleanup policy 允许时才关闭 canary Issue；关闭属于 cleanup，不是 Delivery acceptance evidence。

### Task 6：用 Case-centered workflow 替换 import-first workbench

**依赖：** Tasks 2、4 与 5。

**Ownership：**
- 修改：`packages/delivery/delivery-remote/src/projection.ts`、`src/types.ts`、`src/index.ts`、`tests/projection.spec.ts`、`tests/operations.spec.ts`、`tests/typert-wire.spec.ts`。
- 修改：`packages/client/ui-delivery/src/client/DeliveryWorkbench.tsx`、`DeliveryWorkbench.module.css`、`contract.ts`、`runtime-controller.ts`、`locales.ts`。
- 修改：`packages/client/ui-delivery/tests/workbench.client.spec.tsx`、`runtime-controller.client.spec.ts`、`apply.client.spec.ts`、`fixtures.client.ts`。
- 修改：`delivery-remote` 与 `client/ui-delivery` 下的 README triplets，不覆盖无关 current-checkout WIP。

**Interfaces：**
- 消费：Task 2 Case/decision views、Task 4 publication operations 与现有 Packet/run/verify/evidence/acceptance operations。
- 产出：以 Delivery Case 为 primary card、actions 遵循 requirement authority 的单一 browser workbench。

**验证：**
- 变更类型：产品可见 Host/Client contract 与 browser workflow。
- Baseline 或 RED：为 draft Case、revision readiness、approval、publication availability、publication unknown resolution、Packet creation 与现有 evidence/acceptance flow 增加 component/controller tests；删除要求 raw Issue URL 或 repositoryId input 的 assertions。
- 完成：聚焦 Remote/UI suites 通过；随后在消费 Task 5 Host records 的真实 browser 中创建第二个 local-only Case，批准并发布它，显示返回 Issue，并在不手工输入 internal ids 的情况下继续完成一次 real Packet evidence review。
- 升级条件：如果 current WIP 改变 slot/observable contract 并与本 task 冲突，则停止；显式协调 ownership，不能覆盖它。

**验收贡献：** 交付用户可见的 Case → approve → publish → execute → verify → accept 路径。

1. 将 Case 投影为 derived phases：`shaping`、`ready`、`running`、`review`、`blocked` 与 `accepted`；publication phase 保持可见，但与 execution lane 分离。
2. 用 Case creation/revision editing 替换 `ImportForm`。在 Host 绑定单个 configured repository 并显示可读 target；绝不让 browser 提供 `repositoryId`。
3. 将 readiness reasons 与 approval 显示为独立 actions。只有 approved、ready 的 head revision 且 Host target 已配置时，才启用 GitHub publication。
4. Existing-Issue optional import 保留在 secondary action 后，随后仍需 human approval。
5. 为每个 publication phase 提供 browser presentation 与 action：`prepared` 显示 publish entry，`publishing` 显示带 cancel availability 的 busy indicator，`failed` 显示 safe failure category 与 re-prepare path，`published` 显示 Issue link，`unknown` 显示 attention state 与 resolution action。使用 keyboard 与 focus behavior 渲染 inline field errors、Packet evidence 与 acceptance decision。
6. Full build 刷新 Client artifacts 后，从真实 PR server 与 model flow 录制 GIF。

### Task 7：集成 bundle、documentation、generated artifacts 与 final evidence

**依赖：** Tasks 1-6。

**Ownership：**
- 修改：`packages/bundle/personal-delivery/package.json`、`cordis.patch.yml`、`tests/acceptance-primary.spec.ts`、`tests/acceptance-safety.spec.ts`、`tests/scaffold.spec.ts`、README triplet。
- 修改：`packages/delivery/README.md`、`README.zh.md`、`README.i18n.yaml`、`docs/subsystems/delivery.md`、`delivery.zh.md`、`delivery.i18n.yaml`。
- 修改或移动：在真实验收后，按 implemented-note lifecycle 处理 `.agents/notes/proposed/architecture/2026-08-29-personal-delivery-above-queue.{md,zh.md,i18n.yaml}`。
- 修改：只有 executed generator 或 package topology 要求时，才改 `packages/README` pair、required package-group maps、TypeScript aggregate references、`knip.json`、root `package.json`、`pnpm-lock.yaml`、generated catalogs/graphs 与 `FORK-DIVERGENCE.md`。

**Interfaces：**
- 消费：全部 earlier tasks 与现有 base/Web bundle layers。
- 产出：一个 supported Personal Delivery composition 与 authoritative current documentation/evidence set。

**验证：**
- 变更类型：Cross-package integration、generated artifacts、docs、build 与 real product closure。
- Baseline 或 RED：Loader acceptance 首先断言旧 composition 不存在 Case/approval/publication records，且 version-1 storage 被拒绝而不 mutation。
- 完成：Header 中完整 real acceptance path 通过；聚焦与 broad commands 在预算内运行；全部 generated freshness 与 bilingual pairing checks 为 green；final diff 不含 credential、canary token、private evidence bytes 或 unrelated WIP。
- 升级条件：如果 real GitHub publication、browser interaction、restart persistence 或现有 Queue safety evidence 不可用，则停止；不得以 docs 或 mocks 替代缺失 boundary。

**验收贡献：** 在一个 packaged、restart-stable、user-visible composition 中证明全部 DoD items。

1. 配置 optional GitHub target mappings，但不在 shipped defaults 放置 credential value。保留单一 local repository 与 Attempt-owned worktree defaults。
2. 将 primary Loader acceptance 从 Case creation 扩展到 human acceptance 与 restart；保留全部既有 safety scenarios。
3. 更新 Delivery subsystem、package maps、package contracts、bundle limitations 与 Agent Note，使其陈述当前 implemented ownership，而非 planned behavior。
4. 通过 owner regenerate 每个受影响 catalog 与 graph。重新记录全部 bilingual pairs。
5. 运行一次 full build，使 Host contract 与 dynamic Client bundles 一致；然后执行 final focused/broad verification budget，并检查真实 browser/GitHub evidence。

---

## 需求到 Task 的可追踪性

| Requirement | Owning task | Completion evidence |
| --- | --- | --- |
| Delivery-owned stable Case 与 immutable revisions | 1-2 | Protocol 与 reconstructed-provider tests |
| Human-only requirement approval | 1-2 | Decision/authorization negative tests |
| 保留既有 Queue/Git/evidence/verifier chain | 3 | 变更前后相同 focused safety suites |
| Optional Delivery-to-GitHub publication | 4 | Publisher/Remote state-machine tests |
| Real GitHub side effect 与 restart binding | 5 | Canary Issue identity 加 persisted publication |
| Case-centered browser flow | 6 | Real browser path 与 GIF |
| Supported bundle 与 current docs | 7 | Loader E2E、full build、docs/generated gates |

## 停止条件

- 无法在不创建新的 versioned identity 的情况下，使 revision 同时 immutable 且可纠正。
- GitHub 无法在显式批准下提供 canary repository 与 least-privilege credential。
- Publisher 无法区分 known pre-effect failure 与 uncertain post-start outcome。
- 启动 version 2 需要删除或改写现有 Delivery v1 data。
- Case model 要求 Queue、Session、GitHub 或 UI 成为其 persistence authority。
- Browser 或 model-facing request 必须携带 credential、actor authority、repository path、idempotency key、verdict 或 acceptance proof。
- Final build 不能证明 Host/Client contract，且真实 browser 仍消费 stale generated artifacts。

## 最终复核清单

- 每个 Case revision、requirement decision、publication、Packet、dispatch、verdict、evidence reference 与 acceptance decision 都有唯一 authority 和 durable identity。
- 每个 external mutation 都有 persisted intent、start boundary、bounded output、truthful failure classification 与 explicit unknown resolution。
- 每个 model/browser operation 都窄于其 Host counterpart，并有 negative authorization coverage。
- 第一条 real GitHub slice 位于 UI expansion 与 final code freeze 之前。
- 当前 `ui-delivery` WIP 被保留并显式协调。
- Broad checks 在 freeze 时运行一次，除非新 evidence 证明需要重跑。
- 没有 deferred feature 藏在 placeholder 或 invented compatibility shim 后。

## Deferred / Open Questions

### 来自 2026-08-30 review

- **Task 7 tool 不服务于已陈述目标**——在 implementation start 时已经解决：proposal tool 移出本轮，version-2 contract 移除 `dsh` origin branch（只保留 human 与 github-import），最终 integration task 重新编号为 Task 7，且只依赖 Tasks 1-6。
