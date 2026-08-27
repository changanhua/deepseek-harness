# Typed Work Queue v2 and the AgentPlan image vertical

English | [中文](2026-08-26-typed-work-queue-v2.zh.md)

> This plan is the current implementation basis. The priority is to prove typed Queue execution and image-batch performance first, then migrate every product entry point.

## Global constraints

- Preserve the Queue WIP in the current worktree; do not reset, clean, overwrite unrelated changes, or touch `.dsh-intelligence/` or the repository-root `outputs/`.
- Keep the package name `task-queue`; use `WorkItem/WorkState/WorkAttempt/WorkResult/WorkHandler/WorkKind` consistently as the new domain language.
- `ChangeSet` is the only persisted atomic unit; `DomainEvent` is only a logical fact within one.
- Canonicalize caller intent and check the idempotency receipt first. On a hit, return the original ID without external resolution. Only first admission calls `resolveAdmission()` and persists the resolved spec.
- `prepare()` performs dispatch preparation only; `start()` must synchronously return `LiveAttempt`, and real side effects may begin only in `start()`.
- Automatic retry requires both `retriable=true` and `sideEffect=not-started`; `unknown` is a non-terminal state that blocks a new Attempt and only operator resolution can clear it.
- A Handler declares only `ResourceClaim`; deployment configuration declares capacity. Scheduling uses the minimum of global concurrency, resource capacity, and Batch `maxParallel`.
- An Artifact must reach durable storage through fsync/atomic rename before the terminal `ChangeSet` that references it is committed.
- Do not implement a v1 decoder or migrator. Complete real one-image and ten-image acceptance on a canary root first, and only then delete the canonical v1 root.

## Task 1: Queue v2 domain and public API

Own `packages/task-queue/task-queue`. Write RED tests first, then replace the executor-centric types, fold, and transitions.

Fix the public API as:

```ts ignore-check
interface ChangeSet {
  seq: number
  changeId: string
  at: string
  events: readonly DomainEvent[]
}

interface WorkHandler<K extends WorkKind> {
  readonly kind: K
  resolveAdmission(input: WorkInput<K>, context: AdmissionContext): Promise<ResolvedWork<K>>
  resources(resolved: ResolvedWork<K>): readonly ResourceClaim[]
  prepare(resolved: ResolvedWork<K>, context: PrepareContext): Promise<PreparedWork<K>>
  start(prepared: PreparedWork<K>, context: StartContext): LiveAttempt<K>
}
```

Implement immutable Work; separate State, Attempt, Result, Batch, Attention, and Receipt records; Service-layer authority; atomic Batch admission; intent digests; unknown resolution; and a declaration-merging `WorkKindMap`. Pure domain tests cover atomic terminal changes, atomic Batch admission, attempt ordinals, idempotency conflicts, unknown blocking, attention CAS, and operator resolution.

## Task 2: v2 Store, scheduling, and fake Handler vertical

Own `task-queue-local`. Preserve the owner lock, FIFO ordering, append/fsync, segment continuity, torn-tail repair, snapshot digest, inbox quarantine, and notification CAS; switch them to the v2 `ChangeSet` codec and new fold.

- Add a root manifest with `schemaVersion: 2`; fail loudly on an unknown or v1 root.
- Fold the snapshot tail incrementally from the existing `lastSeq`.
- Resolve append ambiguity precisely by target seq plus canonical ChangeSet digest.
- Batch admission appends one ChangeSet only; a failed append exposes zero members.
- After persisting `attempt/started`, call synchronous `start()`, then commit `attempt/running`.
- When crash recovery cannot prove the outcome, enter unknown instead of rerunning.
- `resolveUnknown()` supports reconcile, confirm-succeeded, confirm-failed, and authorize-retry.
- Pause stops dispatch only; enqueue, read, cancel, ack, and reconcile remain available.

Use a fake Handler to complete admission → dispatch → durable artifact/result → notification; cover cancellation races, shutdown quiescence, resource capacity, and HMR disposal.

## Task 3: Shared image capability, ArkCLI Provider, and Queue Handler

Add `packages/image/image-generation`, `packages/image/image-generation-arkcli`, and `packages/task-queue/task-queue-handler-image`.

- Admission order: intent receipt lookup → one `arkcli profile show` → one image-resources query → one `supported_params` query per unique canonical model → atomically persist the resolved spec.
- After dispatch, never repeat profile/resource/model discovery; consume only the persisted spec.
- The current profile must be an AgentPlan profile; write the resolved profile name into the spec and pass explicit `--profile` to every later command.
- `image.generate@1` supports `png|jpeg`, dimensions, and a boolean watermark; the Provider must emit `--watermark=<value>`.
- If the model's `supported_params` does not support a requested parameter, admission fails explicitly without silent degradation or local transcoding.
- Run `+gen` directly through `ctx.subprocess`; do not start a DSH Agent, copy HOME, or save keys or presigned URLs.
- Decode output, verify dimensions and media type, and calculate sha256 before writing the Queue artifact through private temporary file → fsync → atomic rename; commit the terminal ChangeSet last.
- A failure carries category, sideEffect, and retriable together; timeout/transport errors must not trigger automatic retry based on the error name alone.

The fake ArkCLI loader vertical must prove that a ten-image batch on one model makes the expected no-retry calls: `profile 1 + resources 1 + capability 1 + generation 10`, with zero DSH workers.

## Task 4: Early canary and performance acceptance

Start v2 at `C:\Users\xbh\.dsh\task-queue-v2-canary` without affecting canonical v1.

1. Generate one real 2048x3072 PNG. Check Queue succeeded, attempt=1, artifact decoding/dimensions/hash, provider/model, safe result projection, and zero DSH workers.
2. Submit an atomic `image.generate@1` Batch for ten world classics. The calling Agent chooses the style and complete prompt for each book; use one model and default resource capacity=3.
3. Record time to first image, total time, successes per minute, ArkCLI subprocess counts by class, DSH worker count, and attempt/retry/review/429 counts.
4. Continue to formal cutover only when the canary is correct and clearly beats the old baseline of about three images in 16 minutes with six DSH workers.

## Task 5: Model tools, command, Remote, and Web UI

Migrate Tool, `/queue`, Remote, and UI to Work/Batch/Attempt/Attention semantics.

- Tools do not accept an executor; provide enqueue, atomic batch, list/status/batch-status/stats/kinds, cancel/retry, and attention ack.
- Agent authority can operate only its own Work; unknown resolution is operator-only.
- Each Remote poll uses one paginated `snapshot()` that returns stats, rows, and optional detail; batch actions complete in one server-side operation.
- The UI groups by Batch or standalone work and shows phase, wait reason, attempt, progress, artifact, and attention; unknown exposes operator resolution; “pause dispatch” does not block enqueue.
- Migrate the current DSH worker WIP into an explicit `agent.run@1` Handler with default capacity=1; do not use it as the default path for known typed work.

## Task 6: Documentation, formal cutover, and final verification

- Create an Agent Note for current facts; cross-reference or archive the old DSH executor Note under the archive rules, and do not present candidates as implemented facts.
- Update the relevant README/JSDoc, bundle, package/Client/Cordis catalogs, and Queue skill; remove executor-first guidance.
- After focused tests, run typecheck/doc-sync/package gates once; build only once before browser acceptance.
- At formal cutover, read the owner lock and confirm the real owner has exited and released it; after verifying the exact target is `C:\Users\xbh\.dsh\task-queue`, delete the whole v1 root and initialize the canonical root with schemaVersion 2.
- Explicitly preserve `C:\Users\xbh\deepseek-harness\outputs`, `.dsh-intelligence`, and all other unrelated WIP.
- Finish with real browser interaction, refresh recovery, batch actions, unknown resolution, console inspection, and the complete Queue-related test set.
