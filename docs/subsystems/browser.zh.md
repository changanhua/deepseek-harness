# 浏览器助手

[English](browser.md) | 中文

[浏览器包组](../../packages/browser/README.zh.md)负责 `ctx.browser`、显式页面引用和经过授权的扩展提供方。以下定义描述调用方与执行器身份，本身不授予模型执行权限。

## 身份与操作

一个安装代表一个独立授权的 Chrome 扩展。每次操作同时指定调用方会话和目标安装。页面引用包含 Chrome 标签、框架、文档身份与已观察到的 URL；元素引用还指定其快照。切换前台标签不会改变这些目标。节点被替换、动作属性变化或文档引用过期时，请求被拒绝，不会按选择器重新定位。

```ts type-equiv
/** Page identity is independent of whichever tab is currently in the foreground. */
interface BrowserPage {
  readonly tabId: number
  readonly frameId: number
  readonly documentId: string
  readonly url: string
}
```

```ts type-equiv
/** A snapshot-local element reference, never a selector to be rematched later. */
interface BrowserElementReference {
  readonly page: BrowserPage
  readonly snapshotId: string
  readonly elementId: string
}
```

```ts type-equiv
/** One bounded plain-data block rendered by an extension-owned page region. */
type BrowserRegionBlock =
  | { readonly type: 'heading'; readonly text: string }
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'item'; readonly title: string; readonly meta?: string | undefined; readonly link?: string | undefined }
  | { readonly type: 'keyvalue'; readonly label: string; readonly value: string }
  | { readonly type: 'link'; readonly text: string; readonly href: string }
```

```ts type-equiv
/**
 * Model-facing, selector-free description of a temporary result panel.
 * The Host compiles this into the extension wire blocks after resolving a
 * short-lived regionRef.  It is intentionally data, never HTML.
 */
interface BrowserRegionPresentation {
  readonly title?: string
  readonly summary?: string
  readonly items?: readonly { readonly title: string; readonly meta?: string; readonly link?: string }[]
  readonly facts?: readonly { readonly label: string; readonly value: string }[]
  readonly links?: readonly { readonly text: string; readonly href: string }[]
  readonly footer?: string
}
```

```ts type-equiv
/** Host-authored bounded query used only to bind fresh snapshot evidence to a live DSH region mount. */
interface BrowserPresentationQuery {
  readonly mountId: string
  readonly text: string
}
```

```ts type-equiv
/** Current consumers: interactive tools, explicit page intake, and finite monitor checks. */
type BrowserAction =
  | { readonly kind: 'tabs' }
  | { readonly kind: 'snapshot'; readonly tabId: number; readonly frameId: number; readonly documentId?: string; readonly query?: string; readonly offset?: number; readonly limit?: number; readonly textLimit?: number; readonly tree?: boolean; readonly treeCursor?: string; readonly treeLimit?: number; readonly includeOptions?: boolean; readonly structure?: boolean; readonly presentationQueries?: readonly BrowserPresentationQuery[] }
  | { readonly kind: 'page_map'; readonly page: BrowserPage }
  | { readonly kind: 'entry_inspect'; readonly page: BrowserPage; readonly regionSelector: string; readonly selector: string; readonly titleSelector?: string; readonly linkSelector?: string; readonly sampleLimit?: number }
  | { readonly kind: 'entry_mount'; readonly page: BrowserPage; readonly mountId: string; readonly regionSelector?: string; readonly selector: string; readonly label: string; readonly titleSelector?: string; readonly linkSelector?: string; readonly collected?: readonly string[] }
  | { readonly kind: 'entry_unmount'; readonly page: BrowserPage; readonly mountId: string; readonly forgetCollected?: boolean }
  | { readonly kind: 'region_render'; readonly page: BrowserPage; readonly mountId: string; readonly regionRef: BrowserRegionRef; readonly presentation: BrowserRegionPresentation; readonly placement?: 'prepend' | 'append'; readonly mode?: 'append' | 'replace' }
  | { readonly kind: 'region_clear'; readonly page: BrowserPage; readonly mountId: string }
  | { readonly kind: 'navigate'; readonly page: BrowserPage; readonly url: string }
  | { readonly kind: 'click'; readonly element: BrowserElementReference; readonly intent: string }
  | { readonly kind: 'fill'; readonly element: BrowserElementReference; readonly value: string; readonly intent: string }
  | { readonly kind: 'submit'; readonly element: BrowserElementReference; readonly intent: string }
  | { readonly kind: 'double_click' | 'right_click' | 'hover'; readonly element: BrowserElementReference; readonly intent: string }
  | { readonly kind: 'press'; readonly element: BrowserElementReference; readonly key: string; readonly intent: string }
  | { readonly kind: 'select'; readonly element: BrowserElementReference; readonly values: readonly string[]; readonly intent: string }
  | { readonly kind: 'check'; readonly element: BrowserElementReference; readonly checked: boolean; readonly intent: string }
  | { readonly kind: 'drag'; readonly element: BrowserElementReference; readonly target: BrowserElementReference; readonly intent: string }
  | { readonly kind: 'upload'; readonly element: BrowserElementReference; readonly files: readonly string[]; readonly intent: string }
  | { readonly kind: 'back' | 'forward' | 'reload' | 'tab_close' | 'tab_focus' | 'screenshot'; readonly page: BrowserPage }
  | { readonly kind: 'tab_open'; readonly page: BrowserPage; readonly url: string }
  | { readonly kind: 'scroll'; readonly page: BrowserPage; readonly x: number; readonly y: number }
  | { readonly kind: 'wait'; readonly page: BrowserPage; readonly milliseconds: number }
```

`page_map` 为精确文档最多返回 64 个有界区域，但会将每个私有 selector 替换为短时有效、不透明的 `regionRef`。必须先调用它再 `region_render`：渲染接收该引用和有界的高层展示数据，只有 Host 解析 selector 并编译纯数据块。引用绑定 Session、安装、grant epoch、精确页面与地图寿命；新的地图会使旧引用失效。公开 action 与 status 结果会递归移除 selector、region selector 和编译后的 blocks。这条无 selector 规则仅适用于页面地图展示：独立且有界的 `entry_inspect` 和 `entry_mount` 站点适配动作仍保留明确、由提供方验证的 selector。Append 模式添加扩展自有节点；replace 模式还要求引用的区域可占用且未受保护，并把其原始子节点移到一边，直到 `region_clear` 将其恢复。页面运行时把挂载绑定到 Session、安装、grant epoch 和页面身份，绝不将旧挂载悄然绑定到新 URL。只有已观察到的 `cleared:true`、已观察到的精确 `disposition:'absent'` 或 sent 的 `document_replaced` 才能结算清理；`target_url_stale` 会使资源保持未解决。

`tree` 快照从同一份稳定缓存分页返回层次。Document、元素、文本和开放 Shadow Root 节点会跨 `treeCursor` 读取保留 index 和 parent index，不会重新匹配节点。iframe 元素标出 source 边界，frame 文档仍需独立读取。隐藏、可编辑、script 和 style 文本会被排除，隐藏结构仍保留 hidden 标记。

```ts type-equiv
/** One separately authorized installation; no credential material is exposed. */
interface BrowserInstance {
  readonly installationId: string
  readonly extensionId: string
  readonly online: boolean
  readonly grantEpoch: number
  readonly origins: readonly string[]
  readonly scopes: readonly string[]
  /** Detached handshake snapshot; absent only while the authorized installation is offline. */
  readonly capabilities?: BrowserExecutorCapabilities
}
```

```ts type-equiv
/** One caller-owned operation; providers enforce the instance's current grant. */
interface BrowserOperation {
  readonly sessionId: SessionId
  readonly installationId: string
  /** Minted by the caller before dispatch; repeated identities are journaled idempotently. */
  readonly requestId: string
  readonly action: BrowserAction
}
```

```ts type-equiv
/** Host-minted, short-lived reference to one exact page-map region. */
type BrowserRegionRef = Branded<'BrowserRegionRef'>
```

```ts type-equiv
/** Public, action-free key retained with a sent attempt for restart recovery. */
interface BrowserRecoveryLocator {
  readonly kind: 'extension-journal-v1'
  readonly protocolVersion: 1
  readonly transportRequestId: string
  readonly installationId: string
  readonly grantEpoch: number
}
```

```ts type-equiv
/** A carrier acknowledgement is not itself an observed business effect. */
interface BrowserActionResult {
  readonly requestId: string
  readonly sessionId: SessionId
  readonly installationId: string
  readonly outcome: 'observed' | 'failed' | 'cancelled' | 'unknown'
  readonly delivery: 'not-sent' | 'sent'
  readonly reason?: string
  readonly value?: JsonValue
}
```

```ts type-equiv
/** Caller-scoped lookup of one retained request; querying never replays its action. */
interface BrowserRequestStatusQuery {
  readonly requestId: string
  readonly sessionId: SessionId
  readonly installationId: string
  /** Required when the Host no longer has the in-memory transport request. */
  readonly recoveryLocator?: BrowserRecoveryLocator
}
```

```ts type-equiv
/** Current retained state of one Browser request. */
type BrowserRequestStatus = Omit<BrowserActionResult, 'outcome'> & {
  readonly outcome: BrowserActionResult['outcome'] | 'in-flight'
  readonly quiescent?: boolean
}
```

## 页面入口与站点适配

条目预检与挂载遵循 [Browser 条目契约](../../packages/browser/browser/README.zh.md)。其证据绑定当前区域和字段节点，包括同文档内的替换，而非普通动作的准备票据。文档运行时最多保留 128 条预检记录与 128 条收集记录；收集键和值合计不超过 65,536 个 UTF-8 字节，每个集合最多 512 个链接。容量拒绝保留已有集合。

manifest 显式声明的 `zhihu-feed.js` 内容脚本负责独立的阅读流适配。它的站点选择器不是页面模型默认值，也不构成页面模型泛化证据。模型调用方使用 Cordis preset 的页面模型 Skill 和运行器 facade；`browser_action` 不开放条目操作。

## 准备动作

模型工具在请求审批前准备一项固定动作。准备只是准入时的只读探测：放弃 ticket 不消耗任务动作预算，也不留下 planned attempt。提供方持有短期 ticket，绑定会话、安装、授权代次与完整动作；提交时不能替换参数。扩展仅在文档的有界内存中保留目标和表单值，并在执行前同步比较。快照变化或被淘汰、表单状态变化都会使准备失效。

工具策略同时检查动作种类和浏览器观察到的影响。仅原生 details 正文展开、滚动和等待无需动作审批。其它点击、导航、填写（可能自动保存）和提交复用现有 Approval 服务。上传路径必须是绝对路径，并在当前用户消息中逐字出现；模型工具会在执行前检查该来源，不额外显示批准框。展示的填写预览来自拟执行的 Host 输入；准备结果不返回页面原有字段值。

可见的局部变化报告为 observed，不代表业务成功。效果无法核验的点击和提交保留为 unknown；无效表单被拒绝。填写只报告请求的本地值是否已设置，不返回网站改写后的值。调用方需要检查结果页面，再判断预期目标是否达成。

```ts type-equiv
/** Provider-owned, one-action approval binding; callers cannot replace its parameters. */
type BrowserPreparedTicket = Branded<'BrowserPreparedTicket'>
```

```ts type-equiv
/** Bounded page facts for the approval UI, not instructions supplied by the page. */
interface BrowserActionDescription {
  readonly kind: BrowserAction['kind']
  readonly page: BrowserPage
  readonly title: string
  readonly target?: { readonly tag: string; readonly label: string; readonly type: string }
  readonly effect: 'local-disclosure' | 'navigation' | 'form-submit' | 'input-change' | 'unknown' | 'scroll' | 'wait'
  readonly destination?: string
  readonly valuePreview?: string
}
```

```ts type-equiv
/** Preparation is transient. Expiry, authority changes and page changes require a new approval. */
interface BrowserPreparedAction {
  readonly ticket: BrowserPreparedTicket
  readonly expiresAt: number
  readonly description: BrowserActionDescription
}
```

## 授权与恢复

提供方根据动作判定读取或写入权限，并在派发前检查当前安装授权。扩展在执行前检查当前授权和 Chrome 站点权限。导航核验产生的新文档；重定向超出已授权站点时，不返回未授权目标的 URL。

调用方在派发前生成每个请求 ID。每次调用以该 ID、协议版本、授权代次、会话、安装、截止时间、目标与动作绑定摘要。完全相同的重复请求共享已有回执。在线安装会暴露 worker 的 capability 握手，因此缺少声明或不支持的 action 是不可用，而非猜测的回退。`browser/operation-intent` 在提供方专属检查前准入一个逻辑动作；`browser/dispatch-intent` 紧邻传输边界执行；`browser/operation-settled` 记录持久结果而不改写它。BrowserTask listener 将三者用于直连调用、工具调用、已准备提交和 Dynamic Cordis 调用。派发时，它持久化 planned attempt 与不含动作的 recovery locator，flush Session，然后才允许发送。重连查询状态，不重新发送动作。扩展在页面效果发生前持久化最小执行意图；日志保留有界结果值，不保存原调用负载。后台重启后，未解决的写操作继续锁定整个标签，锁跨越会话与授权代次。已经初始化的日志丢失时，存储处于不可用状态，不视为空请求历史。

取消只请求停止。回执丢失或超时产生 `unknown`，直到执行器证据确定结果。`requestStatus()` 在不重放请求、不暴露权限指纹的前提下读取调用者作用域内的保留状态。Host 内存丢失后，精确的 recovery locator 只能发出日志 `status-query`，并绑定请求、Session、安装和原 epoch；缺失、不匹配、离线、超时或不支持的答复保持为 `unknown`。未解决的写操作持续持锁，直到观察到终态，或执行器确认不会继续执行后由用户显式确认。超时或站点权限丢失均不能证明旧文档已经停止执行。

`@changanhua/dsh-browser-task` 是自然语言现场任务的 Session 持久权威。其 projection 分离不可变页面 evidence 和目标绑定、planned/prepared/dispatched/settled attempt 与 receipt、页面资源 lease、capability 快照、规范 Subagent/Job/Cordis 身份和验收检查。由 checker 支持的验收条款不同于已观察到的页面 action 或已完成的委派 run。区域展示条款在清理前同时引用 observed render 与后续的新页面 evidence。终态完成要求每个条款都引用当前 evidence、没有 blocker 或未解决 write、预算未耗尽，并且每个资源都已释放或确认消失。sent unknown 请求绝不重放。确定性的 not-sent 失败在首次发生后阻断语义目标未变的调用，只有新 evidence 证明前置条件改变才恢复；内部 projection 错误成为 `internal-invariant` blocker，而不是可重试的 Browser 错误。任务预算耗尽后只允许精确清理，并在资源终态后结束任务。扩展侧接受 unknown 只会释放传输锁，绝不完成 Session 任务；此后只有新的直接用户消息才能显式取消任务，且必须先让每项页面资源都有回执支持的终态，unknown attempt 仍保留在日志中。工具消费方只继续该 projection；它不是进程内任务权威。

Puppeteer 执行全部已实现动作。DOM 兼容执行器仅支持 `click`、`fill`、`submit`、`navigate`、`scroll` 和 `wait`，并拒绝新动作类型。截图要求主 frame，base64 上限为 400,000 字符。[网关 README](../../packages/browser/browser-extension/README.zh.md)负责传输边界与配置。[会话控制器](../../packages/api/session-controller/README.zh.md)负责对话历史；该服务不建立第二套消息存储。

## 有限观察与监控

`observe()` 是对 `tabs`、`snapshot` 或 `page_map` 的有限读取，绑定到调用方 Session、安装和固定 observation grant epoch。提供方要求同时具备 read 和 observation scope，观察快照不会填充交互元素引用缓存。观察不可用是失败 outcome，绝不构成被监控页面未变化的证据。

[`dsh-browser-monitor`](../../packages/browser/browser-monitor/README.zh.md)持久化显式 plan 和已接受 sample 摘要：SHA-256 digest、match 结果、时间和页面身份，而不是采集到的页面正文。null interval 调度一次检查；周期 plan 要么将逾期工作合并为 `latest`，要么跳过它，pause/resume 会先改变持久 plan，再调度新的 work。每个到期 slot 都成为类型化 Queue work kind `browser.monitor.check@1`；Queue 输入只包含 monitor id、revision 和 slot。

监控会为一次检查可能产生的每条通知预留 outbox 容量，然后要求对每个已投递 ID 显式确认。默认最多支持 64 个监控，每 1,000 ms 扫描到期工作，并将一次读取限制在 30 秒。Gateway 方法 `monitor.list`、`monitor.create`、`monitor.pause`、`monitor.resume` 和 `monitor.acknowledge` 为原生扩展界面提供服务。worker 连接后及每 15 秒刷新 Host outbox，显示角标数量和按 ID 保持稳定的通知卡。Chrome 仅持久保存未确认的创建请求。每次接受结果时一并保存结算关联，直到 Queue 确认终态，因此重启恢复不会再次读取已有结果对应的网页。

## 浏览活动留存

[`dsh-browser-activity`](../../packages/browser/browser-activity/README.zh.md)拥有上传后的原始事实，与监控比较状态和整理知识分别存储。`ConfigureActivity` 携带稳定请求 ID、所见版本和显式采集边界。`ActivityState` 暴露当前策略和序号，或要求显式配置的授权变更状态。暂停是持久保存的停用策略，并产生新版本。

`ActivityBatch` 将最多 32 条事件绑定到策略版本和连续序号；`ActivityReceipt` 确认接受数量。`ActivityRecord` 保留有界事实、宿主确定的会话及授权来源和一条重试回执。`ActivityQuery` 按文本、会话和时间过滤；只能读取当前授权版本及获准站点的内容。没有打开界面或处于暂停时仍执行到期清理。扩展采集器和知识目标分别消费这些契约。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbrowser--browser-abstract-seam"></a>

### `ctx.browser` — `Browser` (abstract seam)

Shared browser capability; an installation connection never implies a shared action target.

```ts cordis-catalog
/**
 * Return current authorized installations without exposing their credentials.
 * @returns Detached installation metadata and online state.
 */
abstract instances(): Promise<readonly BrowserInstance[]>

/**
 * Recheck a captured installation's authority synchronously; offline alone does not revoke access.
 * @param instance - Previously returned installation metadata.
 * @returns Whether its identity, epoch, scopes and sites still match the current authorization.
 */
abstract isAuthorized(instance: BrowserInstance): boolean

/**
 * Read once for a background monitor under its fixed observation authorization.
 * @param operation - Session, installation, grant epoch and read-only action.
 * @param signal - Stops this finite observation without scheduling further checks.
 * @returns The observation outcome; an unavailable browser is never an unchanged result.
 */
abstract observe(operation: BrowserObservation, signal: AbortSignal): Promise<BrowserActionResult>

/**
 * Execute against the explicit instance/page; lost results remain unknown and are not replayed.
 * @param operation - Caller Session, installation and domain action.
 * @param signal - Requests cancellation without promising to undo an effect.
 * @returns Observed outcome or an unresolved result with its request identity.
 */
abstract execute(operation: BrowserOperation, signal: AbortSignal): Promise<BrowserActionResult>

/**
 * Read one caller-scoped retained request without replaying it.
 * @param query - Session, installation, and request id returned by an earlier action.
 * @returns The current outcome and quiescence when known; authority fingerprints remain private.
 */
abstract requestStatus(query: BrowserRequestStatusQuery): Promise<BrowserRequestStatus>

/**
 * Read facts for one page action and bind its immutable parameters before asking for approval.
 * @param operation - Caller Session, installation and action with an explicit page target.
 * @param signal - Cancels preparation before a ticket can be used.
 * @returns A bounded, expiring preparation; rejects when the target cannot be prepared.
 */
abstract prepare(operation: BrowserOperation, signal: AbortSignal): Promise<BrowserPreparedAction>

/**
 * Submit exactly the prepared action after rechecking authority and page facts.
 * @param ticket - Opaque preparation owned by this provider instance.
 * @param signal - Requests cancellation without undoing an already issued action.
 * @returns The retained outcome on repeated calls, without dispatching a second action.
 */
abstract executePrepared(ticket: BrowserPreparedTicket, signal: AbortSignal): Promise<BrowserActionResult>
```

Source: [`packages/browser/browser/src/index.ts`](../../packages/browser/browser/src/index.ts)

<a id="ctxbrowseractivity--browseractivity"></a>

### `ctx.browserActivity` — `BrowserActivity`

Owns bounded raw browser activity independently of the Chrome buffer and curated knowledge.

```ts cordis-catalog
/**
 * Inspect lifecycle readiness without exposing retained activity.
 * @returns The active dependency lifecycle phase.
 */
status(): { phase: 'opening' | 'ready' | 'unavailable' | 'closed' }

/**
 * Persist an explicit collection policy or pause under a viewed revision.
 * @param installationId - Authenticated installation owning the policy.
 * @param input - Stable request identity, viewed revision, and collection settings.
 * @param authorize - Dynamic transport authority check repeated at commit.
 * @returns The durable policy projection, including an identical prior receipt.
 */
configure(installationId: string, input: ConfigureActivity, authorize?: () => void): Promise<ActivityState>

/**
 * Resolve policy and sequence before the extension starts collection or recovery.
 * @param installationId - Authenticated installation owning the policy.
 * @param authorize - Dynamic transport authority check.
 * @returns The current policy, or an explicit authorization-change state.
 */
state(installationId: string, authorize?: () => void): Promise<ActivityState>

/**
 * Accept a bounded consecutive activity batch under current observation authority.
 * @param installationId - Authenticated installation supplying the facts.
 * @param input - Policy-bound batch with a stable retry identity.
 * @param authorize - Dynamic transport authority check repeated at commit.
 * @returns The durable last-batch receipt.
 */
append(installationId: string, input: ActivityBatch, authorize?: () => void): Promise<ActivityReceipt>

/**
 * Search retained raw facts within the current observation authority.
 * @param installationId - Authenticated installation owning the facts.
 * @param input - Text, Session, time, and result-count bounds.
 * @param authorize - Dynamic transport authority check.
 * @returns Detached facts bounded by count and encoded bytes.
 */
query(installationId: string, input: ActivityQuery, authorize?: () => void): Promise<ActivityRecord['events']>
```

Source: [`packages/browser/browser-activity/src/index.ts`](../../packages/browser/browser-activity/src/index.ts)

<a id="ctxbrowsermonitor--browsermonitor"></a>

### `ctx.browserMonitor` — `BrowserMonitor`

Owns persistent plans, accepted comparisons and notification ids, independently of any visible UI.

```ts cordis-catalog
/**
 * Current lifecycle state; unavailable never means that the page was unchanged.
 * @returns The active dependency lifecycle phase.
 */
status(): { readonly phase: 'opening' | 'ready' | 'unavailable' | 'closed' }

/**
 * Persist an explicit plan under the installation's current observation grant.
 * @param input - Immutable plan intent with its stable creation request id.
 * @param authorize - Transport permission check repeated at the commit boundary.
 * @returns The detached durable record, including an identical prior creation.
 */
create(input: CreateMonitor, authorize?: () => void): Promise<MonitorRecord>

/**
 * Return detached definitions and results for one installation; transport callers enforce read access.
 * @param installationId - The authorized browser installation.
 * @returns Its persisted plans, accepted comparisons and pending notifications.
 */
list(installationId: string): MonitorRecord[]

/**
 * Stop a plan and invalidate its queued and running checks.
 * @param id - The persisted monitor id.
 * @param installationId - The installation owning the plan.
 * @param revision - The viewed revision, when supplied by an interactive caller.
 * @param authorize - Transport permission check repeated before persistence.
 * @returns The paused record after any known Queue cancellation request.
 */
pause(id: string, installationId: string, revision?: string, authorize?: () => void): Promise<MonitorRecord>

/**
 * Bind an explicit resumption to current authority and start a fresh schedule.
 * @param id - The persisted monitor id.
 * @param installationId - The installation owning the plan.
 * @param revision - The viewed revision; stale controls cannot restart a new schedule.
 * @param authorize - Transport permission check repeated before persistence.
 * @returns The resumed record bound to the current observation grant.
 */
resume(id: string, installationId: string, revision?: string, authorize?: () => void): Promise<MonitorRecord>

/**
 * Acknowledge one notification after the receiving surface accepts responsibility for its presentation.
 * @param id - The persisted monitor id.
 * @param installationId - The installation owning the notification.
 * @param noticeId - The stable notification id to remove from the outbox.
 * @param authorize - Transport permission check repeated at the removal boundary.
 */
acknowledge(id: string, installationId: string, noticeId: string, authorize?: () => void): Promise<void>
```

Source: [`packages/browser/browser-monitor/src/index.ts`](../../packages/browser/browser-monitor/src/index.ts)

<a id="ctxbrowsertasks--browsertaskservice"></a>

### `ctx.browserTasks` — `BrowserTaskService`

Session-log authority for one current browser task; no process-local task state exists.

```ts cordis-catalog
/**
 * Read the current durable browser task for one live Agent.
 * @param agent - Exact live Agent whose Session owns the task.
 * @returns A detached task snapshot, or `undefined` when none exists.
 */
get(agent: Agent): BrowserTaskSnapshot | undefined

/**
 * Read the durable target revision and detached binding for one Session.
 * @param agent - Exact live Agent whose Session owns the target.
 * @returns The current revision and binding, or a null binding when no page is selected.
 */
readTarget(agent: Agent): BrowserSessionTargetState

/**
 * Commit an exact page selected by an authenticated user surface.
 * @param agent - Exact live Agent whose Session owns the target.
 * @param request - Expected revision, authenticated installation, and observed page.
 * @returns The committed binding at its next revision.
 */
bindTargetByUser(agent: Agent, request: { readonly expectedRevision: number readonly installationId: string readonly page: BrowserPage }): BrowserSessionTargetBinding

/**
 * Explicitly clear a Session target while advancing its stale-send fence.
 * @param agent - Exact live Agent whose Session owns the target.
 * @param expectedRevision - Compare-and-set revision observed by the user surface.
 * @returns The next revision with a null binding.
 */
clearTargetByUser(agent: Agent, expectedRevision: number): BrowserSessionTargetState

/**
 * Return the latest durable direct-user message available as a task source.
 * @param agent - Exact live Agent whose Session is inspected.
 * @returns The user-message sequence, or `undefined` before direct user input.
 */
latestUserSource(agent: Agent): number | undefined

/**
 * Create one task from a real user message after any prior task is terminal.
 * @param agent - Exact live Agent that owns the task.
 * @param request - Objective, acceptance clauses, target, source, and budgets.
 * @returns The committed revision-one task.
 */
create(agent: Agent, request: CreateBrowserTaskRequest): BrowserTaskSnapshot

/**
 * Append a bounded Browser receipt before any task mutation cites it.
 * @param agent - Exact live Agent that owns the task.
 * @param task - Current compare-and-set task revision.
 * @param receipt - Outcome bound to an existing attempt and exact authority.
 * @returns The durable receipt source reference.
 */
recordReceipt( agent: Agent, task: BrowserTaskRef, receipt: Omit<BrowserTaskReceipt, 'kind' | 'version' | 'taskId'>, ): Extract<BrowserTaskSourceRef, { kind: 'browser-task-receipt' }>

/**
 * Append one deterministic acceptance check over current evidence.
 * @param agent - Exact live Agent that owns the task.
 * @param task - Current compare-and-set task revision.
 * @param check - Checker identity, target, authority epoch, and clause results.
 * @returns The durable checker source reference.
 */
recordCheck(agent: Agent, task: BrowserTaskRef, check: Omit<import('./types.ts').BrowserTaskCheck, 'kind' | 'version' | 'taskId'>): { kind: 'browser-task-check'; sessionSeq: number }

/**
 * Record the extension capability and authorization snapshot.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param capability - Installation, grant epoch, scopes, actions, and protocol.
 * @returns The next task revision.
 */
recordCapability(agent: Agent, ref: BrowserTaskRef, capability: BrowserCapability): BrowserTaskSnapshot

/**
 * Add immutable bounded evidence from a real Session or Browser receipt fact.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param evidence - Digest, source, target, coverage, and authority epoch.
 * @returns The next task revision.
 */
recordEvidence(agent: Agent, ref: BrowserTaskRef, evidence: BrowserTaskSnapshot['evidence'][number]): BrowserTaskSnapshot

/**
 * Invalidate current evidence without deleting its durable identity.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param id - Existing evidence identity.
 * @param state - Invalidated evidence disposition.
 * @returns The next task revision.
 */
staleEvidence(agent: Agent, ref: BrowserTaskRef, id: string, state: 'stale' | 'superseded'): BrowserTaskSnapshot

/**
 * Plan one caller-identified Browser attempt before dispatch.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param attempt - Planned request, action, target, and authority identity.
 * @returns The next task revision.
 */
recordAttempt(agent: Agent, ref: BrowserTaskRef, attempt: BrowserActionAttempt): BrowserTaskSnapshot

/**
 * Advance an existing attempt through its monotonic lifecycle.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param attempt - Complete next attempt state with matching identity.
 * @returns The next task revision.
 */
advanceAttempt(agent: Agent, ref: BrowserTaskRef, attempt: BrowserActionAttempt): BrowserTaskSnapshot

/**
 * Reconcile an unknown attempt from a matching quiescent receipt.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param attempt - Settled replacement citing the recovery receipt.
 * @returns The next task revision.
 */
reconcileAttempt(agent: Agent, ref: BrowserTaskRef, attempt: BrowserActionAttempt): BrowserTaskSnapshot

/**
 * Reserve or advance one exact-page resource lease.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param resource - Complete next resource state and optional disposition.
 * @returns The next task revision.
 */
upsertResource(agent: Agent, ref: BrowserTaskRef, resource: BrowserPageResource): BrowserTaskSnapshot

/**
 * Resolve an uncertain resource from a matching Browser receipt.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param resource - Final resource disposition with its receipt source.
 * @returns The next task revision.
 */
reconcileResource(agent: Agent, ref: BrowserTaskRef, resource: BrowserPageResource): BrowserTaskSnapshot

/**
 * Link a Job, Subagent, or Cordis tool call without treating it as acceptance.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param work - Bounded delegated-work identity, status, source, and expectation.
 * @returns The next task revision.
 */
linkDelegatedWork(agent: Agent, ref: BrowserTaskRef, work: DelegatedWorkRef): BrowserTaskSnapshot

/**
 * Transfer every active function resource to one exact installation-owned Cordis run.
 * @param agent - Exact live Agent that owns the verified BrowserTask.
 * @param ref - Current compare-and-set task revision.
 * @param request - Authenticated function owner, delivery scope, and complete active resource set.
 * @returns The next task revision with transferred resources marked retained.
 */
handoffFunction(agent: Agent, ref: BrowserTaskRef, request: HandoffBrowserFunctionRequest): BrowserTaskSnapshot

/**
 * Apply checker-backed evaluations for declared acceptance clauses.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param evaluations - Clause results citing one matching check fact.
 * @returns The next verifying task revision.
 */
evaluate(agent: Agent, ref: BrowserTaskRef, evaluations: readonly AcceptanceEvaluation[]): BrowserTaskSnapshot

/**
 * Change a nonterminal task phase without clearing derived blockers.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param phase - Next nonterminal phase.
 * @param blockers - Optional complete blocker set; derived blockers cannot be removed here.
 * @returns The next task revision.
 */
transition(agent: Agent, ref: BrowserTaskRef, phase: Exclude<BrowserTaskSnapshot['phase'], 'terminal'>, blockers?: readonly BrowserTaskBlocker[]): BrowserTaskSnapshot

/**
 * Rebind a target only after an explicit target-loss edge.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param next - New exact installation and page identity.
 * @returns The next task revision with prior evidence stale.
 */
rebind(agent: Agent, ref: BrowserTaskRef, next: BrowserTargetBinding): BrowserTaskSnapshot

/**
 * Acknowledge an explicit rebind and clear only its target-loss blocker.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @returns The next task revision.
 */
acknowledgeTargetLoss(agent: Agent, ref: BrowserTaskRef): BrowserTaskSnapshot

/**
 * Resume after human interaction only with fresh authority and evidence.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @returns The next task revision without the human-interaction blocker.
 */
acknowledgeHumanInteraction(agent: Agent, ref: BrowserTaskRef): BrowserTaskSnapshot

/**
 * Consume durable Agent-continuation budget.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param steps - Positive number of continuation steps to consume.
 * @returns The next task revision.
 */
consumeContinuation(agent: Agent, ref: BrowserTaskRef, steps: number = 1): BrowserTaskSnapshot

/**
 * Consume durable Browser-action budget.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param actions - Positive number of Browser actions to consume.
 * @returns The next task revision.
 */
consumeAction(agent: Agent, ref: BrowserTaskRef, actions: number = 1): BrowserTaskSnapshot

/**
 * Terminate a task; completed outcomes pass every acceptance and cleanup gate.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param outcome - Terminal outcome.
 * @returns The terminal task revision.
 */
terminate(agent: Agent, ref: BrowserTaskRef, outcome: BrowserTaskSnapshot['outcome'] & string): BrowserTaskSnapshot

/**
 * End an uncertain task only from a newer direct user message. This records a
 * decision boundary; it never changes any unknown action or resource outcome.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param sourceSeq - Latest direct user message that explicitly requests cancellation.
 * @returns The terminal cancelled task revision.
 */
cancelByOwner(agent: Agent, ref: BrowserTaskRef, sourceSeq: number): BrowserTaskSnapshot
```

Types: [Agent](core.zh.md)

Source: [`packages/browser/browser-task/src/index.ts`](../../packages/browser/browser-task/src/index.ts)

<a id="browser-events"></a>

### `browser/*` events

<a id="browserdispatch-intent--waterfall"></a>

#### `browser/dispatch-intent` — waterfall

Single-slot policy immediately before a Browser Provider can cross its transport boundary. Calling `next()` delegates to the next policy; a denial returns a conclusive result without sending.

```ts cordis-catalog
/**
 * Single-slot policy immediately before a Browser Provider can cross its transport boundary.
 * Calling `next()` delegates to the next policy; a denial returns a conclusive result without sending.
 * @param context - Logical operation plus exact transport identity, authority epoch, and mutation class.
 * @param next - Continue to the next dispatch listener or the default allow decision.
 * @mode waterfall
 */
'browser/dispatch-intent'(context: BrowserDispatchContext, next: () => BrowserDispatchDecision | Promise<BrowserDispatchDecision>): Promise<BrowserDispatchDecision>
```

Source: [`packages/browser/browser/src/index.ts`](../../packages/browser/browser/src/index.ts)

<a id="browserentry-click--emit"></a>

#### `browser/entry-click` — emit

A user clicked one entry mounted in an authorized external webpage.

```ts cordis-catalog
/**
 * A user clicked one entry mounted in an authorized external webpage.
 * @param event - Verified mount, Session, page, title, and link identity for the click.
 * @mode emit
 */
'browser/entry-click'(event: BrowserEntryEvent): void
```

Source: [`packages/browser/browser/src/index.ts`](../../packages/browser/browser/src/index.ts)

<a id="browseroperation-intent--waterfall"></a>

#### `browser/operation-intent` — waterfall

Single-slot admission for one logical Browser operation, before Provider-specific preconditions.

```ts cordis-catalog
/**
 * Single-slot admission for one logical Browser operation, before Provider-specific preconditions.
 * @param context - Caller identity, logical action, mutation class, and lifecycle phase.
 * @param next - Continue to the next admission listener or the default allow decision.
 * @mode waterfall
 */
'browser/operation-intent'(context: BrowserOperationContext, next: () => BrowserDispatchDecision | Promise<BrowserDispatchDecision>): Promise<BrowserDispatchDecision>
```

Source: [`packages/browser/browser/src/index.ts`](../../packages/browser/browser/src/index.ts)

<a id="browseroperation-settled--parallel"></a>

#### `browser/operation-settled` — parallel

Awaited non-rewriting notification after one logical operation reaches a durable lifecycle fact. A listener failure cannot replace the Provider result.

```ts cordis-catalog
/**
 * Awaited non-rewriting notification after one logical operation reaches a durable lifecycle fact.
 * A listener failure cannot replace the Provider result.
 * @param context - Exact logical operation and lifecycle phase that reached a fact.
 * @param settlement - Prepared marker, conclusive result, or conservative delivery error.
 * @mode parallel
 */
'browser/operation-settled'(context: BrowserOperationContext, settlement: BrowserOperationSettlement): Promise<void> | void
```

Source: [`packages/browser/browser/src/index.ts`](../../packages/browser/browser/src/index.ts)
<!-- END GENERATED cordis-surface -->
