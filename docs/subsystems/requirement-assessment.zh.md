# Requirement Assessment

[English](requirement-assessment.md) | 中文

## Ownership

[requirement-assessment 包组](../../packages/requirement-assessment/README.zh.md)拥有不可变投资评估、固定输入与请求回执。Planning 保留 Plan / Focus 状态，执行授权仍由现有 owner 持有。

## Contracts

[domain schema](../../packages/requirement-assessment/requirement-assessment/src/schema.ts)验证维度、反事实测试、分配类别、路线，以及基线与输入一致性。可信 Host access 提供 actor 与 workspace identity，浏览器和模型数据不能产生授权。

本地 provider 拥有有界的原子记录与排他文件系统占用。已完成请求重放其不可变结果。持久 pending 请求在模型消耗不确定后不自动重试，需要用户显式开始新请求。

review runner 在通过现有 LLM runtime 进行一次有界调用前捕获 subject 输入。Candidate subject 指定精确 owner revision 和 SHA-256 内容摘要，要求可信 owner source，且不能携带 Planning revision。runner 不提供可执行工具，在持久化前验证输出。Remote 校验 Workspace 成员资格；它没有 live Candidate caller scope，因此 Candidate freshness 保持 unknown。Initiative 负责精确 Candidate freshness，不修改 Planning。

## Consumer integration

可选[客户端 UI](../../packages/client/ui-requirement-assessment/README.zh.md)使用生成的 assessment Remote 及 Planning 拥有的 subject-action slot。[WP1 规格](../specs/2026-10-01-requirement-investment-review-wp1.md)定义范围与真实案例验收。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxrequirementassessment--requirementassessmentservice-abstract-seam"></a>

### `ctx.requirementAssessment` — `RequirementAssessmentService` (abstract seam)

Assessment owner; no Planning mutations or execution authority are part of this service.

```ts cordis-catalog
/**
 * Reserve a model invocation durably; unresolved reservations forbid automatic repeated billing.
 * @param access - Trusted Workspace and actor capability, rechecked before publication.
 * @param request - Request id and digest binding the exact evaluator input.
 * @param signal - Caller cancellation, checked before publication.
 * @returns Acquired, pending, or completed reservation with its immutable original result.
 */
abstract reserve(access: AssessmentAccess, request: AssessmentRequestIdentity, signal?: AbortSignal): Promise<AssessmentReservation>

/**
 * Persist one complete review atomically; identical request identities return their immutable original.
 * @param access - Trusted Workspace and actor capability.
 * @param input - Schema-valid immutable review and request identity.
 * @param signal - Caller cancellation, checked before publication.
 * @returns The committed Assessment; conflicting request digests reject.
 */
abstract create(access: AssessmentAccess, input: AssessmentCreateInput, signal?: AbortSignal): Promise<RequirementAssessment>

/**
 * Read detached bounded Workspace history, rechecking the trusted caller's current authority.
 * @param access - Trusted Workspace and actor capability.
 * @param signal - Caller cancellation.
 * @returns The authorized Workspace's immutable Assessment history.
 */
abstract snapshot(access: AssessmentAccess, signal?: AbortSignal): Promise<AssessmentSnapshot>

/**
 * Read one immutable result inside the authorized Workspace; foreign ids are never resolved.
 * @param access - Trusted Workspace and actor capability.
 * @param id - Assessment identity within this Workspace.
 * @param signal - Caller cancellation.
 * @returns The detached Assessment; missing or foreign ids reject as not-found.
 */
abstract get(access: AssessmentAccess, id: string, signal?: AbortSignal): Promise<RequirementAssessment>

/**
 * Recover a committed request before calling the evaluator; conflicting request digests reject.
 * @param access - Trusted Workspace and actor capability.
 * @param requestId - Durable request identity.
 * @param requestDigest - Exact evaluator input digest.
 * @param signal - Caller cancellation.
 * @returns The immutable original when committed, otherwise undefined.
 */
abstract replay( access: AssessmentAccess, requestId: string, requestDigest: string, signal?: AbortSignal, ): Promise<RequirementAssessment | undefined>
```

Source: [`packages/requirement-assessment/requirement-assessment/src/index.ts`](../../packages/requirement-assessment/requirement-assessment/src/index.ts)

<a id="ctxrequirementassessmentremote--requirementassessmentremote"></a>

### `ctx.requirementAssessmentRemote` — `RequirementAssessmentRemote`

Read-only Planning projection and trusted evaluation entry point.

```ts cordis-catalog
/**
 * List immutable assessments and live baseline status within the selected registered workspace.
 * @param raw - Selected workspace, checked against Host registration.
 * @param signal - Browser request lifetime.
 * @returns Immutable history projected against one current authorized Planning snapshot.
 */
@Remote('list') async list(raw: AssessmentListInput, signal: AbortSignal): Promise<AssessmentView[]>

/**
 * Resolve only an assessment owned by the selected registered workspace.
 * @param raw - Workspace and assessment identities; foreign ids never resolve.
 * @param signal - Browser request lifetime.
 * @returns The assessment and read-time baseline drift.
 */
@Remote('get') async get(raw: AssessmentGetInput, signal: AbortSignal): Promise<AssessmentView>

/**
 * Run one explicitly requested quick review; routes never execute downstream actions.
 * @param raw - Bounded user input without actor, baseline or evidence provenance authority.
 * @param signal - Browser lifetime propagated through capture, evaluation and persistence.
 * @returns Completed assessment with current drift; rejected attempts do not create results.
 */
@Remote('review') async review(raw: AssessmentReviewInput, signal: AbortSignal): Promise<AssessmentView>
```

Source: [`packages/requirement-assessment/requirement-assessment-remote/src/index.ts`](../../packages/requirement-assessment/requirement-assessment-remote/src/index.ts)

<a id="ctxrequirementassessmentreview--requirementassessmentreview"></a>

### `ctx.requirementAssessmentReview` — `RequirementAssessmentReview`

Fixed-context, bounded, single-call evaluator using the configured LLM runtime.

```ts cordis-catalog
/**
 * Deduplicate requests before spending model tokens.
 * @param access - Trusted Host workspace and actor capability, reauthorized before work and commit.
 * @param raw - Strict user request without provenance or authority fields.
 * @param signal - Caller lifetime; cancellation leaves a spent reservation unresolved.
 * @param candidateSource - Trusted owner snapshot for a Candidate subject; never browser/model input.
 * @returns The immutable completed assessment, including a replayed original for the same request.
 */
async review( access: AssessmentAccess, raw: QuickReviewInput, signal?: AbortSignal, candidateSource?: CandidateReviewSource, ): Promise<RequirementAssessment>
```

Source: [`packages/requirement-assessment/requirement-assessment-review/src/index.ts`](../../packages/requirement-assessment/requirement-assessment-review/src/index.ts)
<!-- END GENERATED cordis-surface -->
