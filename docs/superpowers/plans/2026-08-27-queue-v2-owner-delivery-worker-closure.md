# Queue v2 Durable Core, Owner Delivery, and Typed Adoption Implementation Plan

English | [中文](2026-08-27-queue-v2-owner-delivery-worker-closure.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Queue v2 from durable admission through recovery-safe execution, typed result collection, replay-safe owner delivery, one real restricted DSH worker, and one ten-image typed Batch without per-image Agent startup.

**Architecture:** `LocalTaskQueue` remains the sole owner of WorkItem, Batch, Attempt, Result, Receipt, Attention, Notification, scheduling, and Queue-root ownership. WorkKind bridges reuse Subprocess, ImageGeneration, Attachment, Agent inbox, Session persistence, and output-retention capabilities; generic Queue Consumers do not import a WorkKind. Automatic Goal continuation and multi-host Session ownership remain outside this plan.

**Tech Stack:** TypeScript, Cordis, Queue v2 ChangeSet JSONL, DSH Agent and Session events, `TextRetainer`, AttachmentStore, managed subprocesses, Vitest, Loader composition tests, ArkCLI Agent Plan, and the real `task-worker` and Web profiles on Windows.

**Dependencies:** The current checkout contains uncommitted Queue v2, image, operator UI, documentation, and unrelated work. Preserve all of it. The Queue v2 store uses manifest schema version `3`; no earlier-version decoder or compatibility shim is added. A real DSH worker requires an already configured model and credential path; a real image Batch requires an already configured ArkCLI Agent Plan image resource.

**Real Acceptance Path:** After deterministic durability and delivery tests pass, run one direct restricted worker, enqueue one real `agent.run@1` WorkItem from a live owner Session, explicitly collect its typed result, and prove Session flush precedes Notification acknowledgement. Then enqueue ten `image.generate@1` WorkItems as one Batch, prove Batch and resource concurrency limits, persist `ImageAttachmentRef` values, and prove no DSH worker process was started for prompt writing or image generation.

**Broad Verification Budget:** During Tasks 1-6 run only the named tests and static checks. After both real slices succeed and code freezes, run Queue, Agent inbox, Attachment/image, host composition, and Queue UI focused suites once; then run `pnpm run build:lib:host`, `pnpm run build:lib:client`, `pnpm run lint`, `pnpm run doc-sync`, and `git diff --check` once. Budget 25-40 minutes. Rerun a broad command only after changing a path named by its failure; compare unrelated failures with the initial dirty-checkout baseline and leave them untouched.

## Global Constraints

- Work in the current checkout; do not reset, clean, switch branches, delete Queue or Session data, stop unrelated processes, or absorb unrelated WIP.
- Read `docs/defensive-patterns.md` before changing recovery, subprocess, cancellation, or teardown behavior.
- Keep `ChangeSet` as the sole Queue append unit. A logical transition that requires sibling facts commits them together.
- Acquire Queue-root ownership before recovery and release it only after every admitted execution is durably terminal or unknown.
- Keep external discovery in `resolveAdmission()`, preparation without side effects in `prepare()`, and the side-effect boundary in synchronous `start()` returning `LiveAttempt`.
- Persist validated resource claims and retry policy at admission. Do not recompute deployment-sensitive claims when dispatching recovered work.
- Automatic retry requires `retriable: true`, `sideEffect: 'not-started'`, and remaining attempts.
- Unknown resolution supports only `confirm-failed` and `authorize-retry` in this plan. Do not expose reconcile or operator-confirmed success.
- Terminal owner messages contain trusted status and immutable ids only. Executor text, stderr, prompts, paths, and artifact bytes require an explicit result read.
- A Notification is acknowledged only after its stable message is a durable `user/message` and `ctx.sessions.flush(session)` succeeds.
- Queue core does not depend on Jobs, Goal, Workflow, Subagent, Schedule, Agent Teams, ImageGeneration, Attachment providers, or WorkKind-specific tools.
- Image output uses `ctx.attachments`; remove Queue-root artifact paths. Stop and request a product decision if real evidence proves byte-exact originals are required and Attachment normalization changes them.
- Prompt expertise runs once before image Batch admission. Do not start one DSH Agent per image to create prompts.
- Do not expose operator authority beyond the existing loopback-only Remote and trusted host command.
- Do not print, persist, or copy credential values. Readiness evidence may name only the credential or managed resource and whether it is available.
- Every task preserves one physical Markdown line per paragraph, updates both languages for paired docs, and records named translation pairs after the pair is reviewed.

## Frozen API and Record Changes

The design source is the implemented [Queue v2 ownership and reuse boundaries Agent Note](../../../.agents/notes/implemented/architecture/2026-08-27-queue-v2-reuse-boundaries.md). Implementation uses these exact public changes.

```ts ignore-check
export interface WorkItem<K extends WorkKind = WorkKind> {
  readonly id: WorkId
  readonly kind: K
  readonly title: string
  readonly intent: WorkInput<K>
  readonly intentDigest: string
  readonly resolved: ResolvedWork<K>
  readonly policy: WorkPolicy
  readonly resources: readonly ResourceClaim[]
  readonly tags: readonly string[]
  readonly batchId: BatchId | null
  readonly ownerSessionId: string | null
  readonly createdAt: string
}

export interface BatchItem<K extends WorkKind> {
  readonly title: string
  readonly input: WorkInput<K>
  readonly tags?: readonly string[]
}

export interface BatchRequest<K extends WorkKind> {
  readonly kind: K
  readonly items: readonly BatchItem<K>[]
  readonly sharedPayload: JsonValue
  readonly idempotencyKey: string
  readonly maxParallel: number
}

export interface WorkHandler<K extends WorkKind> {
  readonly kind: K
  resolveAdmission(input: WorkInput<K>, context: AdmissionContext): Promise<ResolvedWork<K>>
  resources(resolved: ResolvedWork<K>): readonly ResourceClaim[]
  policy(resolved: ResolvedWork<K>): WorkPolicy
  prepare(resolved: ResolvedWork<K>, context: PrepareContext): Promise<PreparedWork<K>>
  start(prepared: PreparedWork<K>, context: StartContext): LiveAttempt<K>
}

export interface StartContext {
  readonly attemptId: AttemptId
  readonly signal: AbortSignal
}

export type UnknownResolution =
  | { readonly kind: 'confirm-failed'; readonly failure: WorkFailure }
  | { readonly kind: 'authorize-retry' }

export interface AgentWorkQueue {
  enqueue<K extends WorkKind>(request: EnqueueRequest<K>): Promise<WorkId>
  enqueueBatch<K extends WorkKind>(request: BatchRequest<K>): Promise<BatchId>
  list(): readonly WorkView[]
  get(id: WorkId): WorkView
  cancel(id: WorkId): Promise<void>
  retry(id: WorkId): Promise<void>
  pendingNotifications(): readonly Notification[]
  acknowledgeNotification(id: NotificationId, messageId: string): Promise<void>
}

export interface OperatorWorkQueue {
  list(): readonly WorkView[]
  get(id: WorkId): WorkView
  cancel(id: WorkId): Promise<void>
  retry(id: WorkId): Promise<void>
  pause(): void
  resume(): void
  resolveUnknown(workId: WorkId, resolution: UnknownResolution): Promise<void>
  pendingAttentions(): readonly Attention[]
}
```

`Attention.status` is `pending | resolved` with `resolvedAt`; `attention/resolved` must be a sibling of `unknown/resolved`. `Notification.attemptId` is nullable only for queued cancellation. The stable Notification `messageId` is `task-queue-notification:<notificationId>`.

The owner message text is exactly:

```text
Background work reached a terminal outcome.
Work: <title> (<workId>)
Attempt: <attemptId|none>
Outcome: <succeeded|failed|canceled>
Result: <resultId|none>
Inspect the durable result with task_queue_result.
```

## File Map

| Area | Files | Responsibility |
| --- | --- | --- |
| Queue domain | `packages/task-queue/task-queue/src/types.ts`, `fold.ts`, `artifact.ts`, tests | Persisted claims/policy, Batch items, restricted unknown resolution, Attention/Notification invariants, removal of generic artifact API |
| Local Provider | `packages/task-queue/task-queue-local/src/index.ts`, `v2-store.ts`, `v2-artifacts.ts`, tests | Atomic admission, scheduling, recovery, shutdown, terminal outboxes |
| Agent inbox reuse | `packages/core/agent/src/inbox.ts`, `index.ts`, tests; Agent Teams mailbox files | Shared Session message acceptance projection |
| Generic Agent Consumer | `packages/task-queue/tool-task-queue` | Generic controls, `task_queue_result`, trusted owner delivery |
| DSH admission Consumer | new `packages/task-queue/tool-agent-run-task-queue` | Single and Batch `agent.run@1` admission only |
| DSH WorkKind bridge | `packages/task-queue/task-queue-executor-dsh` | Restricted worker Handler and bounded diagnostics |
| Image bridge and Consumer | `packages/image/image-generation-task-queue`, `tool-image-generation-task-queue` | Attachment-backed result and single/Batch image admission |
| Composition | base/web bundles, standard preset, aggregate tsconfigs | Provider, Handler, capacity, and scoped Consumer selection |
| Product verification | Queue Remote/UI tests and evidence under `outputs/task-queue-v2-owner-delivery/` | Operator compatibility and real vertical facts |
| Durable rationale | proposed and implemented Agent Notes, package READMEs, task-queue subsystem docs | Current contracts and final shipped decision |

---

### Task 1: Persist admission policy and enforce atomic Batch scheduling

**Dependencies:**
- None.

**Files:**
- Modify: `packages/task-queue/task-queue/src/types.ts`
- Modify: `packages/task-queue/task-queue/src/fold.ts`
- Modify: `packages/task-queue/task-queue/tests/fixtures.ts`
- Modify: `packages/task-queue/task-queue/tests/fold.spec.ts`
- Modify: `packages/task-queue/task-queue/tests/validation.spec.ts`
- Modify: `packages/task-queue/task-queue/tests/public-api.typecheck.ts`
- Modify: `packages/task-queue/task-queue-local/src/index.ts`
- Modify: `packages/task-queue/task-queue-local/tests/v2-scheduler.spec.ts`
- Modify: `packages/task-queue/task-queue-local/tests/v2-store.spec.ts`
- Modify compiler-reported Queue callers and fakes only.

**Interfaces:**
- Consumes: the Frozen API and Record Changes section.
- Produces: WorkItems with persisted `resources` and handler-derived `policy`; `BatchRequest.items`; transaction-safe idempotent Batch admission; scheduler enforcement of global, resource, and Batch capacity.

**Test Strategy:**
- Change type: persistence, idempotency, concurrency, and public-contract change.
- Risk level: boundary.
- Evidence: RED fold and scheduler tests, public API typecheck, reopened-store assertions.
- Escalation: run additional callers only when compiler errors name them.

**Acceptance Contribution:**
- Prevents admitted work from changing resource meaning after restart and makes Batch a real scheduling constraint instead of metadata.

- [x] **Step 1: Add RED domain and API tests**

Add fixtures proving Work admission rejects missing, duplicate, empty-name, non-positive, fractional, or undeclared resource claims and invalid `maxAttempts`. Replace Batch `title + inputs` fixtures with ordered `items`, preserving each item title and tags. Delete compile-time references to `ArtifactWriter`, `ArtifactRef`, `ArtifactWrite`, and `StartContext.artifacts`.

- [x] **Step 2: Add RED Batch provider tests**

In `v2-scheduler.spec.ts`, start two concurrent admissions with the same owner, key, and digest and assert one Batch, one receipt, and one set of WorkItems after reopen. Add a conflicting-digest case. Start a Batch whose `maxParallel` is `2` under larger global and resource capacity and prove only two members reach `start()` until one settles. Add a different Batch and prove unused host capacity remains available to it.

- [x] **Step 3: Run RED**

```powershell
pnpm vitest run packages/task-queue/task-queue/tests/fold.spec.ts packages/task-queue/task-queue/tests/validation.spec.ts packages/task-queue/task-queue-local/tests/v2-scheduler.spec.ts
```

Expected: failures identify old Batch fields, missing persisted claims, duplicate admission, and ignored `maxParallel`.

- [x] **Step 4: Implement the minimal domain and admission changes**

Add `WorkHandler.policy()`, `WorkItem.resources`, and `BatchItem`. Resolve every item outside the store transaction; derive and validate policy and claims once; then recheck the receipt and append the complete admission inside `store.transaction()`. Use one in-flight admission map keyed by owner, source, and idempotency key for both single and Batch requests. Do not serialize external resolution behind the mutation tail.

- [x] **Step 5: Enforce persisted capacity**

Change claim selection to use `work.resources`. Count `executing` entries globally, per resource, and per non-null `batchId`. Reject missing configured capacity during admission. Call `pump()` after a Handler registration becomes visible so recovered queued work becomes eligible.

- [x] **Step 6: Run focused PASS and typecheck**

```powershell
pnpm vitest run packages/task-queue/task-queue/tests packages/task-queue/task-queue-local/tests/v2-store.spec.ts packages/task-queue/task-queue-local/tests/v2-scheduler.spec.ts
pnpm exec tsc -p packages/task-queue/task-queue/tsconfig.types.json --noEmit
```

Expected: all named tests pass; public typecheck has no compatibility overloads.

- [x] **Step 7: Record the coherent checkpoint without staging**

```powershell
git diff --check -- packages/task-queue/task-queue packages/task-queue/task-queue-local
git status --short -- packages/task-queue/task-queue packages/task-queue/task-queue-local
```

---

### Task 2: Recover orphaned Attempts and preserve Queue ownership through shutdown

**Dependencies:**
- Task 1.

**Files:**
- Modify: `packages/task-queue/task-queue-local/src/index.ts`
- Modify: `packages/task-queue/task-queue-local/src/v2-store.ts`
- Modify: `packages/task-queue/task-queue-local/tests/v2-scheduler.spec.ts`
- Modify: `packages/task-queue/task-queue-local/tests/lock.spec.ts`
- Modify: `packages/task-queue/task-queue/src/fold.ts`
- Modify: `packages/task-queue/task-queue/tests/fold.spec.ts`

**Interfaces:**
- Consumes: persisted Work resources and the existing Queue-root ownership handle.
- Produces: recovery ChangeSets for every stranded Attempt; `shutdownTimeoutMs` configuration; teardown that settles or marks every admitted execution unknown before releasing ownership.

**Test Strategy:**
- Change type: crash recovery, cancellation, teardown, and cross-process ownership.
- Risk level: boundary.
- Evidence: reopened JSONL state plus controlled live handles that settle, throw on cancel, or exceed the shutdown deadline.
- Escalation: inspect `docs/defensive-patterns.md` and run subprocess tests only if the owned handle contract differs.

**Acceptance Contribution:**
- Makes Queue-root single-writer ownership true for live executions, not only for the JSONL file.

- [x] **Step 1: Add RED restart tests**

Persist one queued, one starting, and one running WorkItem, close only the raw test store to simulate a crashed owner, and reopen through `LocalTaskQueue`. Assert queued work waits until its Handler registers, then starts. Assert starting and running Attempts become unknown with `host-restart` failure and one same-ChangeSet pending Attention each before any new Attempt begins.

- [x] **Step 2: Add RED shutdown tests**

Use three fake `LiveAttempt` handles: one cancels and returns canceled, one throws from `cancel()`, and one never settles. Dispose the provider. Assert the first commits canceled, the other two commit unknown plus Attention, every transaction drains, and a second store cannot acquire the root until those durable transitions finish.

- [x] **Step 3: Run RED**

```powershell
pnpm vitest run packages/task-queue/task-queue-local/tests/v2-scheduler.spec.ts packages/task-queue/task-queue-local/tests/lock.spec.ts
```

Expected: recovered Attempts remain starting/running and the root lock is released before execution settlement.

- [x] **Step 4: Implement recovery before dispatch**

After `WorkQueueStore.open()` acquires ownership and folds the log, append one recovery ChangeSet containing `attempt/unknown` and `attention/created` siblings for every starting or running Attempt. Use `sideEffect: 'unknown'` for both persisted states because `start()` may have crossed its external boundary before `attempt/running` became durable. Do not pump until recovery finishes.

- [x] **Step 5: Implement bounded quiescent disposal**

Add required resolved `shutdownTimeoutMs` configuration. Close new admission and dispatch, commit `cancel/requested` for active WorkItems that lack it, abort active controllers, call each live cancel once, await execution settlement within the bound, and convert every unresolved execution to unknown before `store.close()`. Contain individual cancellation errors while retaining them in the unknown failure message. Await the store mutation tail before releasing the lock.

- [x] **Step 6: Run focused PASS**

```powershell
pnpm vitest run packages/task-queue/task-queue-local/tests/v2-store.spec.ts packages/task-queue/task-queue-local/tests/v2-scheduler.spec.ts packages/task-queue/task-queue-local/tests/lock.spec.ts
```

Expected: all recovery and shutdown cases pass without timing sleeps longer than the configured test bound.

- [x] **Step 7: Record the coherent checkpoint without staging**

```powershell
git diff --check -- packages/task-queue/task-queue-local packages/task-queue/task-queue
git status --short -- packages/task-queue/task-queue-local packages/task-queue/task-queue
```

---

### Task 3: Reuse Agent inbox, Attachment, and output-retention capabilities

**Dependencies:**
- Task 1.

**Files:**
- Modify: `packages/core/agent/src/inbox.ts`
- Modify: `packages/core/agent/src/index.ts`
- Modify: `packages/core/agent/tests/agent.spec.ts`
- Remove the obsolete Agent Team session-message helper after both consumers use the Agent-owned acceptance projection.
- Modify: `packages/experimental/agent-team/src/mailbox.ts`
- Modify: `packages/experimental/agent-team/tests/persistence.spec.ts`
- Remove the obsolete Queue ArtifactWriter contract and its local implementation.
- Modify: `packages/image/image-generation-task-queue/src/index.ts`
- Modify: `packages/image/image-generation-task-queue/tests/index.spec.ts`
- Modify: `packages/task-queue/task-queue-local/tests/image-v2-vertical.spec.ts`
- Modify: `packages/task-queue/task-queue-executor-dsh/src/index.ts`
- Modify: `packages/task-queue/task-queue-executor-dsh/package.json`
- Modify: `packages/task-queue/task-queue-executor-dsh/tests/v2-handler.spec.ts`

**Interfaces:**
- Consumes: `agent/inbox/spliced`, `user/message`, `ctx.attachments.saveImages()`, and `TextRetainer`.
- Produces: exported `messageAccepted(events, predicate)` in the Agent package; `ImageGenerateOutput.attachments: readonly ImageAttachmentRef[]`; bounded stdout head and stderr tail without local UTF-8 slicing.

**Test Strategy:**
- Change type: behavior-preserving extraction plus result-storage contract change.
- Risk level: boundary.
- Evidence: shared projection tests, Agent Teams regression tests, image bridge tests with a real Attachment Provider, and DSH handler multibyte bounds.
- Escalation: stop if real generated images require bytes that Attachment normalization changes; obtain the product decision required by the design Note.

**Acceptance Contribution:**
- Removes three duplicate mechanisms before owner delivery and image adoption depend on them.

- [x] **Step 1: Establish focused baselines**

```powershell
pnpm vitest run packages/core/agent/tests/agent.spec.ts packages/experimental/agent-team/tests/persistence.spec.ts packages/image/image-generation-task-queue/tests/index.spec.ts packages/task-queue/task-queue-local/tests/image-v2-vertical.spec.ts packages/task-queue/task-queue-executor-dsh/tests/v2-handler.spec.ts
```

Expected: current focused tests pass before the refactor.

- [x] **Step 2: Move the pure message acceptance projection**

Export the existing fold of `agent/inbox/spliced` plus `user/message` from `@deepseek-ai/dsh-agent` as `messageAccepted(events, predicate)`. Add exact tests for pending next-turn, pending next-step, claimed messages, removed messages, inherited seed exclusion by caller slice, and stable-id predicates. Replace the Agent Teams private implementation with the shared export; do not add a service or registry.

- [x] **Step 3: Replace Queue artifacts with Attachment references**

Remove Queue artifact types and `StartContext.artifacts`. Change `createImageGenerateHandler(imageGeneration, attachments)` to save the complete generated image list through `attachments.saveImages()` and return provider, model, and `attachments`. Update the bridge injection to `['taskQueue', 'imageGeneration', 'attachments']`. The vertical test uses `LocalAttachmentStore`, reopens the Queue, reads every referenced attachment, and verifies bytes and metadata through the Attachment service rather than a host path.

- [x] **Step 4: Replace local text slicing with `TextRetainer`**

Use `TextRetainer({ kind: 'head', maxBytes: maxAssistantBytes })` for semantic stdout and `TextRetainer({ kind: 'tail', maxBytes: failureTailBytes })` for nonzero stderr. Add required resolved `failureTailBytes`, bounded by `collectBytes`, and tests for empty stderr, multibyte boundaries, newest-byte retention, and absence of spill paths.

- [x] **Step 5: Run focused PASS**

```powershell
pnpm vitest run packages/core/agent/tests/agent.spec.ts packages/experimental/agent-team/tests/persistence.spec.ts packages/image/image-generation-task-queue/tests/index.spec.ts packages/task-queue/task-queue-local/tests/image-v2-vertical.spec.ts packages/task-queue/task-queue-executor-dsh/tests/v2-handler.spec.ts
```

Expected: all baselines remain green with no Queue-root artifact writer.

- [x] **Step 6: Record the coherent checkpoint without staging**

```powershell
git diff --check -- packages/core/agent packages/experimental/agent-team packages/image/image-generation-task-queue packages/task-queue/task-queue packages/task-queue/task-queue-local packages/task-queue/task-queue-executor-dsh
git status --short -- packages/core/agent packages/experimental/agent-team packages/image/image-generation-task-queue packages/task-queue/task-queue packages/task-queue/task-queue-local packages/task-queue/task-queue-executor-dsh
```

---

### Task 4: Commit terminal Notification and unknown Attention records atomically

**Dependencies:**
- Tasks 1 and 2.

**Files:**
- Modify: `packages/task-queue/task-queue/src/types.ts`
- Modify: `packages/task-queue/task-queue/src/fold.ts`
- Modify: `packages/task-queue/task-queue/tests/fixtures.ts`
- Modify: `packages/task-queue/task-queue/tests/fold.spec.ts`
- Modify: `packages/task-queue/task-queue/tests/validation.spec.ts`
- Modify: `packages/task-queue/task-queue-local/src/index.ts`
- Modify: `packages/task-queue/task-queue-local/tests/v2-scheduler.spec.ts`
- Modify compiler-reported Remote and Consumer fakes only.

**Interfaces:**
- Consumes: terminal settlement helpers, recovery unknown transitions, and the Frozen API and Record Changes section.
- Produces: same-ChangeSet Notification and Attention records; owner-fenced pending Notification read and CAS acknowledgement; operator pending Attention read and atomic resolution.

**Test Strategy:**
- Change type: persistence, authorization, and idempotency boundary.
- Risk level: boundary.
- Evidence: exact ChangeSet sibling assertions, foreign-owner rejection, wrong-message CAS rejection, and reopen checks.
- Escalation: none.

**Acceptance Contribution:**
- Establishes durable delivery facts before any Session integration runs.

- [x] **Step 1: Write RED terminal outbox tests**

Cover successful result, terminal failure after retry exhaustion, queued cancellation with null Attempt, live cancellation with its Attempt, ownerless terminal work, and auto-retried failure. Assert exactly one pending Notification for terminal owned work and none for ownerless or non-terminal work. Assert the Notification terminal sequence equals its ChangeSet sequence.

- [x] **Step 2: Write RED unknown Attention tests**

Cover Handler-returned unknown, restart-recovered unknown, ownerless unknown, confirmed failure, and authorized retry. Assert unknown creates one pending Attention; resolution commits `unknown/resolved + attention/resolved`; confirmed failure also creates a terminal owner Notification; authorized retry does not.

- [x] **Step 3: Write RED facade tests**

Assert pending Notifications are owner-filtered and sorted by `createdAt` then id. Foreign-owner and wrong-message acknowledgement reject. Repeated correct acknowledgement is idempotent. Operator pending Attentions include every owner and disappear only after atomic unknown resolution.

- [x] **Step 4: Run RED**

```powershell
pnpm vitest run packages/task-queue/task-queue/tests/fold.spec.ts packages/task-queue/task-queue/tests/validation.spec.ts packages/task-queue/task-queue-local/tests/v2-scheduler.spec.ts
```

Expected: failures identify absent settlement siblings and missing facade methods.

- [x] **Step 5: Implement atomic settlement helpers and facades**

Build complete event arrays inside `store.transaction()` before one append. Fold validation requires the matching terminal or unknown sibling, matching owner, Work, Attempt, Result, and ChangeSet sequence. Remove `acknowledgeAttention`; Attention resolution is not a delivery receipt. Do not add compatibility overloads for removed unknown resolutions.

- [x] **Step 6: Run focused PASS**

```powershell
pnpm vitest run packages/task-queue/task-queue/tests/fold.spec.ts packages/task-queue/task-queue/tests/validation.spec.ts packages/task-queue/task-queue-local/tests/v2-store.spec.ts packages/task-queue/task-queue-local/tests/v2-scheduler.spec.ts
```

Expected: every named test passes and reopen assertions inspect the durable records.

- [x] **Step 7: Record the coherent checkpoint without staging**

```powershell
git diff --check -- packages/task-queue/task-queue packages/task-queue/task-queue-local
git status --short -- packages/task-queue/task-queue packages/task-queue/task-queue-local
```

---

### Task 5: Split WorkKind admission and complete explicit owner result delivery

**Dependencies:**
- Tasks 3 and 4.

**Files:**
- Modify: `packages/task-queue/tool-task-queue/src/index.ts`
- Modify: `packages/task-queue/tool-task-queue/package.json`
- Modify: `packages/task-queue/tool-task-queue/tests/v2-tools.spec.ts`
- Create: `packages/task-queue/tool-agent-run-task-queue/package.json`
- Create: `packages/task-queue/tool-agent-run-task-queue/tsconfig.json`
- Create: `packages/task-queue/tool-agent-run-task-queue/src/index.ts`
- Create: `packages/task-queue/tool-agent-run-task-queue/src/invariant.ts`
- Create: `packages/task-queue/tool-agent-run-task-queue/tests/index.spec.ts`
- Create paired package READMEs for `packages/task-queue/tool-agent-run-task-queue`.
- Modify: `packages/bundle/base/package.json`
- Modify: `packages/bundle/base/cordis.patch.yml`
- Modify: `packages/bundle/base/tests/base.spec.ts`
- Modify: `packages/bundle/web-app/cordis.patch.yml`
- Modify: `apps/cli/config/agent-presets/standard/agent.cordis.yml`
- Modify: aggregate TypeScript project references named by the compiler.

**Interfaces:**
- Consumes: pending owner Notifications, shared `messageAccepted()`, Session flush, and the existing `agent.run@1` declaration.
- Produces: generic Queue tools including `task_queue_result`; stable pre-step owner delivery; a WorkKind-specific agent.run admission Consumer with no executor argument.

**Test Strategy:**
- Change type: model-facing API, durable cross-service delivery, and package-composition change.
- Risk level: boundary.
- Evidence: exact tool snapshots, real Session events, flush-before-ack ordering, restart recovery, Loader composition, and absence of WorkKind imports from generic Queue Consumer.
- Escalation: run agent-loop tests only if documented pre-step entry semantics differ from the focused integration.

**Acceptance Contribution:**
- Completes business-result collection while preserving trusted notification content and WorkKind ownership.

- [x] **Step 1: Write RED generic Consumer tests**

Remove enqueue expectations from `v2-tools.spec.ts`. Add `task_queue_result` cases for queued/running, succeeded typed output, failed structured failure, canceled, unknown, and foreign owner. Add renderer tests for the exact stable owner message and assert malicious assistant text, stderr, prompt, path, and attachment metadata never enter it.

- [x] **Step 2: Write RED delivery tests**

Cover accepted pre-step insertion, rejected pre-step, foreign Session isolation, per-step delivery cap from required `maxNotificationsPerStep`, one finalizer per message id, Session flush before Queue acknowledgement, flush rejection leaving Notification pending, existing `user/message` restart acknowledgement, and disposal preventing later work. Use the real Agent inbox projection helper, not a local event scan.

- [x] **Step 3: Write RED agent.run Consumer and composition tests**

The new package registers only `task_queue_enqueue` and `task_queue_enqueue_batch`, derives authority from `exec.agent.session`, accepts individual Batch titles, and never exposes executor, profile, model, credential, or shell fields. Base and standard preset composition include the new row; Web disables the base agent-scoped row and obtains it from the preset.

- [x] **Step 4: Run RED**

```powershell
pnpm vitest run packages/task-queue/tool-task-queue/tests/v2-tools.spec.ts packages/task-queue/tool-agent-run-task-queue/tests/index.spec.ts packages/bundle/base/tests/base.spec.ts
```

Expected: generic tools still own admission, owner delivery is absent, and the new package is not composed.

- [x] **Step 5: Implement generic result and Notification delivery**

Register list, status, result, cancel, retry, stats, and kinds in `tool-task-queue`. Register `agent/pre-step` after the tools: await downstream, preserve rejection, then add at most `maxNotificationsPerStep` absent stable messages. Register `session/event`: on the matching `user/message`, single-flight by message id, flush the Session, acknowledge Notification, and always clear in-flight state. At pre-step, an existing stable `user/message` starts the same finalizer without reinjection.

- [x] **Step 6: Implement and compose the agent.run Consumer**

Move only the two admission tool definitions and their WorkKind type dependency into `tool-agent-run-task-queue`. Register its package invariant and paired README. Update Bundle dependencies, host rows, Web disables, standard preset, and aggregate project references. `tool-task-queue` must have no dependency on `task-queue-executor-dsh`.

- [x] **Step 7: Run focused PASS and contract checks**

```powershell
pnpm vitest run packages/task-queue/tool-task-queue/tests/v2-tools.spec.ts packages/task-queue/tool-agent-run-task-queue/tests/index.spec.ts packages/bundle/base/tests/base.spec.ts
pnpm run verify-package-invariants
pnpm run verify-skill-invocation-metadata
```

Expected: all named checks pass and generated tool inputs contain no executor field.

- [x] **Step 8: Record the coherent checkpoint without staging**

```powershell
git diff --check -- packages/task-queue/tool-task-queue packages/task-queue/tool-agent-run-task-queue packages/bundle/base packages/bundle/web-app apps/cli/config/agent-presets/standard
git status --short -- packages/task-queue/tool-task-queue packages/task-queue/tool-agent-run-task-queue packages/bundle/base packages/bundle/web-app apps/cli/config/agent-presets/standard
```

---

### Task 6: Prove the restricted worker and ten-image Batch verticals

**Dependencies:**
- Tasks 1-5.
- Approved model and ArkCLI Agent Plan configuration are available; report names and presence only.

**Files:**
- Modify: `packages/task-queue/task-queue-executor-dsh/tests/v2-handler.spec.ts`
- Modify: `packages/task-queue/tool-task-queue/tests/v2-tools.spec.ts`
- Modify: `packages/image/tool-image-generation-task-queue/src/index.ts`
- Create inside `packages/image/tool-image-generation-task-queue`: `tests/index.spec.ts`
- Modify: `packages/task-queue/task-queue-local/tests/image-v2-vertical.spec.ts`
- Modify: `packages/task-queue/task-queue-remote/tests/v2-remote.spec.ts`
- Evidence only: `outputs/task-queue-v2-owner-delivery/`

**Interfaces:**
- Consumes: restricted `task-worker` overlay, agent.run Consumer, image Batch Consumer, Attachment-backed output, owner delivery, and operator unknown resolution.
- Produces: deterministic restart evidence plus one real agent.run result and one real ten-image Batch.

**Test Strategy:**
- Change type: real external-process, model, image-provider, persistence, and delivery vertical.
- Risk level: broad milestone preparation.
- Evidence: exact Work/Attempt/Result/Batch/Notification/Session ids, persisted records after reopen, process counts, Attachment reads, and redacted command outcomes.
- Escalation: one evidence-directed worker correction is allowed inside executor/profile files; any second distinct correction or external component failure stops the real slice and records the bounded diagnostic.

**Acceptance Contribution:**
- Demonstrates Queue's distinct durable value and the batch-efficiency path that motivated typed WorkKinds.

- [x] **Step 1: Complete direct worker readiness**

Run the exact final composition and confirm Queue, Queue executor/tool/command/Remote, Jobs, Goal, Subagent, Workflow, Ralph, and HMR are disabled; exactly the Windows foreground PowerShell family remains enabled with background execution unavailable.

```powershell
$workerPatch = (Resolve-Path 'packages/task-queue/task-queue-executor-dsh/worker.cordis.patch.yml').Path
pnpm dsh --profile task-worker --patch $workerPatch --dump-config
```

Then run one direct task with the same launcher argv built by the Handler:

```text
Return exactly QUEUE-WORKER-DIRECT-OK. Do not modify files, run commands, or call external services.
```

Save redacted argv, timestamps, exit code, bounded stdout marker, and bounded stderr under `outputs/task-queue-v2-owner-delivery/worker-direct/`.

- [x] **Step 2: Apply at most one evidence-directed worker correction**

| Diagnostic | Allowed correction |
| --- | --- |
| Recursive or background capability remains active | Correct the named final overlay row and add a composition assertion |
| Managed provider/model is absent | Correct task-worker composition to read the existing managed settings; do not hardcode provider or model |
| An explicitly required credential name is unavailable to the scrubbed process | Add validated named credential forwarding; never forward patterns or values into records/logs |
| Foreground PowerShell or workspace sandbox fails | Correct only the named Windows shell or permission row and add regression coverage |
| Any other failure | Stop and retain the `TextRetainer` diagnostic; do not broaden scope |

- [x] **Step 3: Add deterministic owner-delivery restart coverage**

In `v2-tools.spec.ts`, use real LocalTaskQueue, SessionStore, Agent test runtime, and deterministic Handler. Prove admission, success, pending Notification, accepted stable message, explicit `task_queue_result`, Session flush, acknowledgement, close/reopen, and no duplicate message. Repeat with flush blocked between `user/message` and acknowledgement; reopen and prove acknowledgement completes without reinjection.

- [x] **Step 4: Add the image Batch tool and deterministic performance test**

Register `image_generate_enqueue_batch` with ordered items containing title, completed prompt, size, format, watermark, optional provider, and optional model. One call creates one homogeneous Batch. With ten inputs, assert ten image WorkItems, individual titles, no `agent.run@1`, Batch `maxParallel`, resource capacity, and ten Attachment-backed results. Use provider spies to prove image generation is called ten times and DSH worker spawn zero times.

- [x] **Step 5: Run deterministic vertical tests**

```powershell
pnpm vitest run packages/task-queue/tool-task-queue/tests/v2-tools.spec.ts packages/image/tool-image-generation-task-queue packages/task-queue/task-queue-local/tests/image-v2-vertical.spec.ts packages/task-queue/task-queue-remote/tests/v2-remote.spec.ts
```

Expected: owner recovery and ten-image Batch scenarios pass without real external services.

- [x] **Step 6: Run one real Queue-backed agent.run WorkItem**

From a live owner Agent Session, enqueue title `QUEUE-V2-OWNER-DELIVERY` with:

```text
Return exactly QUEUE-V2-OWNER-DELIVERY-OK. Do not modify files, run commands, or call external services.
```

Record WorkId, AttemptId, ResultId, NotificationId, messageId, terminal ChangeSet sequence, timestamps, ownerSessionId, and process exit. Trigger one ordinary owner step, explicitly call `task_queue_result`, and prove the stable Notification excludes worker output while the tool result contains the marker. Prove the durable `user/message` and Session flush complete before Notification acknowledgement.

- [x] **Step 7: Run one real ten-image Batch**

Use one already compiled list of ten complete cover prompts. Enqueue one Batch with `maxParallel: 3`. Record BatchId, ten Work/Attempt/Result ids, maximum observed concurrent generation calls, Attachment ids, dimensions, hashes, and provider/model facts. Prove ten succeeded results, maximum Batch concurrency no greater than three, configured resource capacity respected, Attachment reads succeed after Queue reopen, and no task-worker child was started for this Batch.

- [x] **Step 8: Save and hash the evidence package**

Write redacted JSON containing ids, sequences, timestamps, status, relative durable locations, process counts, and command exit codes. Retain only fixed markers from prompts/model output, never credentials, presigned URLs, full stderr, or full logs. Generate SHA-256 for every evidence file.

- [x] **Step 9: Record the vertical checkpoint without staging**

```powershell
git diff --check -- packages/task-queue packages/image packages/bundle
git status --short -- packages/task-queue packages/image packages/bundle outputs/task-queue-v2-owner-delivery
```

---

### Task 7: Synchronize shipped documentation and run final gates

**Dependencies:**
- Task 6 real and deterministic evidence passes.

**Files:**
- Modify paired READMEs for every changed Queue and image package.
- Modify: `docs/subsystems/task-queue.md`
- Modify: `docs/subsystems/task-queue.zh.md`
- Move and rewrite the proposed Queue v2 ownership Agent Note into `implemented/architecture` after the implementation matches it.
- Review and update or cross-link the existing Queue image canary, operator MVP, and DSH executor Agent Notes without editing archived notes.
- Modify this implementation plan only when executed paths or commands changed.
- Regenerate owner-generated catalogs through repository scripts.

**Interfaces:**
- Consumes: shipped source, real evidence, focused tests, and current generated catalogs.
- Produces: current package contracts, implemented rationale, synchronized bilingual records, and final verification report.

**Test Strategy:**
- Change type: documentation and broad milestone.
- Risk level: broad.
- Evidence: paired-document checks, Agent Note format, generated catalog freshness, focused suites, host/client builds, lint, doc-sync, and diff hygiene.
- Escalation: compare a broad failure with the initial dirty-checkout baseline immediately; repair only failures caused by changed files.

**Acceptance Contribution:**
- Makes the implemented boundary reviewable without claiming automatic continuation, byte-exact generic artifacts, or multi-host scheduling.

- [x] **Step 1: Update package and subsystem contracts**

Document persisted resources/policy, Batch limits, recovery, shutdown, restricted unknown resolution, Attachment-backed image results, split WorkKind admission, stable owner delivery, explicit result reads, and current limitations. Remove prose that presents Queue ArtifactWriter, generic reconcile, operator-confirmed success, or `tool-task-queue` WorkKind admission as supported.

- [x] **Step 2: Promote the proposed Agent Note**

Move its complete triplet to `implemented/architecture`, change `Status: proposed` to `Status: implemented`, rewrite `Proposal` as `Decision`, replace acceptance/risk planning prose with shipped `Consequences` and verification facts, and retain the alternatives. Audit the image canary and DSH executor Notes for partial supersession; keep and cross-link independently useful rationale, and use `dsh-archive-agent-notes` before archiving or consolidating any triplet.

- [x] **Step 3: Record translation pairs and regenerate catalogs**

```powershell
pnpm run verify-translation-pairing --write packages/task-queue/task-queue/README.md packages/task-queue/task-queue-local/README.md packages/task-queue/task-queue-executor-dsh/README.md packages/task-queue/task-queue-remote/README.md packages/task-queue/command-task-queue/README.md packages/task-queue/tool-task-queue/README.md packages/task-queue/tool-agent-run-task-queue/README.md packages/image/image-generation/README.md packages/image/image-generation-arkcli/README.md packages/image/image-generation-task-queue/README.md packages/image/tool-image-generation-task-queue/README.md packages/client/ui-task-queue/README.md docs/subsystems/task-queue.md .agents/notes/implemented/architecture/2026-08-27-queue-v2-reuse-boundaries.md docs/superpowers/plans/2026-08-27-queue-v2-owner-delivery-worker-closure.md
pnpm run doc-sync
```

Expected: generated Queue/tool/config/API references match source; unrelated baseline failures are reported without repair.

- [x] **Step 4: Run the frozen focused milestone once**

```powershell
pnpm vitest run packages/core/agent/tests packages/experimental/agent-team/tests packages/task-queue/task-queue/tests packages/task-queue/task-queue-local/tests packages/task-queue/task-queue-executor-dsh/tests packages/task-queue/tool-task-queue/tests packages/task-queue/tool-agent-run-task-queue packages/task-queue/task-queue-remote/tests packages/image/image-generation/tests packages/image/image-generation-arkcli/tests packages/image/image-generation-task-queue/tests packages/image/tool-image-generation-task-queue packages/client/ui-task-queue/tests packages/bundle/base/tests/base.spec.ts
```

Expected: every named focused file passes. Record test file and test counts.

- [x] **Step 5: Run final builds and broad gates once**

```powershell
pnpm run build:lib:host
pnpm run build:lib:client
pnpm run lint
pnpm run doc-sync
pnpm run verify-agent-note-format
pnpm run verify-package-paths
git diff --check
```

Expected: changed-path gates pass. Report unrelated baseline failures with their owning paths and do not absorb them.

- [x] **Step 6: Produce the completion report**

Report focused test counts, build/lint/doc results, Worker and Batch ids, terminal and acknowledgement sequences, restart recovery facts, shutdown ownership evidence, maximum observed image concurrency, Attachment hashes, absence of per-image DSH workers, evidence hashes, and remaining limitations.

The allowed completion statement is: Queue v2 provides host-durable typed WorkItems with recovery-safe execution, enforced Batch/resource capacity, explicit typed result collection, and replay-safe owner delivery. The restricted DSH worker and ten-image typed Batch are verified verticals. Automatic Goal continuation, byte-exact generic artifact storage, unverified success reconciliation, and multi-host Session scheduling remain absent.

- [x] **Step 7: Prepare the integration handoff without staging**

```powershell
git diff --check
git status --short
```

## Executor Stop Conditions

- A changed requirement would move ownership from Queue to Jobs, Goal, Session, Attachment, ImageGeneration, or another existing service without a revised design decision.
- Recovery cannot mark every persisted starting or running Attempt unknown before dispatch.
- Shutdown would release Queue-root ownership while an attempt lacks a durable terminal or unknown record.
- Batch admission cannot recheck its receipt and append every member inside one mutation transaction.
- Result delivery would inject executor output as a trusted user message.
- Image acceptance requires byte-exact originals and the mounted Attachment Provider changes those bytes.
- The direct worker diagnostic names a component outside the allowed executor/profile composition files.
- A real external check would expose credentials or require stopping an unrelated live process.
- A broad gate fails only in unrelated dirty-checkout paths; report it and stop investigating.

## Deferred Follow-on Plans

Write separate plans only after this plan completes:

1. **Queue-to-Goal continuation Bridge:** Goal-owned durable grant, one-shot wakeup, existing Goal Round budget, revocation, replay prevention, and audit event.
2. **Multi-host Session ownership:** Session/Agent lease and authenticated runner coordination; Queue consumes the result but does not own the lease.
3. **Byte-exact Artifact capability:** only after a current non-Attachment consumer proves storage, retrieval, authorization, and retention semantics that existing services cannot provide.

## Self-Review Checklist

- Every task names dependencies, files, interfaces, RED or baseline evidence, completion evidence, and escalation.
- Every public type used by a later task is defined in the Frozen API section.
- The earliest real worker and image slices run before broad verification.
- Queue core has no WorkKind Provider dependency.
- Recovered and shutdown attempts cannot disappear behind a released root lock.
- Batch `maxParallel`, host capacity, and resource capacity are all observable in tests.
- Notification content is trusted metadata; typed output requires `task_queue_result`.
- Agent Teams and Queue share only the pure Session acceptance projection.
- Attachment normalization is an explicit product risk, not an implicit storage substitution.
- P3 continuation and multi-host Session ownership remain outside Queue core.
