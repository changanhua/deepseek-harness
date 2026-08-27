# Queue V1.1 Operator Workbench Implementation Plan

English | [中文](2026-08-27-queue-v1-1-operator-workbench.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the four-state Queue MVP into a usable operator workbench where a person can find the next task needing attention, understand its latest attempt, and perform the permitted action without reading raw JSON or risking an accidental duplicate execution.

**Architecture:** Keep Queue v2 persistence, the Remote schema, and the public `queued | running | attention | done` projection unchanged. Add deterministic client-side projection helpers, retain stale data across failed refreshes, and rebuild the workspace around one compact task list plus one structured detail pane. Reuse `Pill`, `StateDot`, `RiskConfirmation`, `Toast`, `JsonTree`, and `writeClipboard` from `@deepseek-ai/dsh-client-ui-primitives`; do not create another dialog, toast, JSON viewer, or status component.

**Tech Stack:** TypeScript, React 18, CSS Modules, Cordis client slots, Vitest, Testing Library, DSH UI primitives.

**Dependencies:** The Queue v2 MVP in the current working tree, including `QueueTaskState`, `QueueTaskOutcome`, `QueueStore`, the `taskQueue/snapshot` Remote, and the existing five-second serialized refresh chain. Preserve all unrelated dirty-tree work.

**Real Acceptance Path:** Build the client once after focused tests pass, start the real Web profile on loopback, enqueue one harmless `agent.run@1` task from a real DSH conversation, and use the Queue page to observe the task through list selection and durable lifecycle refresh. Component tests provide deterministic evidence for `attention` decisions; do not manufacture an unknown attempt by killing a worker.

**Broad Verification Budget:** Run focused Queue tests during Tasks 1-3. After Task 4 freezes the implementation, run `pnpm run build:lib:client`, `pnpm run lint`, and `pnpm run doc-sync` once each; expect roughly 8-15 minutes total. Rerun a broad command only after changing a file implicated by its failure. If a broad command reports an unrelated baseline failure, record the exact failing path and stop investigating it.

## Global Constraints

- Work in the current checkout and preserve all existing WIP; do not reset, clean, force-switch, delete Queue data, stop an unowned service, or rewrite unrelated files.
- Use `apply_patch` for source and documentation edits.
- Do not change `packages/task-queue/task-queue-remote/src/views.ts`, `packages/task-queue/task-queue-remote/src/index.ts`, Queue persistence, authority, scheduler, executor, bundle composition, or Web startup.
- Keep the operator projection exactly `queued | running | attention | done`; keep terminal outcomes exactly `succeeded | failed | canceled | null`.
- Keep durable `starting` and `unknown` semantics internal: `starting` presents as `running`, and `unknown` presents as `attention`.
- `done` is a UI state; `succeeded`, `failed`, and `canceled` are outcomes shown inside that state.
- Do not expose `reconcile` or `confirm-succeeded` in this UI.
- Replace the label “安全重试” with “确认重试”. An unknown attempt may already have caused external effects, so the UI must not describe retry as safe.
- Do not add batch actions, charts, task creation, priority editing, owner editing, saved views, pagination, log-terminal controls, artifact previews, or service pause/resume controls.
- Keep Owner display informational. `ownerSessionId` is routing metadata and must not be presented as an authorization guarantee.
- During implementation, run only the focused command named by the current task. Save full client build, repository lint, documentation synchronization, and real browser work for Task 4.
- Every interactive element must be keyboard reachable, retain a visible focus state, have an accessible name, and never depend on color alone.
- Use DSH `--dsw-*` tokens and existing primitives. Do not add raw brand colors, emoji icons, a new dependency, or a new shared primitive.
- Keep English and Chinese README and locale content synchronized. Regenerate pairing sidecars only after the paired prose has stabilized.

---

## Product Contract

### Primary operator path

The page must make this sequence possible without navigating away:

1. Notice an `attention` task above less urgent work.
2. Select it and read the latest failure and attempt history.
3. Read the duplicate-side-effect warning.
4. Either acknowledge the risk and authorize another attempt, or enter a reason and confirm failure.
5. Observe row-level progress, durable refresh, and a success or error message.

### Layout

Desktop uses a master-detail workbench. The task list receives approximately 55% of the available width and the detail pane receives 45%. Under 960 CSS pixels, the panes stack in document order; this version does not add JavaScript viewport state or a separate mobile drawer.

```text
┌ Queue ─────────── 更新于 10 秒前 ── [刷新] ┐
│ [全部 18] [进行中 4] [需处理 2] [已完成 12] │
│ [搜索标题或 ID……………………………………] │
├───────────────────┬──────────────────────┤
│ 任务列表           │ 任务详情              │
│ ⚠ 数据同步         │ 数据同步              │
│   需处理 · 2/3     │ 需处理                │
│   owner · 3 分钟前 │ [风险说明]            │
│                   │ [确认重试] [确认失败] │
│ ● 生成报告         │ 基本信息              │
│   运行中 · 1/3     │ 尝试记录              │
│ ○ 清理缓存         │ 结果                  │
│   待执行 · 0/2     │ 高级信息（折叠）      │
└───────────────────┴──────────────────────┘
```

### Ordering and filtering

The default filter remains `all`. Filter candidate rows, then sort the result by operator urgency: `attention`, `running`, `queued`, then `done`; within the same state sort by `updatedAt` descending, then by `id` descending for deterministic ties. Search is case-insensitive and matches only `title` or `id`.

The four filters remain:

| Filter | Included rows |
|---|---|
| `all` | every row |
| `active` | `queued` and `running` |
| `attention` | `attention` only |
| `done` | `done` only, regardless of outcome |

### Row content

Each task row shows one state dot, state text, title, Owner or “无关联会话”, attempt progress as `attemptCount/maxAttempts`, and relative update age. The ID and `kind` move to the detail pane. The state text remains present beside the dot, so color is never the only signal.

Map state and outcome to the existing `StateDot` primitive as follows:

| UI fact | Dot |
|---|---|
| `queued` | `warning` |
| `running` | `ongoing` |
| `attention` | `error` |
| `done + succeeded` | `done` |
| `done + failed` | `error` |
| `done + canceled` | `warning` |

The row itself selects the task. Keep row actions separate from the selection button so the markup never nests one button inside another. Show only the action that is valid for that row: cancel for `queued` or `running`, retry for `done + failed`, and “处理” for `attention`.

### Detail content

The detail pane contains these sections in order:

1. Header: title, four-state label, terminal outcome when present, and a copy-ID button.
2. Summary: kind, Owner, attempt progress, created time, and updated time.
3. Current issue: failure category, message, side-effect classification, and retriable flag when `failure` is non-null.
4. Operator actions: only actions valid for the selected row.
5. Attempts: ordinal, status, started time, finished time, and failure message. Keep all attempts visible in a compact vertical list; do not invent log content not present in `QueueWorkAttemptView`.
6. Result: render object or array output with `JsonTree`; render a primitive as formatted text; render the localized no-result sentence when result is null.
7. Advanced information: a native `<details>` element containing a read-only `JsonTree` over `{ work: detail }`.

### Action safety

- Canceling a queued or running task opens `RiskConfirmation`. The running description says that already-completed external effects cannot be undone. The queued description says that the task will not execute after durable cancellation settles.
- Authorizing another attempt for `attention` opens `RiskConfirmation`, names the selected task, states that the prior result is unknown, and requires a checked acknowledgement that duplicate external effects are possible.
- Retrying `done + failed` does not need the risk checkbox, but disables only that task's actions until the mutation and refresh settle.
- Confirming failure requires a trimmed, non-empty reason. The button remains disabled while the field is empty and a localized helper sentence explains why.
- A pending mutation locks only the matching work ID. Search, filters, selection, refresh, and actions on unrelated rows remain available.
- Success uses `Toast`. Mutation failure remains visible beside the matching row and in its selected detail pane; the toast timer never discards it.

### Refresh and empty states

`QueueStore` retains the last successful rows and detail when a refresh fails. The header shows the age of the last successful refresh; while refreshing it shows “正在更新”. A refresh error displays a banner while the retained data remains usable.

Use distinct empty copy:

| Situation | Chinese copy |
|---|---|
| Entire queue empty | 当前没有任务。 |
| Active filter empty | 当前没有等待或正在执行的任务。 |
| Attention filter empty | 没有需要人工处理的任务。 |
| Done filter empty | 还没有已结束的任务。 |
| Search has no matches | 没有匹配当前搜索的任务。 |

The search-empty state includes a “清除搜索” button. Filter-empty states do not suggest creating tasks because task admission is outside this surface.

## File Map

| File | Responsibility |
|---|---|
| `packages/client/ui-task-queue/src/client/view-model.ts` | Pure sorting, filtering, counts, relative-age, and state-dot mapping |
| `packages/client/ui-task-queue/tests/view-model.client.spec.ts` | Deterministic view-model behavior |
| `packages/client/ui-task-queue/src/client/store.ts` | Serialized Remote reads plus retained `lastSuccessfulRefreshAt` |
| `packages/client/ui-task-queue/tests/store.client.spec.ts` | Refresh ordering, retained data, and refresh timestamp evidence |
| `packages/client/ui-task-queue/src/client/QueueWorkspace.tsx` | Workspace state, list/detail rendering, row-scoped actions, confirmation, feedback |
| `packages/client/ui-task-queue/src/client/QueueWorkspace.module.css` | Token-based master-detail layout and responsive stacking |
| `packages/client/ui-task-queue/src/client/locales.ts` | Complete Chinese and English workbench copy |
| `packages/client/ui-task-queue/tests/workspace.client.spec.tsx` | Accessible operator workflows and Remote mutation arguments |
| `packages/client/ui-task-queue/README.md` and `README.zh.md` | Current package behavior and limitations |
| `.agents/notes/implemented/architecture/2026-08-27-queue-v2-operator-mvp.md` and `.zh.md` | Shipped V1.1 decision, rationale, and verification obligations |

Do not create additional components unless `QueueWorkspace.tsx` exceeds the repository linter's maintainability limit. If that happens, split only `QueueTaskDetail.tsx`; keep `QueueWorkspace` as the owner of selection, pending action, confirmation, and feedback state.

---

### Task 1: Deterministic Queue view model

**Dependencies:**
- Existing `QueueWorkSummaryView`, `QueueTaskState`, and `QueueTaskOutcome` from `@deepseek-ai/dsh-task-queue-remote/views`.

**Files:**
- Create: `packages/client/ui-task-queue/src/client/view-model.ts`
- Create: `packages/client/ui-task-queue/tests/view-model.client.spec.ts`

**Interfaces:**
- Consumes: `QueueWorkSummaryView`, `QueueTaskState`, and `StateDotState`.
- Produces: `QueueFilter`, `QueueCounts`, `QueueAge`, `projectQueueRows()`, `countQueueRows()`, `queueAge()`, and `dotFor()` for Task 3.

Use these exact exports:

```ts
export type QueueFilter = 'all' | 'active' | 'attention' | 'done'

export interface QueueCounts {
  all: number
  active: number
  attention: number
  done: number
}

export interface QueueAge {
  value: number
  unit: 'seconds' | 'minutes' | 'hours' | 'days'
}

export function projectQueueRows(
  rows: readonly QueueWorkSummaryView[],
  filter: QueueFilter,
  query: string,
): QueueWorkSummaryView[]

export function countQueueRows(rows: readonly QueueWorkSummaryView[]): QueueCounts
export function queueAge(updatedAt: string, nowMs: number): QueueAge
export function dotFor(row: QueueWorkSummaryView): StateDotState
```

`projectQueueRows()` copies before sorting and never mutates the Remote array. `queueAge()` clamps future timestamps to zero and uses floor division at 60 seconds, 60 minutes, and 24 hours. `dotFor()` throws if `row.state === 'done'` and `row.outcome === null`, because the Remote projection promises that a terminal row has a terminal outcome.

**Test Strategy:**
- Change type: new behavior.
- Risk level: focused.
- Evidence: `view-model.client.spec.ts` proves ordering, filtering, case-insensitive search, no input mutation, time thresholds, and every state/outcome dot mapping.
- Escalation: none.

**Acceptance Contribution:**
- Guarantees that every workspace render surfaces urgent work first without changing durable status semantics.

- [ ] **Step 1: Write RED tests for ordering and filtering**

Create fixtures with IDs `attention-1`, `running-1`, `queued-1`, `done-new`, and `done-old`. Give `done-new` a later `updatedAt` than `done-old`, pass the rows in reverse urgency order, and assert:

```ts
expect(projectQueueRows(rows, 'all', '').map(row => row.id)).toEqual([
  'attention-1',
  'running-1',
  'queued-1',
  'done-new',
  'done-old',
])
expect(projectQueueRows(rows, 'active', '').map(row => row.id)).toEqual([
  'running-1',
  'queued-1',
])
expect(projectQueueRows(rows, 'all', 'REPORT').map(row => row.id)).toEqual(['done-new'])
expect(rows.map(row => row.id)).toEqual(originalOrder)
```

- [ ] **Step 2: Write RED tests for counts, age, and dots**

Assert exact counts for all four filters. Assert `queueAge()` at 59 seconds, 60 seconds, 59 minutes, 60 minutes, 23 hours, 24 hours, and a future timestamp. Assert every table row in the Product Contract. Assert that `done + null` throws with `Queue done row requires an outcome`.

- [ ] **Step 3: Run the RED test**

Run:

```powershell
pnpm vitest run packages/client/ui-task-queue/tests/view-model.client.spec.ts
```

Expected: FAIL because `../src/client/view-model.ts` does not exist.

- [ ] **Step 4: Implement the minimal pure helpers**

Use a fixed urgency map:

```ts
const STATE_RANK: Readonly<Record<QueueTaskState, number>> = {
  attention: 0,
  running: 1,
  queued: 2,
  done: 3,
}
```

Filter after creating the normalized lowercase query, then sort the returned copy. Do not import React or access `Date.now()` inside these helpers.

- [ ] **Step 5: Run the focused test**

Run the Step 3 command. Expected: one file passes with all assertions green.

- [ ] **Step 6: Review the Task 1 diff**

Confirm that only the two Task 1 files changed, all exports have concise JSDoc, no `any` was introduced, and the Remote schema is untouched.

---

### Task 2: Retained refresh evidence

**Dependencies:**
- Task 1 is independent but must already be complete so later workspace work consumes stable helpers.
- Existing serialized `QueueStore.refresh()` chain.

**Files:**
- Modify: `packages/client/ui-task-queue/src/client/store.ts`
- Modify: `packages/client/ui-task-queue/tests/store.client.spec.ts`

**Interfaces:**
- Consumes: the existing `QueueRemoteFace.snapshot()` result.
- Produces: `QueueSnapshot.lastSuccessfulRefreshAt: string | null` for the workspace header.

Add exactly one snapshot field:

```ts
export interface QueueSnapshot {
  // existing fields stay unchanged
  lastSuccessfulRefreshAt: string | null
}
```

Set it to `new Date().toISOString()` only after a successful `snapshot()` response. A failed refresh updates `refreshing` and `error` but retains `stats`, `rows`, `selectedId`, `detail`, and `lastSuccessfulRefreshAt`.

**Test Strategy:**
- Change type: changed behavior at a refresh/concurrency boundary.
- Risk level: boundary.
- Evidence: the existing concurrent-refresh test stays green, and a new success-then-failure test proves retained data and timestamp.
- Escalation: run workspace tests only after Task 3 consumes the field.

**Acceptance Contribution:**
- Lets the page report stale-but-usable data honestly after a connection error.

- [ ] **Step 1: Add a RED success-then-failure test**

Use `vi.useFakeTimers()` and `vi.setSystemTime('2026-08-27T10:00:00.000Z')`. Return one successful snapshot containing row `work-1`, then reject the next `snapshot()` with `new Error('offline')`. Assert after the second refresh:

```ts
expect(store.getSnapshot()).toMatchObject({
  rows: [expect.objectContaining({ id: 'work-1' })],
  lastSuccessfulRefreshAt: '2026-08-27T10:00:00.000Z',
  refreshing: false,
  error: 'offline',
})
```

Restore real timers in `afterEach()` so this test cannot leak clock state.

- [ ] **Step 2: Run the RED store test**

Run:

```powershell
pnpm vitest run packages/client/ui-task-queue/tests/store.client.spec.ts
```

Expected: FAIL because `lastSuccessfulRefreshAt` is absent.

- [ ] **Step 3: Implement the snapshot field**

Add `lastSuccessfulRefreshAt: null` to `EMPTY`. In the successful branch of `read()`, set `lastSuccessfulRefreshAt` in the same `#set()` call as `stats`, `rows`, and `detail`. Do not change the Remote call count or remove the serialized `#refreshTail`.

- [ ] **Step 4: Run the focused store test**

Run the Step 2 command. Expected: the concurrent-refresh test, unknown-resolution test, and retained-refresh test all pass.

- [ ] **Step 5: Review the Task 2 diff**

Confirm that a refresh failure does not blank rows or detail, the timestamp advances only on success, and no timer or polling logic moved into the store.

---

### Task 3: Usable master-detail workspace

**Dependencies:**
- Task 1 exports the only sorting/filtering/count/age/dot helpers.
- Task 2 provides `lastSuccessfulRefreshAt`.
- Existing `QueueStore.cancel()`, `retry()`, `resolveUnknown()`, `select()`, and `refresh()` methods remain the only mutations and reads.

**Files:**
- Modify: `packages/client/ui-task-queue/src/client/QueueWorkspace.tsx`
- Modify: `packages/client/ui-task-queue/src/client/QueueWorkspace.module.css`
- Modify: `packages/client/ui-task-queue/src/client/locales.ts`
- Modify: `packages/client/ui-task-queue/tests/workspace.client.spec.tsx`

**Interfaces:**
- Consumes: `projectQueueRows()`, `countQueueRows()`, `queueAge()`, `dotFor()`, `QueueStore`, and existing UI primitives.
- Produces: the complete V1.1 browser workbench and localized accessible names.

Own these local state types in `QueueWorkspace.tsx`:

```ts
type PendingAction = {
  workId: string
  kind: 'cancel' | 'retry' | 'authorize-retry' | 'confirm-failed'
} | null

type Confirmation = {
  workId: string
  kind: 'cancel' | 'authorize-retry'
} | null

type ActionError = { workId: string; message: string } | null
type Feedback = { sequence: number; message: string } | null
```

Use one `failureReason` string for the selected attention task. Clear it and any task-scoped error when `snapshot.selectedId` changes. Use one `acknowledged` boolean for `RiskConfirmation`; reset it whenever the confirmation closes or its work ID changes.

Import and use these existing primitives:

```ts
import {
  Button,
  JsonTree,
  Pill,
  RiskConfirmation,
  StateDot,
  Toast,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
```

Do not call `window.confirm()` and do not render result JSON through a raw always-visible `<pre>`.

**Test Strategy:**
- Change type: new user-visible behavior with sensitive side effects.
- Risk level: boundary.
- Evidence: Testing Library tests prove accessible selection, urgency order, confirmation acknowledgement, exact Remote inputs, reason validation, row-scoped pending, retained refresh error, and search-empty recovery.
- Escalation: real browser proof occurs in Task 4 after the client build.

**Acceptance Contribution:**
- Completes the operator path from urgent task discovery through durable resolution feedback.

- [ ] **Step 1: Replace the existing attention tests with RED V1.1 tests**

Create one reusable `makeSnapshot()` fixture builder that returns a complete `QueueSnapshot` and accepts partial overrides. Create one `makeQueue()` fake that returns a `QueueStore`-compatible object plus spies. Keep all timestamps fixed.

Add these exact tests:

1. `orders attention before running, queued, and done and exposes four filter counts`
2. `selects a row and renders owner, kind, attempts, failure, and result in the detail pane`
3. `requires risk acknowledgement before authorizing an attention retry`
4. `requires a trimmed reason before confirming an attention task failed`
5. `disables only the work item whose mutation is pending`
6. `keeps stale rows visible beside a refresh error and last-successful age`
7. `clears a search with no matching tasks`

For the retry confirmation test, click “确认重试”, assert a dialog is present, assert the confirm button is disabled, click the acknowledgement checkbox, click the enabled confirm button, then assert:

```ts
expect(resolveUnknown).toHaveBeenCalledWith('attention-1', {
  kind: 'authorize-retry',
})
```

For failure confirmation, enter `  output could not be verified  ` and assert:

```ts
expect(resolveUnknown).toHaveBeenCalledWith('attention-1', {
  kind: 'confirm-failed',
  failure: {
    category: 'operator-confirmed',
    message: 'output could not be verified',
    sideEffect: 'unknown',
    retriable: false,
  },
})
```

For row-scoped pending, hold the `cancel('running-1')` promise open, assert that task's action is disabled, and assert the retry button for `failed-1` remains enabled.

- [ ] **Step 2: Run the RED workspace test**

Run:

```powershell
pnpm vitest run packages/client/ui-task-queue/tests/workspace.client.spec.tsx
```

Expected: FAIL because the MVP has no CSS-module layout, structured detail, `RiskConfirmation`, row-scoped pending, retained-refresh copy, or V1.1 labels.

- [ ] **Step 3: Replace workspace structure without changing store or Remote contracts**

Implement this component order:

```tsx
<section className={css.workspace} aria-label={t('view.title')}>
  <header className={css.head}>...</header>
  {snapshot.error !== null && <div className={css.errorBanner} role="alert">...</div>}
  <div className={css.shell}>
    <section className={css.listPane} aria-label={t('list.title')}>...</section>
    <aside className={css.detailPane} aria-label={t('detail.title')}>...</aside>
  </div>
  {feedback !== null && <Toast key={feedback.sequence} ... />}
  <RiskConfirmation ... />
</section>
```

Use `Pill` for the four filters and preserve `aria-pressed`. Render list rows as `<li>` containing a selection `<button>` and a sibling action region; never put a `Button` inside the selection button. Set `aria-current="true"` on the selected row button.

Use `Date.now()` once per render when formatting all visible ages. Do not add a second timer: the existing five-second refresh already produces rerenders.

- [ ] **Step 4: Implement row-scoped actions**

Create one `act(workId, kind, action, successMessage)` helper that sets `pendingAction`, clears the matching error, awaits the existing store method, emits a `Toast` only for `result.ok`, stores `ActionError` for `!result.ok`, and clears pending in `finally` only if the pending work ID and action still match.

Cancel and attention retry open `RiskConfirmation`; they call `act()` only after acknowledgement. Failed retry calls `act()` directly. Confirm-failed trims the reason before constructing the existing `QueueUnknownResolutionInput`.

Do not disable the page refresh button because another row is pending. Disable it only while `snapshot.refreshing` is true.

- [ ] **Step 5: Implement structured detail and copy**

Render the Product Contract sections in order. For copying the ID, await `writeClipboard(snapshot.detail.id)` and use its boolean return to emit localized success or failure feedback; do not assume clipboard acceptance. Use `JsonTree` for object/array result output and `{ work: snapshot.detail }` advanced information. Keep `<details>` collapsed by default.

Do not render fields absent from `QueueWorkView`; in particular, do not invent executor names, prompts, priorities, artifacts, duration, or logs.

- [ ] **Step 6: Replace the CSS module with only live V1.1 selectors**

The current stylesheet contains unused service controls, fault state, artifact, log, batch, and legacy raw-status selectors. Remove those selectors and retain only classes used by the new JSX.

Required layout rules:

- `.workspace`: flex column, `min-height: 0`, 18-20px padding, 12px gap.
- `.head`: title and refresh metadata on the left, refresh button aligned right.
- `.shell`: two-column grid `minmax(360px, 1.2fr) minmax(320px, 0.8fr)` with 12px gap.
- `.listPane` and `.detailPane`: token border/background, 12px radius, `min-width: 0`, internal scrolling.
- `.row`: minimum 52px height and a visible selected inset accent.
- `.rowSelect`: transparent full-width selection button with visible `:focus-visible` ring.
- `.rowActions`: sibling actions with at least 8px spacing.
- `.attentionPanel` and `.failureBox`: icon/text-independent border and heading treatment.
- At `max-width: 960px`, `.shell` becomes one column and neither pane uses fixed positioning.
- Under `prefers-reduced-motion: reduce`, suppress non-essential transitions and animation; the `StateDot` primitive owns its own reduced-motion behavior.

Use no hard-coded font family except the existing repository monospace stack for IDs. Use no raw hex color when a `--dsw-*` token exists.

- [ ] **Step 7: Replace stale locale keys with the V1.1 copy**

Keep keys used by `QueueNavEntry`. Remove workspace-only keys for service pause/resume, batch actions, dismiss, prompt, priority, artifacts, and logs if `rg` proves no other file uses them.

At minimum add complete zh/en pairs for:

```text
view.updating
view.updated
view.updateFailed
list.title
list.actions.handle
list.actions.confirmRetry
search.clear
empty.all
empty.active
empty.attention
empty.done
empty.search
detail.summary
detail.issue
detail.attempts
detail.advanced
detail.copyId
detail.copySucceeded
detail.copyFailed
attention.retryTitle
attention.retryDescription
attention.retryAcknowledge
attention.cancelTitle
attention.cancelQueuedDescription
attention.cancelRunningDescription
attention.cancelAcknowledge
attention.reasonHelp
dialog.cancel
dialog.confirm
time.secondsAgo
time.minutesAgo
time.hoursAgo
time.daysAgo
```

Use “确认重试” / “Confirm retry”; do not retain “安全重试” / “Safe retry”.

- [ ] **Step 8: Run the focused Queue client slice**

Run:

```powershell
pnpm vitest run packages/client/ui-task-queue/tests/view-model.client.spec.ts packages/client/ui-task-queue/tests/store.client.spec.ts packages/client/ui-task-queue/tests/workspace.client.spec.tsx packages/client/ui-task-queue/tests/nav.client.spec.ts packages/client/ui-task-queue/tests/apply.client.spec.ts
```

Expected: five files pass. If a test fails, rerun only that file until its state owner is understood; do not start the client build or repository-wide checks.

- [ ] **Step 9: Run target-file lint**

Run:

```powershell
pnpm exec oxlint packages/client/ui-task-queue/src/client/view-model.ts packages/client/ui-task-queue/src/client/store.ts packages/client/ui-task-queue/src/client/QueueWorkspace.tsx packages/client/ui-task-queue/src/client/locales.ts packages/client/ui-task-queue/tests/view-model.client.spec.ts packages/client/ui-task-queue/tests/store.client.spec.ts packages/client/ui-task-queue/tests/workspace.client.spec.tsx
```

Expected: exit code 0 with no findings.

---

### Task 4: Current-state documentation and real acceptance

**Dependencies:**
- Tasks 1-3 focused tests and target lint are green.
- The implementation diff is frozen except for failures found by the checks in this task.

**Files:**
- Modify: `packages/client/ui-task-queue/README.md`
- Modify: `packages/client/ui-task-queue/README.zh.md`
- Regenerate: `packages/client/ui-task-queue/README.i18n.yaml`
- Modify: `.agents/notes/implemented/architecture/2026-08-27-queue-v2-operator-mvp.md`
- Modify: `.agents/notes/implemented/architecture/2026-08-27-queue-v2-operator-mvp.zh.md`
- Regenerate: `.agents/notes/implemented/architecture/2026-08-27-queue-v2-operator-mvp.i18n.yaml`

**Interfaces:**
- Consumes: the shipped V1.1 behavior and test names from Tasks 1-3.
- Produces: current package documentation, durable decision rationale, real browser evidence, and final verification output.

**Test Strategy:**
- Change type: documentation plus real UI/API boundary acceptance.
- Risk level: broad milestone.
- Evidence: paired docs, focused Queue tests, one client build, one real model-backed Queue lifecycle, browser interaction, console/alert inspection, and one broad gate pass.
- Escalation: rerun a broad gate only after changing an implicated file; unrelated baseline failures are reported, not repaired.

**Acceptance Contribution:**
- Proves that the design is implemented in the real Web composition, not merely rendered by jsdom fixtures.

- [ ] **Step 1: Update current-state package documentation**

The README Workspace section must state:

- four public states and terminal outcomes;
- urgency ordering, four filters, and title/ID search;
- master-detail structure and retained stale data after refresh failure;
- row-scoped cancel/retry and attention resolution;
- explicit duplicate-side-effect acknowledgement for unknown retry;
- structured attempts and result inspection;
- polling remains the refresh mechanism.

The Known Limitations section must retain only actual deferred work: browser event forwarding, artifact previews, confirm-succeeded result editing, batch operations, and server pagination if real volume requires it. Do not describe V1.1 behavior as future work.

- [ ] **Step 2: Update the implemented Agent Note**

Keep the note in present tense. Record these durable decisions:

- four-state projection remains smaller than durable status vocabulary;
- urgency ordering is a client projection, not persisted priority;
- unknown retry is described as “confirm retry”, never “safe retry”;
- Owner remains routing metadata rather than authorization proof;
- row-scoped pending preserves unrelated operator work;
- `RiskConfirmation`, `Toast`, and `JsonTree` are reused instead of package-local equivalents;
- batch actions, analytics, confirm-succeeded, and task creation remain intentionally absent.

Update Alternatives Considered with the rejected card grid, extra UI states, always-visible raw JSON, global pending lock, native `window.confirm`, and batch controls. Keep acceptance checklists out of the implemented note.

- [ ] **Step 3: Regenerate only the touched translation pairs**

Run:

```powershell
pnpm run verify-translation-pairing --write packages/client/ui-task-queue/README.md .agents/notes/implemented/architecture/2026-08-27-queue-v2-operator-mvp.md
```

Expected: both named English/Chinese pairs are recorded and the two `.i18n.yaml` files update.

- [ ] **Step 4: Re-run the frozen focused slice**

Run the Task 3 Step 8 test command and Task 3 Step 9 lint command once. Expected: both exit 0.

- [ ] **Step 5: Build the client once**

Run:

```powershell
pnpm run build:lib:client
```

Expected: exit code 0 and regenerated client artifacts contain the Queue workspace. Do not run `build:lib:host` because this plan changes no host or Remote source.

- [ ] **Step 6: Start or reuse the real Web profile safely**

First inspect port 3080 and the Queue owner lock without changing either. If another live process owns the canonical Queue root, do not stop it. Reuse an existing Web process only when its command line points at this checkout and it was started after the Task 4 client build; otherwise report the owner and wait for direction.

When no owner exists, start:

```powershell
pnpm dsh web --no-open
```

Record the new PID, command line, `127.0.0.1:3080` listener, and startup URL. The Web process must not advertise or bind a LAN address.

- [ ] **Step 7: Run the earliest real Queue vertical slice**

Open `http://127.0.0.1:3080/` with the in-app browser. In a real DSH conversation, request one harmless durable worker task with this exact intent:

```text
Enqueue one agent.run@1 task titled QUEUE-V1.1-SMOKE. Its prompt is: Return exactly QUEUE-V1.1-SMOKE and do not modify files, run commands, or call external services.
```

Open Queue and record the real Work ID. Verify the task appears in the list, can be found by `QUEUE-V1.1-SMOKE` and by its ID, can be selected, and exposes Owner, kind, attempts, timestamps, and outcome from `taskQueue/snapshot`. Observe at least one lifecycle refresh; do not infer success from HTTP 200 or text alone.

Do not kill the worker to force `attention`. The deterministic component tests are the acceptance evidence for unknown resolution unless an attention task already exists naturally.

- [ ] **Step 8: Run browser interaction acceptance**

Verify all of the following in the real page:

- Filter counts render and selecting each filter changes the visible list.
- Search-empty copy and “清除搜索” work.
- Selecting the smoke task updates the detail pane without navigating away.
- Manual refresh retains the selected task.
- The result and advanced sections expand without horizontal page overflow.
- Keyboard Tab reaches filters, search, task selection, valid row actions, detail actions, and refresh in visual order.
- No browser alert appears and the browser console contains no new errors.
- Refreshing the browser page restores a usable Queue page and current durable task facts.

If a product-visible GUI pull request will be created, read `.agents/skills/record-browser-gif/SKILL.md` and record the filter-search-select-detail flow from this real server and smoke task. Publish the optimized GIF according to that skill before opening or updating the pull request.

- [ ] **Step 9: Run broad gates once**

Run:

```powershell
pnpm run lint
pnpm run doc-sync
git diff --check -- packages/client/ui-task-queue .agents/notes/implemented/architecture/2026-08-27-queue-v2-operator-mvp.md .agents/notes/implemented/architecture/2026-08-27-queue-v2-operator-mvp.zh.md docs/superpowers/plans/2026-08-27-queue-v1-1-operator-workbench.md
```

Expected: touched Queue files and documentation pass. If repository-wide lint or doc-sync fails only in unrelated paths, preserve the output, identify it as baseline/WIP, and do not repair or rerun it.

- [ ] **Step 10: Final evidence report**

Report:

- changed files grouped by view model, store, workspace, tests, and documentation;
- focused test file/test counts;
- target lint result;
- client build result;
- real PID/listener/URL;
- smoke Work ID and observed lifecycle/outcome;
- browser filter/search/select/refresh/console results;
- broad-gate result, separating touched-file failures from unrelated baseline failures;
- deferred items from Global Constraints.

Do not claim end-to-end completion if the browser path was not exercised against a real `taskQueue/snapshot` and durable Work ID.

---

## Executor Stop Conditions

Stop and report evidence instead of guessing when any of these occurs:

- `QueueWorkSummaryView` or `QueueWorkView` in the checkout differs from the fields used in this plan.
- An implementation step would require changing Remote, persistence, authority, scheduler, executor, bundle composition, or Web startup.
- A requested field such as prompt, artifact, duration, or log is unavailable in `QueueWorkView`.
- Another live process owns the canonical Queue root and cannot be safely reused.
- The real Web process is not loopback-only.
- The smoke task would require credentials or external side effects beyond the exact harmless prompt.
- A broad failure is outside the changed Queue paths.

## Self-Review Checklist

- Every V1.1 product requirement maps to Task 1, 2, or 3.
- The Remote and durable status contracts remain unchanged.
- Unknown retry has explicit duplicate-effect acknowledgement and no “safe” wording.
- Failure confirmation sends the exact existing `confirm-failed` payload.
- Pending state is scoped by work ID rather than page-wide.
- Refresh failure retains authoritative last-successful data and labels it honestly.
- New JSX consumes only fields present in `QueueWorkView`.
- The plan contains no batch, analytics, task-creation, owner-editing, service-control, or artificial unknown-work scope.
- Focused checks precede the one client build and the one broad milestone.
- Real acceptance proves a durable Work ID and Remote-backed detail, not only a rendered fixture.
