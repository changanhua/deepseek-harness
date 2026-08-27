# Queue V1.1 操作台实现计划

[English](2026-08-27-queue-v1-1-operator-workbench.md) | 中文

> **面向 agent 执行者：** 必须使用配套 skill：推荐使用 `superpowers:subagent-driven-development`，也可使用 `superpowers:executing-plans`，按任务逐项执行本计划。各步骤使用复选框（`- [ ]`）跟踪状态。

**目标：** 将四态 Queue MVP 改造成可用的操作台，使操作员无需阅读原始 JSON，也无需承担意外重复执行的风险，即可找到下一个需要处理的任务、理解其最近一次尝试，并执行允许的操作。

**架构：** 保持 Queue v2 持久化、Remote schema 和公开的 `queued | running | attention | done` 投影不变。新增确定性的客户端展示投影辅助函数；刷新失败时保留陈旧数据；围绕紧凑任务列表和结构化详情窗格重建工作区。复用 `@deepseek-ai/dsh-client-ui-primitives` 提供的 `Pill`、`StateDot`、`RiskConfirmation`、`Toast`、`JsonTree` 和 `writeClipboard`；不得另建对话框、Toast、JSON 查看器或状态组件。

**技术栈：** TypeScript、React 18、CSS Modules、Cordis 客户端 slot、Vitest、Testing Library、DSH UI primitives。

**依赖：** 当前工作树中的 Queue v2 MVP，包括 `QueueTaskState`、`QueueTaskOutcome`、`QueueStore`、`taskQueue/snapshot` Remote，以及既有的 5 秒串行刷新链。保留所有无关的工作树脏改动。

**真实验收路径：** 聚焦测试通过后只构建一次客户端；在回环地址启动真实 Web profile；从真实 DSH 会话入队一个无副作用的 `agent.run@1` 任务；在 Queue 页面通过列表选择和持久生命周期刷新观察该任务。组件测试为 `attention` 裁决提供确定性证据；不得通过杀死 worker 人为制造未知尝试。

**宽泛验证预算：** Task 1-3 期间只运行聚焦 Queue 测试。Task 4 冻结实现后，`pnpm run build:lib:client`、`pnpm run lint` 和 `pnpm run doc-sync` 各运行一次；总耗时预计约为 8-15 分钟。只有在修改了对应失败涉及的文件后，才可重新运行宽泛命令。如果宽泛命令报告无关的基线失败，记录准确失败路径并停止调查。

## 全局约束

- 在当前 checkout 中工作并保留所有既有 WIP；不得 reset、clean、强制切换、删除 Queue 数据、停止不属于本次执行的服务或改写无关文件。
- 使用 `apply_patch` 修改源码和文档。
- 不得修改 `packages/task-queue/task-queue-remote/src/views.ts`、`packages/task-queue/task-queue-remote/src/index.ts`、Queue 持久化、权限、调度器、执行器、组合包组成或 Web 启动逻辑。
- 操作员投影固定为 `queued | running | attention | done`；终态结果固定为 `succeeded | failed | canceled | null`。
- 持久化的 `starting` 和 `unknown` 语义留在内部：`starting` 展示为 `running`，`unknown` 展示为 `attention`。
- `done` 是 UI 状态；`succeeded`、`failed` 和 `canceled` 是该状态内显示的结果。
- 此 UI 不得暴露 `reconcile` 或 `confirm-succeeded`。
- 将「安全重试」改为「确认重试」。未知尝试可能已经产生外部影响，因此 UI 不得宣称重试是安全的。
- 不得新增批量操作、图表、任务创建、优先级编辑、Owner 编辑、保存视图、分页、日志终端控制、产物预览或服务暂停／恢复控制。
- Owner 仅作信息展示。`ownerSessionId` 是路由元数据，不得将其呈现为授权保证。
- 实现期间只运行当前任务指定的聚焦命令。完整客户端构建、仓库 lint、文档同步和真实浏览器工作统一留到 Task 4。
- 每个交互元素都必须能通过键盘访问、保留可见焦点状态、具有无障碍名称，并且不得仅依靠颜色传达含义。
- 使用 DSH `--dsw-*` token 和既有 primitives。不得新增原始品牌颜色、表情符号图标、新依赖或新的共享 primitive。
- 同步维护中英文 README 和 locale 内容。配对文档稳定后，才可重新生成配对伴随文件。

---

## 产品约定

### 操作员主要路径

页面必须支持在不离开的情况下完成以下流程：

1. 在低紧急度任务之前看到一个 `attention` 任务。
2. 选择该任务，阅读最近的失败和尝试历史。
3. 阅读关于重复副作用的风险提示。
4. 确认风险并授权再次尝试，或输入原因并确认失败。
5. 看到行级操作进度、持久化刷新以及成功或错误消息。

### 布局

桌面端采用主从工作台。任务列表约占可用宽度的 55%，详情窗格约占 45%。CSS 宽度低于 960 像素时，两个窗格按文档顺序纵向堆叠；本版本不新增 JavaScript 视口状态或独立移动端抽屉。

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

### 排序与筛选

默认筛选仍为 `all`。先筛选候选行，再按操作紧急度对结果排序：`attention`、`running`、`queued`、`done`；同一状态内按 `updatedAt` 倒序排列，时间相同时再按 `id` 倒序排列，以保证结果确定。搜索不区分大小写，并且只匹配 `title` 或 `id`。

保留以下四个筛选项：

| 筛选 | 包含的行 |
|---|---|
| `all` | 所有行 |
| `active` | `queued` 和 `running` |
| `attention` | 仅 `attention` |
| `done` | 所有 `done`，不区分 outcome |

### 行内容

每个任务行显示一个状态点、状态文字、标题、Owner 或「无关联会话」、格式为 `attemptCount/maxAttempts` 的尝试进度，以及相对更新时间。ID 和 `kind` 移到详情窗格。状态点旁必须保留状态文字，确保颜色从来不是唯一信号。

状态和 outcome 按下表映射到既有的 `StateDot` primitive：

| UI 事实 | 状态点 |
|---|---|
| `queued` | `warning` |
| `running` | `ongoing` |
| `attention` | `error` |
| `done + succeeded` | `done` |
| `done + failed` | `error` |
| `done + canceled` | `warning` |

任务行本身用于选择任务。行操作必须与选择按钮分开，标记结构不得将一个按钮嵌套在另一个按钮中。每行只显示当前有效操作：`queued` 或 `running` 显示取消，`done + failed` 显示重试，`attention` 显示「处理」。

### 详情内容

详情窗格按以下顺序包含各部分：

1. 标题区：标题、四态标签、存在时的终态 outcome，以及复制 ID 按钮。
2. 摘要：kind、Owner、尝试进度、创建时间和更新时间。
3. 当前问题：当 `failure` 非空时，显示失败类别、消息、副作用分类和是否可重试。
4. 操作员操作：只显示对所选行有效的操作。
5. 尝试记录：序号、状态、开始时间、结束时间和失败消息。用紧凑的纵向列表显示所有尝试；不得凭空生成 `QueueWorkAttemptView` 中不存在的日志内容。
6. 结果：对象或数组输出使用 `JsonTree` 渲染；原始值显示为格式化文本；结果为空时显示本地化的无结果文案。
7. 高级信息：原生 `<details>` 元素中放置只读 `JsonTree`，其数据为 `{ work: detail }`。

### 操作安全

- 取消排队中或运行中的任务时打开 `RiskConfirmation`。运行中任务的描述说明已经发生的外部影响无法撤销；排队中任务的描述说明持久化取消完成后任务将不再执行。
- 为 `attention` 授权新的尝试时打开 `RiskConfirmation`，点明所选任务，说明上次结果未知，并要求操作员勾选确认可能出现重复外部影响。
- 重试 `done + failed` 不需要风险复选框，但在 mutation 和刷新结算前，只禁用该任务的操作。
- 确认失败要求输入去除首尾空白后非空的原因。输入为空时按钮保持禁用，本地化辅助文案说明原因。
- 待处理 mutation 只锁定匹配的 work ID。搜索、筛选、选择、刷新以及其他行的操作仍然可用。
- 成功反馈使用 `Toast`。Mutation 失败在匹配的任务行旁持续显示，并在该任务被选中时显示于详情窗格；Toast 计时器不会清除该错误。

### 刷新与空状态

刷新失败时，`QueueStore` 保留最近一次成功读取的行和详情。标题区显示最近一次成功刷新的相对时间；刷新期间显示「正在更新」。刷新错误通过横幅显示，同时保留的数据仍可操作。

各空状态使用不同文案：

| 情形 | 中文文案 |
|---|---|
| 整个队列为空 | 当前没有任务。 |
| 进行中筛选为空 | 当前没有等待或正在执行的任务。 |
| 需处理筛选为空 | 没有需要人工处理的任务。 |
| 已完成筛选为空 | 还没有已结束的任务。 |
| 搜索无匹配 | 没有匹配当前搜索的任务。 |

搜索无结果状态包含「清除搜索」按钮。筛选为空时不得建议创建任务，因为任务 admission 不属于此界面。

## 文件映射

| 文件 | 职责 |
|---|---|
| `packages/client/ui-task-queue/src/client/view-model.ts` | 纯排序、筛选、计数、相对时间和状态点映射 |
| `packages/client/ui-task-queue/tests/view-model.client.spec.ts` | 确定性的展示模型行为 |
| `packages/client/ui-task-queue/src/client/store.ts` | 串行 Remote 读取和保留的 `lastSuccessfulRefreshAt` |
| `packages/client/ui-task-queue/tests/store.client.spec.ts` | 刷新顺序、数据保留和刷新时间证据 |
| `packages/client/ui-task-queue/src/client/QueueWorkspace.tsx` | 工作区状态、列表／详情渲染、行级操作、确认和反馈 |
| `packages/client/ui-task-queue/src/client/QueueWorkspace.module.css` | 基于 token 的主从布局和响应式堆叠 |
| `packages/client/ui-task-queue/src/client/locales.ts` | 完整的中英文工作台文案 |
| `packages/client/ui-task-queue/tests/workspace.client.spec.tsx` | 无障碍操作员工作流和 Remote mutation 参数 |
| `packages/client/ui-task-queue/README.md` 和 `README.zh.md` | 当前包行为和局限 |
| `.agents/notes/implemented/architecture/2026-08-27-queue-v2-operator-mvp.md` 和 `.zh.md` | 已实现 V1.1 的决策、理由和验证义务 |

除非 `QueueWorkspace.tsx` 超过仓库 lint 的可维护性限制，否则不得创建额外组件。如果确实超过限制，只拆出 `QueueTaskDetail.tsx`；`QueueWorkspace` 继续拥有选择、待处理操作、确认和反馈状态。

---

### Task 1：确定性 Queue 展示模型

**依赖：**
- 既有的 `QueueWorkSummaryView`、`QueueTaskState` 和 `QueueTaskOutcome`，来自 `@deepseek-ai/dsh-task-queue-remote/views`。

**文件：**
- 新建：`packages/client/ui-task-queue/src/client/view-model.ts`
- 新建：`packages/client/ui-task-queue/tests/view-model.client.spec.ts`

**接口：**
- 消费：`QueueWorkSummaryView`、`QueueTaskState` 和 `StateDotState`。
- 产出：供 Task 3 使用的 `QueueFilter`、`QueueCounts`、`QueueAge`、`projectQueueRows()`、`countQueueRows()`、`queueAge()` 和 `dotFor()`。

使用以下准确导出：

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

`projectQueueRows()` 必须先复制再排序，不得修改 Remote 数组。`queueAge()` 将未来时间戳限制为零，并在 60 秒、60 分钟和 24 小时处使用向下取整转换。`dotFor()` 在 `row.state === 'done'` 且 `row.outcome === null` 时抛错，因为 Remote 投影保证终态行必有终态 outcome。

**测试策略：**
- 变更类型：新行为。
- 风险级别：聚焦。
- 证据：`view-model.client.spec.ts` 证明排序、筛选、不区分大小写的搜索、不修改输入、时间阈值以及所有状态／outcome 的状态点映射。
- 升级条件：无。

**对验收的贡献：**
- 保证每次工作区渲染都先展示紧急工作，同时不改变持久状态语义。

- [ ] **Step 1：编写排序和筛选的 RED 测试**

创建 ID 为 `attention-1`、`running-1`、`queued-1`、`done-new` 和 `done-old` 的 fixture。让 `done-new` 的 `updatedAt` 晚于 `done-old`；按紧急度倒序传入这些行；断言：

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

- [ ] **Step 2：编写计数、时间和状态点的 RED 测试**

断言四个筛选项的准确计数。断言 `queueAge()` 在 59 秒、60 秒、59 分钟、60 分钟、23 小时、24 小时和未来时间戳时的结果。断言产品约定表中的每一行。断言 `done + null` 抛出 `Queue done row requires an outcome`。

- [ ] **Step 3：运行 RED 测试**

运行：

```powershell
pnpm vitest run packages/client/ui-task-queue/tests/view-model.client.spec.ts
```

预期：失败，因为 `../src/client/view-model.ts` 不存在。

- [ ] **Step 4：实现最小纯辅助函数**

使用固定的紧急度映射：

```ts
const STATE_RANK: Readonly<Record<QueueTaskState, number>> = {
  attention: 0,
  running: 1,
  queued: 2,
  done: 3,
}
```

先生成标准化的小写查询，再进行筛选，最后对返回的副本排序。这些辅助函数不得导入 React 或在内部访问 `Date.now()`。

- [ ] **Step 5：运行聚焦测试**

运行 Step 3 的命令。预期：一个测试文件通过，所有断言为绿色。

- [ ] **Step 6：评审 Task 1 diff**

确认仅修改 Task 1 的两个文件；所有导出都有简洁 JSDoc；未引入 `any`；Remote schema 未被触碰。

---

### Task 2：保留刷新证据

**依赖：**
- Task 1 与本任务相互独立，但必须先完成，使后续工作区工作消费稳定的辅助函数。
- 既有的串行 `QueueStore.refresh()` 链。

**文件：**
- 修改：`packages/client/ui-task-queue/src/client/store.ts`
- 修改：`packages/client/ui-task-queue/tests/store.client.spec.ts`

**接口：**
- 消费：既有 `QueueRemoteFace.snapshot()` 结果。
- 产出：供工作区标题使用的 `QueueSnapshot.lastSuccessfulRefreshAt: string | null`。

只新增一个快照字段：

```ts
export interface QueueSnapshot {
  // existing fields stay unchanged
  lastSuccessfulRefreshAt: string | null
}
```

仅在 `snapshot()` 成功返回后，将其设置为 `new Date().toISOString()`。刷新失败时更新 `refreshing` 和 `error`，但保留 `stats`、`rows`、`selectedId`、`detail` 和 `lastSuccessfulRefreshAt`。

**测试策略：**
- 变更类型：刷新／并发边界的行为变更。
- 风险级别：边界。
- 证据：既有并发刷新测试保持通过；新增的先成功后失败测试证明数据和时间戳得到保留。
- 升级条件：Task 3 消费该字段后才运行工作区测试。

**对验收的贡献：**
- 连接失败后，页面能够诚实报告陈旧但可用的数据。

- [ ] **Step 1：新增先成功后失败的 RED 测试**

使用 `vi.useFakeTimers()` 和 `vi.setSystemTime('2026-08-27T10:00:00.000Z')`。第一次返回包含 `work-1` 行的成功快照，下一次 `snapshot()` 以 `new Error('offline')` 拒绝。第二次刷新后断言：

```ts
expect(store.getSnapshot()).toMatchObject({
  rows: [expect.objectContaining({ id: 'work-1' })],
  lastSuccessfulRefreshAt: '2026-08-27T10:00:00.000Z',
  refreshing: false,
  error: 'offline',
})
```

在 `afterEach()` 中恢复真实计时器，避免该测试泄漏时钟状态。

- [ ] **Step 2：运行 RED store 测试**

运行：

```powershell
pnpm vitest run packages/client/ui-task-queue/tests/store.client.spec.ts
```

预期：失败，因为缺少 `lastSuccessfulRefreshAt`。

- [ ] **Step 3：实现快照字段**

向 `EMPTY` 添加 `lastSuccessfulRefreshAt: null`。在 `read()` 成功分支中，与 `stats`、`rows` 和 `detail` 一起，在同一个 `#set()` 调用中设置 `lastSuccessfulRefreshAt`。不得改变 Remote 调用次数，也不得移除串行 `#refreshTail`。

- [ ] **Step 4：运行聚焦 store 测试**

运行 Step 2 的命令。预期：并发刷新测试、未知裁决测试和保留刷新测试全部通过。

- [ ] **Step 5：评审 Task 2 diff**

确认刷新失败不会清空行或详情；时间戳只在成功时前进；没有计时器或轮询逻辑移入 store。

---

### Task 3：可用的主从工作区

**依赖：**
- Task 1 提供唯一的排序／筛选／计数／时间／状态点辅助函数。
- Task 2 提供 `lastSuccessfulRefreshAt`。
- 既有 `QueueStore.cancel()`、`retry()`、`resolveUnknown()`、`select()` 和 `refresh()` 方法继续作为唯一 mutation 和读取入口。

**文件：**
- 修改：`packages/client/ui-task-queue/src/client/QueueWorkspace.tsx`
- 修改：`packages/client/ui-task-queue/src/client/QueueWorkspace.module.css`
- 修改：`packages/client/ui-task-queue/src/client/locales.ts`
- 修改：`packages/client/ui-task-queue/tests/workspace.client.spec.tsx`

**接口：**
- 消费：`projectQueueRows()`、`countQueueRows()`、`queueAge()`、`dotFor()`、`QueueStore` 和既有 UI primitives。
- 产出：完整的 V1.1 浏览器工作台和本地化无障碍名称。

在 `QueueWorkspace.tsx` 中持有以下本地状态类型：

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

为所选 attention 任务使用一个 `failureReason` 字符串。`snapshot.selectedId` 改变时，清空该字符串和所有任务级错误。为 `RiskConfirmation` 使用一个 `acknowledged` 布尔值；确认框关闭或其 work ID 改变时重置该值。

导入并使用以下既有 primitives：

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

不得调用 `window.confirm()`，也不得通过始终可见的原始 `<pre>` 渲染结果 JSON。

**测试策略：**
- 变更类型：涉及敏感副作用的用户可见新行为。
- 风险级别：边界。
- 证据：Testing Library 测试证明无障碍选择、紧急度排序、确认勾选、准确 Remote 输入、原因校验、行级 pending、保留刷新错误和搜索无结果恢复。
- 升级条件：客户端构建完成后，在 Task 4 执行真实浏览器证明。

**对验收的贡献：**
- 完成从发现紧急任务到持久裁决反馈的操作员路径。

- [ ] **Step 1：用 V1.1 RED 测试替换既有 attention 测试**

创建一个可复用的 `makeSnapshot()` fixture 构造器，返回完整 `QueueSnapshot` 并接受局部覆盖。创建一个 `makeQueue()` fake，返回兼容 `QueueStore` 的对象和 spies。所有时间戳保持固定。

新增以下准确测试：

1. `orders attention before running, queued, and done and exposes four filter counts`
2. `selects a row and renders owner, kind, attempts, failure, and result in the detail pane`
3. `requires risk acknowledgement before authorizing an attention retry`
4. `requires a trimmed reason before confirming an attention task failed`
5. `disables only the work item whose mutation is pending`
6. `keeps stale rows visible beside a refresh error and last-successful age`
7. `clears a search with no matching tasks`

确认重试测试中，点击「确认重试」，断言对话框存在，断言确认按钮禁用，点击确认复选框，再点击已启用的确认按钮，然后断言：

```ts
expect(resolveUnknown).toHaveBeenCalledWith('attention-1', {
  kind: 'authorize-retry',
})
```

确认失败测试中，输入 `  output could not be verified  ` 并断言：

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

行级 pending 测试中，保持 `cancel('running-1')` promise 未结算，断言该任务的操作已禁用，并断言 `failed-1` 的重试按钮仍启用。

- [ ] **Step 2：运行 RED 工作区测试**

运行：

```powershell
pnpm vitest run packages/client/ui-task-queue/tests/workspace.client.spec.tsx
```

预期：失败，因为 MVP 缺少 CSS Module 布局、结构化详情、`RiskConfirmation`、行级 pending、保留刷新文案和 V1.1 标签。

- [ ] **Step 3：替换工作区结构，不改变 store 或 Remote 约定**

按以下组件顺序实现：

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

四个筛选项使用 `Pill` 并保留 `aria-pressed`。列表行渲染为 `<li>`，包含一个选择 `<button>` 和同级操作区；不得将 `Button` 放入选择按钮。所选行按钮设置 `aria-current="true"`。

每次渲染只调用一次 `Date.now()` 来格式化所有可见时间。不得新增第二个计时器：既有的 5 秒刷新已经会触发重新渲染。

- [ ] **Step 4：实现行级操作**

创建一个 `act(workId, kind, action, successMessage)` 辅助函数：设置 `pendingAction`；清除匹配错误；等待既有 store 方法；仅在 `result.ok` 时发出 `Toast`；在 `!result.ok` 时保存 `ActionError`；在 `finally` 中只在 pending work ID 和操作仍匹配时清除 pending。

取消和 attention 重试打开 `RiskConfirmation`；确认勾选后才调用 `act()`。失败任务的重试直接调用 `act()`。确认失败时，先去除原因首尾空白，再构造既有 `QueueUnknownResolutionInput`。

不得因为另一行处于 pending 而禁用页面刷新按钮。仅在 `snapshot.refreshing` 为 true 时禁用刷新按钮。

- [ ] **Step 5：实现结构化详情和复制**

按产品约定的顺序渲染各详情部分。复制 ID 时，等待 `writeClipboard(snapshot.detail.id)` 完成，并根据其布尔返回值发出本地化成功或失败反馈；不得假定剪贴板已经接受写入。对象／数组结果使用 `JsonTree`；高级信息使用 `{ work: snapshot.detail }`。`<details>` 默认保持折叠。

不得渲染 `QueueWorkView` 中不存在的字段；尤其不得凭空生成执行器名称、提示词、优先级、产物、耗时或日志。

- [ ] **Step 6：用实际 V1.1 selector 替换 CSS Module**

当前样式表包含未使用的服务控制、故障状态、产物、日志、批量操作和旧原始状态 selector。删除这些 selector，只保留新 JSX 使用的类。

必须满足以下布局规则：

- `.workspace`：纵向 flex、`min-height: 0`、18-20px padding、12px gap。
- `.head`：左侧显示标题和刷新元数据，刷新按钮靠右。
- `.shell`：双列 grid `minmax(360px, 1.2fr) minmax(320px, 0.8fr)`，间距 12px。
- `.listPane` 和 `.detailPane`：token 边框／背景、12px 圆角、`min-width: 0`、内部滚动。
- `.row`：最小高度 52px，选中时有可见的内嵌强调线。
- `.rowSelect`：透明的全宽选择按钮，具有可见 `:focus-visible` 焦点环。
- `.rowActions`：同级操作，间距至少 8px。
- `.attentionPanel` 和 `.failureBox`：边框和标题处理不依赖图标／文字颜色。
- 在 `max-width: 960px` 下，`.shell` 变为单列，两个窗格都不得使用固定定位。
- 在 `prefers-reduced-motion: reduce` 下，抑制非必要 transition 和动画；`StateDot` primitive 自行负责其 reduced-motion 行为。

除 ID 使用仓库既有等宽字体栈外，不得硬编码字体。存在 `--dsw-*` token 时，不得使用原始十六进制颜色。

- [ ] **Step 7：用 V1.1 文案替换陈旧 locale 键**

保留 `QueueNavEntry` 使用的键。如果 `rg` 证明没有其他文件使用，则删除工作区专用的服务暂停／恢复、批量操作、了结、提示词、优先级、产物和日志键。

至少为以下键新增完整中英文配对：

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

使用「确认重试」／“Confirm retry”；不得保留「安全重试」／“Safe retry”。

- [ ] **Step 8：运行聚焦 Queue 客户端切片**

运行：

```powershell
pnpm vitest run packages/client/ui-task-queue/tests/view-model.client.spec.ts packages/client/ui-task-queue/tests/store.client.spec.ts packages/client/ui-task-queue/tests/workspace.client.spec.tsx packages/client/ui-task-queue/tests/nav.client.spec.ts packages/client/ui-task-queue/tests/apply.client.spec.ts
```

预期：五个文件通过。如果测试失败，在理解其状态所有者之前只重新运行该文件；不得启动客户端构建或仓库级检查。

- [ ] **Step 9：运行目标文件 lint**

运行：

```powershell
pnpm exec oxlint packages/client/ui-task-queue/src/client/view-model.ts packages/client/ui-task-queue/src/client/store.ts packages/client/ui-task-queue/src/client/QueueWorkspace.tsx packages/client/ui-task-queue/src/client/locales.ts packages/client/ui-task-queue/tests/view-model.client.spec.ts packages/client/ui-task-queue/tests/store.client.spec.ts packages/client/ui-task-queue/tests/workspace.client.spec.tsx
```

预期：退出码为 0，没有发现问题。

---

### Task 4：当前状态文档和真实验收

**依赖：**
- Task 1-3 的聚焦测试和目标 lint 均为绿色。
- 除本任务检查发现的问题外，实现 diff 已冻结。

**文件：**
- 修改：`packages/client/ui-task-queue/README.md`
- 修改：`packages/client/ui-task-queue/README.zh.md`
- 重新生成：`packages/client/ui-task-queue/README.i18n.yaml`
- 修改：`.agents/notes/implemented/architecture/2026-08-27-queue-v2-operator-mvp.md`
- 修改：`.agents/notes/implemented/architecture/2026-08-27-queue-v2-operator-mvp.zh.md`
- 重新生成：`.agents/notes/implemented/architecture/2026-08-27-queue-v2-operator-mvp.i18n.yaml`

**接口：**
- 消费：Task 1-3 已实现的 V1.1 行为和测试名称。
- 产出：当前包文档、持久决策理由、真实浏览器证据和最终验证输出。

**测试策略：**
- 变更类型：文档和真实 UI／API 边界验收。
- 风险级别：宽泛里程碑。
- 证据：配对文档、聚焦 Queue 测试、一次客户端构建、一个真实模型支撑的 Queue 生命周期、浏览器交互、控制台／alert 检查，以及一次宽泛门禁运行。
- 升级条件：只有修改了对应失败涉及的文件后，才重新运行宽泛门禁；无关基线失败只报告，不修复。

**对验收的贡献：**
- 证明设计已在真实 Web 组合中实现，而不只是通过 jsdom fixture 渲染。

- [ ] **Step 1：更新当前状态的包文档**

README 的 Workspace 小节必须说明：

- 四个公开状态和终态 outcome；
- 紧急度排序、四个筛选项和标题／ID 搜索；
- 主从结构，以及刷新失败后保留陈旧数据；
- 行级取消／重试和 attention 裁决；
- 重试未知任务前明确确认重复副作用风险；
- 结构化尝试和结果检查；
- 轮询仍是刷新机制。

Known Limitations 小节只保留实际延后项：浏览器事件转发、产物预览、`confirm-succeeded` 结果编辑、批量操作，以及真实数据量要求时的服务端分页。不得将 V1.1 行为描述为未来工作。

- [ ] **Step 2：更新已实现 Agent Note**

Agent Note 保持现在时。记录以下持久决策：

- 四态投影继续小于持久状态词汇；
- 紧急度排序是客户端投影，不是持久化优先级；
- 未知任务重试称为「确认重试」，绝不称为「安全重试」；
- Owner 仍是路由元数据，而非授权证明；
- 行级 pending 保留无关的操作员工作；
- 复用 `RiskConfirmation`、`Toast` 和 `JsonTree`，不创建包内等价物；
- 批量操作、分析、`confirm-succeeded` 和任务创建有意保持缺失。

在 Alternatives Considered 中更新被否决的卡片网格、额外 UI 状态、始终可见的原始 JSON、全局 pending 锁、原生 `window.confirm` 和批量控制。已实现 Agent Note 中不得保留验收检查清单。

- [ ] **Step 3：只重新生成已修改的翻译配对**

运行：

```powershell
pnpm run verify-translation-pairing --write packages/client/ui-task-queue/README.md .agents/notes/implemented/architecture/2026-08-27-queue-v2-operator-mvp.md
```

预期：两个点名的中英文配对均被记录，两个 `.i18n.yaml` 文件更新。

- [ ] **Step 4：重新运行冻结的聚焦切片**

运行 Task 3 Step 8 的测试命令和 Task 3 Step 9 的 lint 命令各一次。预期：二者退出码均为 0。

- [ ] **Step 5：只构建一次客户端**

运行：

```powershell
pnpm run build:lib:client
```

预期：退出码为 0，重新生成的客户端产物包含 Queue 工作区。由于本计划不修改 host 或 Remote 源码，不得运行 `build:lib:host`。

- [ ] **Step 6：安全启动或复用真实 Web profile**

首先检查端口 3080 和 Queue owner lock，不得改变二者。如果另一个实时进程持有 canonical Queue root，不得停止该进程。只有当既有 Web 进程的命令行指向本 checkout，并且它在 Task 4 客户端构建完成后启动，才可复用；否则报告 owner 并等待指示。

没有 owner 时，启动：

```powershell
pnpm dsh web --no-open
```

记录新 PID、命令行、`127.0.0.1:3080` listener 和启动 URL。Web 进程不得宣告或绑定 LAN 地址。

- [ ] **Step 7：运行最早的真实 Queue 纵向切片**

使用应用内浏览器打开 `http://127.0.0.1:3080/`。在真实 DSH 会话中，使用以下准确意图请求一个无副作用的持久 worker 任务：

```text
Enqueue one agent.run@1 task titled QUEUE-V1.1-SMOKE. Its prompt is: Return exactly QUEUE-V1.1-SMOKE and do not modify files, run commands, or call external services.
```

打开 Queue 并记录真实 Work ID。验证任务出现在列表中；可以通过 `QUEUE-V1.1-SMOKE` 和 ID 找到；可以被选择；并且通过 `taskQueue/snapshot` 暴露 Owner、kind、尝试、时间戳和 outcome。至少观察一次生命周期刷新；不得仅根据 HTTP 200 或文字推断成功。

不得为了制造 `attention` 而杀死 worker。除非已有 attention 任务自然存在，否则未知裁决以确定性组件测试作为验收证据。

- [ ] **Step 8：运行浏览器交互验收**

在真实页面中验证以下全部内容：

- 筛选计数正确渲染，选择各筛选项会改变可见列表。
- 搜索无结果文案和「清除搜索」有效。
- 选择冒烟任务会更新详情窗格，不发生页面跳转。
- 手动刷新保留所选任务。
- 结果和高级部分展开后，页面不会横向溢出。
- 使用 Tab 键可以按照视觉顺序到达筛选项、搜索、任务选择、有效行操作、详情操作和刷新。
- 浏览器不出现 alert，控制台没有新增错误。
- 刷新浏览器页面后，Queue 页面仍可用，并显示当前持久任务事实。

如果将创建包含用户可见 GUI 变更的 PR，先阅读 `.agents/skills/record-browser-gif/SKILL.md`，再从该真实服务和冒烟任务录制筛选、搜索、选择与详情流程。打开或更新 PR 前，按照该 skill 发布优化后的 GIF。

- [ ] **Step 9：宽泛门禁只运行一次**

运行：

```powershell
pnpm run lint
pnpm run doc-sync
git diff --check -- packages/client/ui-task-queue .agents/notes/implemented/architecture/2026-08-27-queue-v2-operator-mvp.md .agents/notes/implemented/architecture/2026-08-27-queue-v2-operator-mvp.zh.md docs/superpowers/plans/2026-08-27-queue-v1-1-operator-workbench.md
```

预期：修改过的 Queue 文件和文档通过。如果仓库级 lint 或 doc-sync 只在无关路径失败，保留输出，将其识别为基线／WIP，不得修复或重新运行。

- [ ] **Step 10：最终证据报告**

报告：

- 按展示模型、store、工作区、测试和文档分组的修改文件；
- 聚焦测试文件数和测试数；
- 目标 lint 结果；
- 客户端构建结果；
- 真实 PID／listener／URL；
- 冒烟 Work ID 和观察到的生命周期／outcome；
- 浏览器筛选／搜索／选择／刷新／控制台结果；
- 宽泛门禁结果，区分修改文件失败和无关基线失败；
- 全局约束中的延后项。

如果没有针对真实 `taskQueue/snapshot` 和持久 Work ID 执行浏览器路径，不得声称端到端完成。

---

## 执行者停止条件

出现以下任一情况时，停止并报告证据，不得猜测：

- checkout 中的 `QueueWorkSummaryView` 或 `QueueWorkView` 与本计划使用的字段不同。
- 某个实现步骤需要修改 Remote、持久化、权限、调度器、执行器、组合包组成或 Web 启动逻辑。
- 所需字段（例如提示词、产物、耗时或日志）在 `QueueWorkView` 中不可用。
- 另一个实时进程持有 canonical Queue root，并且无法安全复用。
- 真实 Web 进程并非只绑定回环地址。
- 冒烟任务需要准确无副作用提示词之外的凭据或外部副作用。
- 宽泛失败位于已修改 Queue 路径之外。

## 自查清单

- 每项 V1.1 产品要求都映射到 Task 1、2 或 3。
- Remote 和持久状态约定保持不变。
- 未知任务重试具有明确的重复副作用确认，并且不使用「安全」措辞。
- 确认失败发送准确的既有 `confirm-failed` payload。
- Pending 状态按 work ID 隔离，而非锁定整个页面。
- 刷新失败保留权威的最近一次成功数据，并诚实标记其状态。
- 新 JSX 只消费 `QueueWorkView` 中存在的字段。
- 计划不包含批量操作、分析、任务创建、Owner 编辑、服务控制或人为制造未知工作。
- 聚焦检查先于一次客户端构建和一次宽泛里程碑。
- 真实验收证明一个持久 Work ID 和 Remote 支撑的详情，而不只是渲染 fixture。
