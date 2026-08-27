# Queue v2 `operation.run@1` 实施计划

[English](2026-08-27-queue-v2-operation-run.md) | 中文

**Goal / DoD:** 在现有 Queue v2 WIP 之上增加一个默认不挂载的 `operation.run@1` WorkKind，使 live Agent 只能提交宿主 allowlist 中的固定 operation，并通过真实受管子进程、持久 Work/Attempt/Result、owner Notification、显式结果读取和 Queue Workspace 刷新完成一条可验证纵切；任何模型输入都不能选择 executable、argv、cwd、env、shell、profile、model 或 credential。

**Architecture:** 新建 `operation-run-task-queue` WorkKind Bridge，复用 `ctx.taskQueue` 的持久调度和 `ctx.subprocess` 的进程树生命周期；新建独立的 `tool-operation-run-task-queue` Consumer，从 live Agent Session 派生 authority。宿主配置在 admission 时把 `operationId` 解析为不可变、无秘密的执行事实；`dsh-base` 只预留一个 `operation-run` 资源单位，`apps/cli` 只保证 opt-in package 可解析，默认组合不挂载 Handler 或 Consumer；Queue core、Jobs、Goal、Workflow、Subagent 和现有 DSH/image Handler 不依赖该能力。

**Dependencies:** 当前 checkout 中的 Queue v2、owner delivery、restricted DSH worker、image Batch 和 operator workbench WIP必须保留；[Queue v2 闭环计划](2026-08-27-queue-v2-owner-delivery-worker-closure.zh.md)的已完成契约是本计划基线。开始实现前必须通过下方 Baseline Gate；如果 Queue v2 自身失败，先在其 owning plan 中收口，不把修复混入本功能。该能力是 opt-in package，不进入 `dsh-base` 默认组合。

**Real Acceptance Path:** 用真实 Loader 组合 `LocalTaskQueue + LocalSubprocessRuntime + operation.run Handler + Agent admission Consumer + generic Queue result/delivery`，配置一个 test-only `fixture.echo` operation，实际启动本机 Node 进程并持久化固定输出；关闭并重新打开 Queue root 后，从 owner Session 显式读取 typed result并证明 Notification 只含稳定引用。随后用同一 test-only composition 启动一个 `fixture.wait` operation，在真实 Queue Workspace 中取消它并刷新确认 authoritative canceled 状态，无 alert 和 console error。

**Broad Verification Budget:** Tasks 1-4 只运行具名测试和局部 typecheck。真实 Loader/process 和浏览器纵切完成后冻结代码，运行一次 `pnpm run build:lib:host`、一次 `pnpm run build:lib:client`、一次 `pnpm run build:web`、一次 focused Queue suite、一次 `pnpm run lint`、一次 `pnpm run doc-sync`、一次 Agent Note/package gate 和一次 owned-path `git diff --check`；预计 25-40 分钟。只有修改了失败命名的 owner path 后才重跑对应 broad command；全局命令中的无关 dirty-checkout failure 只作为观察结果记录，不声明全仓绿色，也不扩散修复。

## Global Constraints

- 保留当前 dirty checkout、未跟踪 Queue/image/evidence 文件、live 服务和 Queue data；不得 reset、clean、切换分支、删除 Queue root、停止无关进程或吸收无关 WIP。
- `operation.run@1` v1 caller intent 只有 `operationId`；不接受 generic JSON input、动态参数、脚本路径或 argv。需要参数的业务必须用新的具名 operation definition，或在第二个真实 consumer 证明需要后另行修订契约。
- operation definition 来自受信宿主配置，必须包含显式 `revision`；admission 持久化完整 resolved facts，因此 config reload 不改变已 admitted WorkItem。
- operation definition 不接受 `env`，argv 不得包含 credential value；插件 fail loud 拒绝结构可识别的 credential carrier，任意 opaque string 是否为秘密仍由受信任的有限 host allowlist 评审；子进程只获得 `ctx.subprocess` 的 scrubbed parent environment。
- caller、tool result、Notification、Remote 和 UI 都不得展示 resolved argv、cwd、stderr 全文、spill path 或 credential-shaped material。
- `prepare()` 只验证既有 cwd 和无副作用事实；不得创建 workspace、下载依赖或执行命令。
- `start()` 是唯一副作用边界，必须同步返回 `LiveAttempt`；进程、timeout timer、取消和 settlement 由一个 operation-local lifecycle owner 收敛。
- 只有 prepare/spawn 未开始副作用的失败可以自动重试；非零退出、timeout、已启动后失联和无法证明的取消不得自动重试。
- Queue core 不新增 operation-specific API；通用 `task_queue_result` 和 owner delivery 原样复用。
- Agent Consumer 只能从 live Agent Session 获得 `AgentWorkQueue`；operator facade 不新增 process admission。
- 新 package 不作为 `dsh-base`、web 或 standard preset 的活跃 Cordis row；`dsh-base` 的 Queue `resourceCapacity` 只预留 `operation-run: 1`，`apps/cli/package.json` 只把两个 package放入安装解析闭包。真实和 Loader 测试使用显式 test composition；README 提供同时插入 Bridge/Consumer rows和完整容量的profile opt-in配置。
- 不恢复 HEAD 的 `dsh/claude/codex/opencode/arkcli/node/shell` executor selector，不提供兼容 shim。
- 不实现 Agent Provider 路由、automatic Goal continuation、multi-host scheduling、generic Artifact Store、服务端分页或实时 Queue event push。
- 文档每段一条物理行；paired README、subsystem doc 和 Agent Note 同步更新并重新记录 translation pairing。

## Frozen Contract

`operation-run-task-queue` 在自身 package root 扩展 `WorkKindMap`，不修改 Queue core 类型。

```ts ignore-check
export interface OperationRunIntent {
  readonly operationId: string
}

export interface ResolvedOperationRun {
  readonly operationId: string
  readonly revision: string
  readonly argv: readonly string[]
  readonly cwd: string
  readonly resource: string
  readonly units: number
  readonly maxAttempts: number
  readonly collectBytes: number
  readonly resultBytes: number
  readonly failureTailBytes: number
  readonly graceMs: number
  readonly timeoutMs: number
}

export type PreparedOperationRun = ResolvedOperationRun

export interface OperationRunOutput {
  readonly operationId: string
  readonly revision: string
  readonly summary: string
  readonly stdout?: {
    readonly text: string
    readonly truncated: boolean
  }
}

declare module '@deepseek-ai/dsh-task-queue' {
  interface WorkKindMap {
    'operation.run@1': WorkKindDefinition<
      OperationRunIntent,
      ResolvedOperationRun,
      PreparedOperationRun,
      OperationRunOutput
    >
  }
}
```

Bridge config 以 `operationId` 为 record key，并使用完整 definition；插件加载时一次性验证全部 definition，任何空 id/revision/description/argv/cwd/resource、非正整数、`resultBytes > collectBytes`、`failureTailBytes > collectBytes`、重复 revision identity 或 credential-shaped config field 都使整个插件 fail loud。

```ts ignore-check
export interface OperationDefinition {
  readonly revision: string
  readonly description: string
  readonly argv: readonly string[]
  readonly cwd: string
  readonly resource: string
  readonly units: number
  readonly maxAttempts: number
  readonly collectBytes: number
  readonly resultBytes: number
  readonly failureTailBytes: number
  readonly graceMs: number
  readonly timeoutMs: number
}

export interface Config {
  readonly operations: Readonly<Record<string, OperationDefinition>>
}
```

Agent tools固定为 `operation_run_enqueue` 和 `operation_run_enqueue_batch`。单项接受 `title`、`operationId`、`idempotencyKey`；Batch item 接受 `title`、`operationId`，Batch 另接受 `idempotencyKey` 和正整数 `maxParallel`。工具 schema 不含 execution internals。

## Failure and Result Matrix

| Path | Durable outcome | `category` | `sideEffect` | Auto retry |
| --- | --- | --- | --- | --- |
| 未知或空 `operationId` | admission reject，无 WorkItem | 不持久化 | `not-started` | 否 |
| definition 或 cwd 在 prepare 失败 | `failed` | Queue-owned `prepare-threw` | `not-started` | 由已有 Queue policy 在 attempt 未耗尽时允许 |
| `ctx.subprocess.spawn()` 同步抛错或 `done` 报 spawn-level failure | `failed` | `operation-spawn` | `not-started` | 在 attempt 未耗尽时允许 |
| exit code 非 0 或 signal exit | `failed` | `operation-exit` | `started` | 否 |
| operation timeout | `failed` | `operation-timeout` | `started` | 否 |
| owner/operator cancel，已 latch cancel reason 且 `waitForExit()` 证明整棵进程树退出 | `canceled` | 无 | 已由 Queue 记录 cancel intent | 否 |
| cancel/timeout 后无法证明整棵进程树退出 | `unknown + Attention` | `operation-quiescence` | `unknown` | 仅 operator authorize-retry |
| start 后 running append 失败、crash 或 shutdown 无法证明 settlement | `unknown + Attention` | Queue recovery/shutdown category | `unknown` | 仅 operator authorize-retry |
| exit 0 | `succeeded + OperationRunOutput` | 无 | `started` | 不适用 |

成功 stdout 通过 `TextRetainer` 按 `resultBytes` 取 head；空 stdout 只产生 summary。失败只保留按 `failureTailBytes` 限界的 stderr tail，且不持久化 spill path。Notification 只复用现有 Work/Attempt/Result id；模型必须调用 `task_queue_result` 才能读取 output。

## File Map

| Area | Files | Owner |
| --- | --- | --- |
| Contract and Bridge | `packages/task-queue/operation-run-task-queue/{package.json,tsconfig.json,src/types.ts,src/index.ts,src/invariant.ts,tests/**}` | WorkKind、config、subprocess lifecycle、bounded output |
| Agent Consumer | `packages/task-queue/tool-operation-run-task-queue/{package.json,tsconfig.json,src/index.ts,src/invariant.ts,tests/**}` | Agent authority、single/Batch admission schema |
| Queue vertical | `packages/task-queue/task-queue-local/tests/operation-v2-vertical.spec.ts` | durable Work/Attempt/Result/Notification、reopen |
| Real fixtures | `packages/task-queue/operation-run-task-queue/tests/fixtures/{emit-operation.mjs,wait-operation.mjs,exit-zero-on-release.mjs}` | 真实 Node stdout、进程树 cancellation 与 exit-zero race fixture |
| Browser acceptance | `apps/web/tests/task-queue-workspace.e2e.ts` | 真实 Task Queue Workspace、Remote action、refresh、console |
| Runtime availability | `apps/cli/package.json`、`pnpm-lock.yaml` | 两个 opt-in package可被已发布CLI/Profile Loader解析，但不自动挂载 |
| Capacity and shared wiring | `packages/bundle/base/cordis.patch.yml`、`packages/bundle/base/tests/base.spec.ts`、`tsconfig.base.json`、`tsconfig.host.json` | `operation-run: 1`默认容量、package aliases、project refs |
| Test composition | 新 package Loader fixture或等价test-only `cordis.yml` | 显式Bridge/Consumer rows、test operations和Queue完整容量 |
| Package docs | 两个新 package 的 `README.md`、`README.zh.md`、`README.i18n.yaml` | config、semantics、limitations、Model Experience |
| Durable rationale | `.agents/notes/{proposed,implemented}/feature/2026-08-27-queue-operation-run.{md,zh.md,i18n.yaml}` | 当前设计、alternatives、verification evidence |
| Subsystem and guidance | `docs/subsystems/task-queue.{md,zh.md,i18n.yaml}`、`.agents/skills/dsh-task-queue/SKILL.md` | optional WorkKind composition 和使用边界 |
| Generated projections | tool/config/module/Cordis catalogs | 只由 repository generators 更新 |

## Delegation Strategy

| Wave | Owner | Exclusive scope | Input contract | Deliverable | Root verification |
| --- | --- | --- | --- | --- | --- |
| 0 | Root | Baseline、Frozen Contract、proposed Agent Note、`operation-run-task-queue/src/types.ts` 和 shared workspace refs | 本计划 Frozen Contract | 可供并行实现消费的类型与决策 | public typecheck、changed-file ownership |
| 1A | Worker A | `packages/task-queue/operation-run-task-queue/` 中除 Root 已冻结文件外的 runtime/tests/README | `OperationRun*` types、Config、failure matrix | Bridge、subprocess lifecycle、handler tests | Root 复跑 handler tests并检查 resolved facts 无秘密 |
| 1B | Worker B | `packages/task-queue/tool-operation-run-task-queue/` | `operation.run@1` intent 和 tool names | Agent single/Batch Consumer 与 schema tests | Root 检查无 executor/argv/cwd/env/profile/model/credential 字段 |
| 2 | Root | `task-queue-local` vertical、`apps/cli/package.json`、base capacity/test、workspace refs、lockfile、docs、generated artifacts | Wave 1 packages | integrated Loader/process vertical 和完整 source/runtime graph | `assertEntriesLoaded`、focused suite、real evidence、generated diff |
| 3 | Root | `apps/web/tests/task-queue-workspace.e2e.ts`、最终 build/gates | integrated opt-in test composition | browser cancellation/refresh evidence | screenshot/DOM assertions、alert/console、authoritative Remote state |
| 4 | One reviewer | 最终 materially changed diff，只读 | frozen plan、diff、test evidence | 一轮 correctness/security/regression findings | Root只处理有新证据的 finding，不启动递归复审 |

实现时不得递归委派；Wave 1 之前先冻结 shared types。Worker 不修改 bundle、root tsconfig、lockfile、Queue core、browser test 或彼此 package。Root 持有 integration、真实运行、最终验证和完成声明。

## Baseline Gate

执行新功能前只读记录 `git status --short`、HEAD、Queue v2相关 dirty paths和当前 listener，不停止任何进程。随后运行一次现有核心基线：

```powershell
pnpm vitest run packages/task-queue/task-queue/tests packages/task-queue/task-queue-local/tests packages/task-queue/task-queue-executor-dsh/tests packages/task-queue/tool-task-queue/tests packages/task-queue/tool-agent-run-task-queue/tests packages/image/image-generation-task-queue/tests packages/image/tool-image-generation-task-queue/tests
git diff --check -- packages/task-queue packages/image packages/client/ui-task-queue packages/bundle/base packages/bundle/web-app apps/cli
```

预期：现有 Queue v2 focused suite 和 target diff check 通过。若失败位于本计划尚未修改的 Queue v2 owner path，记录精确测试和 owner，停止 `operation.run@1`；不得把 Queue v2 release repair混入本功能。

---

### Task 1: 冻结 opt-in operation contract

**Dependencies:** Baseline Gate通过。

**Ownership:** 创建 `operation-run-task-queue` package skeleton、`src/types.ts`、public typecheck和 proposed Agent Note triplet；修改 `tsconfig.base.json`、`tsconfig.host.json`使冻结类型可编译。Root独占这些文件直到 Wave 1开始。

**Interfaces:** 消费 Queue v2 `WorkKindDefinition/WorkHandler/JsonValue`；产出 Frozen Contract 中的 types、Config和不允许 caller execution controls的契约。

**Verification:** 新行为和公共契约；先让 `tests/public-api.typecheck.ts`及 config validation tests对缺失类型/实现失败，再用 `pnpm exec tsc -b packages/task-queue/operation-run-task-queue/tsconfig.json`证明类型闭合。若契约需要 caller动态参数、env、artifact或新的 Queue core字段，停止并修订设计，不在实现中临时扩张。

**Acceptance contribution:** 为两个并行 package提供唯一输入/输出和失败语义，防止重建旧 executor selector。

1. Agent Note记录为何复用 `ctx.subprocess`、为何不复用 HEAD adapters、为何 v1 intent 只有 `operationId`，以及 opt-in composition非目标。
2. package type surface只导出 Frozen Contract；`src/types.ts`不含 runtime值。
3. config RED覆盖空值、整数边界、字节预算关系、空 argv和不允许的 env-like字段；public typecheck证明 `OperationRunIntent`不能接受 argv/cwd/env/shell/profile/model/credential。

### Task 2: 实现 `operation.run@1` Bridge

**Dependencies:** Task 1冻结 types和Agent Note decision。

**Ownership:** Wave 1A独占 `packages/task-queue/operation-run-task-queue/src/index.ts`、`src/invariant.ts`、handler tests、fixtures和本 package README；不修改 shared files。

**Interfaces:** 消费 `ctx.taskQueue.registerHandler()`、`ctx.subprocess.spawn()`、`TextRetainer`和 Task 1 types；产出 `createOperationRunHandler(config, subprocess)`与 Cordis function plugin registration。

**Verification:** 高风险 side-effect boundary；RED tests覆盖 unknown id、resolved spec durability、resource/policy、prepare、sync spawn throw、done reject、exit/signal、timeout、cancel、cancel与exit-0竞争、后代仍存活、stdout truncation、stderr tail和 disposer removal。完成命令为 `pnpm vitest run packages/task-queue/operation-run-task-queue/tests`及 package `tsc -b`。只有第二个具体 operation证明重复生命周期时才提取额外公共 service。

**Acceptance contribution:** 真实有限进程可以由 typed Handler执行，所有进程事实在 admission时冻结，副作用和失败分类满足 Queue v2 recovery规则。

1. `resolveAdmission()`只接受 trim 后的已注册 id，复制并冻结 definition为 resolved spec；`resources()`与`policy()`只从 resolved spec派生。
2. `prepare()`验证 cwd是既有目录，不创建目录、不解析新的 config、不开始副作用。
3. `start()`同步创建一个 lifecycle owner；spawn使用无`env`字段的`SubprocessSpawnSpec`。cancel/timeout先以first-cause规则latch原因，再复用一个幂等`terminateAndWait` promise：只调用一次`terminate()`，并等待`waitForExit()`证明整棵进程树退出。
4. `LiveAttempt.done`在直接子进程close后仍等待tree quiescence；cancel与exit 0竞争时以已latch cancel reason返回`canceled`，timeout返回started failure，`waitForExit()`为false或拒绝时返回`operation-quiescence/unknown`。成功和失败文本用 `TextRetainer`限界，忽略spill path。
5. Cordis effect注册/卸载准确移除 `operation.run@1` Handler；duplicate Handler继续由Queue provider fail loud。

### Task 3: 实现 Agent admission Consumer

**Dependencies:** Task 1冻结 intent、tool names和Batch形状；可与Task 2并行。

**Ownership:** Wave 1B独占 `packages/task-queue/tool-operation-run-task-queue/`。

**Interfaces:** 消费 `TaskQueue.forAgent(createVerifiedAgentAuthority(exec.agent.session))`和 `operation.run@1` type-only declaration；产出 `operation_run_enqueue`、`operation_run_enqueue_batch`及pure factory。

**Verification:** authority和model-facing contract；RED tests证明没有live Agent时拒绝、owner由Session派生、single/Batch请求精确、`maxParallel`边界和schema不含execution internals。完成命令为 `pnpm vitest run packages/task-queue/tool-operation-run-task-queue/tests`及 package `tsc -b`。

**Acceptance contribution:** 模型能提交宿主命名的 operation，但不能控制进程、凭据、Provider或Queue execution internals。

1. pure factory遵循现有 agent/image admission Consumer模式并返回精确两个tool。
2. single与Batch tool只构造 `OperationRunIntent { operationId }`；Batch保持每项title并使用空`sharedPayload`。
3. output只呈现Work/Batch id；实际result继续由generic `task_queue_result`读取。
4. package invariant证明工具注册和type-only WorkKind dependency，不复制 Handler config或operation catalog。

### Task 4: 集成真实 Loader/process、持久重开和 Queue Workspace

**Dependencies:** Tasks 2和3 focused PASS；Root确认两个worker没有修改shared files。

**Ownership:** Root修改 `apps/cli/package.json`、workspace refs、lockfile、base Queue capacity及其test；创建 `task-queue-local/tests/operation-v2-vertical.spec.ts`与 `apps/web/tests/task-queue-workspace.e2e.ts`；不把新package作为base/web/standard的活跃Cordis row。

**Interfaces:** 消费两个新package、LocalTaskQueue、LocalSubprocessRuntime、Session/Agent authority、generic result/delivery、Queue Remote/UI；产出test-only Loader composition和真实evidence。

**Verification:** 先跑 keyless真实Node vertical，再跑 browser boundary。完成命令：

```powershell
pnpm vitest run packages/task-queue/operation-run-task-queue/tests packages/task-queue/tool-operation-run-task-queue/tests packages/task-queue/task-queue-local/tests/operation-v2-vertical.spec.ts
pnpm run build:lib:host
pnpm run build:lib:client
pnpm run build:web
pnpm vitest run --config vitest.web.config.ts apps/web/tests/task-queue-workspace.e2e.ts
```

**Acceptance contribution:** 证明该能力不是仅有package和unit test：真实进程、持久Queue、owner result和真实浏览器operator路径都消费同一WorkItem。

1. test composition按package name加载Bridge和Consumer，Queue配置显式包含`resourceCapacity: { operation-run: 1 }`，并用Loader的`assertEntriesLoaded`证明两个新package实际解析；另加resource未配置或claim超过总容量时admission fail-loud的断言。
2. `fixture.echo`使用`process.execPath`和固定fixture path，输出`OPERATION-RUN-V1-OK`；vertical在真实Loader创建的Agent scope中查找并执行注册后的`operation_run_enqueue` tool，只传`title/operationId/idempotencyKey`，验证durable owner等于该Session，等待succeeded，检查resolved revision、Attempt、Result和pending Notification，关闭并重开root后再次读取相同typed output。
3. 真实注册面另外断言缺失Agent、额外execution字段和未注册operation均被拒绝，不能以直接调用`queue.forAgent().enqueue()`替代Consumer证据。
4. delivery测试把稳定Notification消息持久加入owner Session，flush后ack；消息不含stdout、argv、cwd或stderr，`task_queue_result`才返回bounded output。
5. `fixture.wait`启动至少一个保持存活的后代Node process；browser使用由本轮`build:web`产生的dist打开Queue sidebar/workspace，观察running row，执行cancel，等待tree quiescence后才观察canceled，刷新后仍为canceled，并检查无alert、console error和失败network request。
6. browser assertion读取Work id和Remote authoritative status，不以按钮文案、HTTP 200或fixture JSON替代持久状态证据；另覆盖cancel与exit-0竞争，禁止落为succeeded。
7. test teardown再次确认进程树退出和Queue root lock释放，但teardown不能作为持久`canceled`之前的唯一quiescence证明；不得通过停止现有3080 listener获得端口。

### Task 5: 发布性文档、生成投影和最终冻结

**Dependencies:** Task 4 real process和browser evidence通过。

**Ownership:** Root更新两个package paired README、task-queue subsystem pair、`dsh-task-queue` skill、Agent Note triplet和生成投影；不编辑archived Agent Note或手写generated catalog。

**Interfaces:** 消费最终config/tool schema和real evidence；产出当前事实文档、optional composition recipe、published package graph和完成报告。

**Verification:** non-behavioral同步加一次frozen broad milestone。README说明插件默认不挂载、完整config、result/failure、known limitations和Model Experience；subsystem只增加WorkKind Bridge边界，不复制config表。完成命令：

```powershell
pnpm run verify-translation-pairing --write packages/task-queue/operation-run-task-queue/README.md packages/task-queue/tool-operation-run-task-queue/README.md docs/subsystems/task-queue.md .agents/notes/implemented/feature/2026-08-27-queue-operation-run.md
pnpm run gen-tool-catalog
pnpm run gen-config-catalog
pnpm run gen-cordis-catalog
pnpm run gen-doc-graphs
pnpm run gen-module-graph
pnpm vitest run packages/task-queue/task-queue/tests packages/task-queue/task-queue-local/tests packages/task-queue/task-queue-executor-dsh/tests packages/task-queue/tool-task-queue/tests packages/task-queue/tool-agent-run-task-queue/tests packages/task-queue/operation-run-task-queue/tests packages/task-queue/tool-operation-run-task-queue/tests packages/image/image-generation-task-queue/tests packages/image/tool-image-generation-task-queue/tests packages/client/ui-task-queue/tests
pnpm run build:lib:host
pnpm run build:lib:client
pnpm run build:web
pnpm run lint
pnpm run doc-sync
pnpm run verify-agent-note-format
pnpm run verify-package-paths
pnpm run verify-package-invariants
git diff --check -- apps/cli/package.json apps/web/tests/task-queue-workspace.e2e.ts packages/bundle/base packages/task-queue/operation-run-task-queue packages/task-queue/tool-operation-run-task-queue packages/task-queue/task-queue-local/tests/operation-v2-vertical.spec.ts tsconfig.base.json tsconfig.host.json pnpm-lock.yaml docs/subsystems/task-queue.md docs/subsystems/task-queue.zh.md .agents/skills/dsh-task-queue docs/superpowers/plans/2026-08-27-queue-v2-operation-run.md
```

**Acceptance contribution:** package、工具、配置、文档和真实行为一致；现有Queue v2能力无回归；completion claim有fresh source/test/browser evidence。

1. real evidence通过后把 proposed Agent Note移动为implemented triplet，使用当前态Decision/Consequences/Verification叙述；不把未来Agent Provider路由写成已实现事实。
2. README opt-in recipe要求profile同时安装Bridge和Consumer，并配置至少一个无秘密固定operation；不建议恢复node/shell或把Skill脚本直接放入Queue worker。
3. `dsh-task-queue` skill通过`task_queue_kinds`确认`operation.run@1`是否已组合；未组合时不构造operation tool payload。
4. completion report记录Work/Attempt/Result/Notification id、Consumer tool call、owner Session、reopen事实、stdout bound、cancel前后代pid与tree exit事实、browser所用fresh web build、refresh、focused test count、owned-path gate和remaining non-goals。全局lint/doc-sync若包含既有WIP失败，只报告精确失败路径和命令，不归因于本功能，也不声明全仓绿色。

## Stop Conditions

- Baseline Gate证明Queue v2 core、owner delivery、root lock或current WorkKind存在未收口失败。
- 第一个真实production operation需要caller参数、secret env、动态cwd、任意script path或byte artifact；先建立具名业务WorkKind或修订安全契约。
- Handler必须在admission后重新读取可变config才能执行；这会破坏resolved事实耐久性。
- operation输出需要超过bounded text或需要持久文件；当前Queue不拥有generic Artifact Store。
- browser acceptance只能通过停止无关server、删除现有Queue data或使用fixture-only Remote成立。
- 新功能需要修改Queue core、Goal、Workflow、Subagent或Jobs ownership；停止并重新做reuse decision。
- broad gate只在本计划未修改的dirty path失败；记录baseline并停止调查。

## Deferred Follow-on Plans

1. `agent.run@1` Provider routing只有在第二个真实Provider具备相同authority、cancel、output和restricted composition证据后再计划；Codex、Claude Code和OpenCode不能仅凭HEAD adapter存在就复用。
2. 参数化operation只有在至少两个真实allowlisted operation证明`operationId`爆炸或重复schema后再引入；优先领域专属WorkKind。
3. 外部async remote job需要submit/poll/cancel/reconcile和remote identity持久化，应作为独立Provider生命周期计划，不扩张本地process Handler。
4. Queue-to-Goal continuation、multi-host Session ownership和byte-exact Artifact capability继续使用现有deferred计划边界。

## Final Review

1. 每个DoD事实分别落在Bridge、Consumer、real process、owner delivery、browser和docs任务中。
2. caller永远不能传argv/cwd/env/shell/profile/model/credential；resolvedspec在admission后不漂移。
3. start/timeout/cancel只有一个lifecycle owner；失败矩阵与Queue auto-retry规则一致。
4. Queue core和现有WorkKind不依赖operation package；opt-in package不进入默认Bundle。
5. Wave 1文件所有权不重叠，Root持有shared files、integration、真实运行和completion claim。
6. realprocess和browser纵切发生在broad verification与Agent Note promotion之前。
7. 没有placeholder、兼容shim、generic artifact、recursive delegation或重复broad suite。
