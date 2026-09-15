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
/** Current consumers: interactive tools, explicit page intake, and finite monitor checks. */
type BrowserAction =
  | { readonly kind: 'tabs' }
  | { readonly kind: 'snapshot'; readonly tabId: number; readonly frameId: number; readonly documentId?: string; readonly query?: string; readonly offset?: number; readonly limit?: number; readonly textLimit?: number; readonly tree?: boolean; readonly treeCursor?: string; readonly treeLimit?: number; readonly includeOptions?: boolean }
  | { readonly kind: 'entry_inspect'; readonly page: BrowserPage; readonly regionSelector: string; readonly selector: string; readonly titleSelector?: string; readonly linkSelector?: string; readonly sampleLimit?: number }
  | { readonly kind: 'entry_mount'; readonly page: BrowserPage; readonly mountId: string; readonly regionSelector?: string; readonly selector: string; readonly label: string; readonly titleSelector?: string; readonly linkSelector?: string; readonly collected?: readonly string[] }
  | { readonly kind: 'entry_unmount'; readonly page: BrowserPage; readonly mountId: string; readonly forgetCollected?: boolean }
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
}
```

```ts type-equiv
/** One caller-owned operation; providers enforce the instance's current grant. */
interface BrowserOperation {
  readonly sessionId: SessionId
  readonly installationId: string
  readonly action: BrowserAction
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

## 页面入口与站点适配

条目预检与挂载遵循 [Browser 条目契约](../../packages/browser/browser/README.zh.md)。其证据绑定当前区域和字段节点，包括同文档内的替换，而非普通动作的准备票据。文档运行时最多保留 128 条预检记录与 128 条收集记录；收集键和值合计不超过 65,536 个 UTF-8 字节，每个集合最多 512 个链接。容量拒绝保留已有集合。

manifest 显式声明的 `zhihu-feed.js` 内容脚本负责独立的阅读流适配。它的站点选择器不是页面模型默认值，也不构成页面模型泛化证据。模型调用方使用 Cordis preset 的页面模型 Skill 和运行器 facade；`browser_action` 不开放条目操作。

## 准备动作

模型工具在请求审批前准备一项固定动作。提供方持有短期 ticket，绑定会话、安装、授权代次与完整动作；提交时不能替换参数。扩展仅在文档的有界内存中保留目标和表单值，并在执行前同步比较。快照变化或被淘汰、表单状态变化都会使准备失效。

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

每次调用以摘要绑定协议版本、授权代次、请求 ID、会话、安装、截止时间、目标与动作。完全相同的重复请求共享已有回执。重连查询状态，不重新发送动作。扩展在页面效果发生前持久化最小执行意图；日志保留有界结果值，不保存原调用负载。后台重启后，未解决的写操作继续锁定整个标签，锁跨越会话与授权代次。已经初始化的日志丢失时，存储处于不可用状态，不视为空请求历史。

取消只请求停止。回执丢失或超时产生 `unknown`，直到执行器证据确定结果。未解决的写操作持续持锁，直到观察到终态，或执行器确认不会继续执行后由用户显式确认。超时或站点权限丢失均不能证明旧文档已经停止执行。

Puppeteer 执行全部已实现动作。DOM 兼容执行器仅支持 `click`、`fill`、`submit`、`navigate`、`scroll` 和 `wait`，并拒绝新动作类型。截图要求主 frame，base64 上限为 400,000 字符。[网关 README](../../packages/browser/browser-extension/README.zh.md)负责传输边界与配置。[会话控制器](../../packages/api/session-controller/README.zh.md)负责对话历史；该服务不建立第二套消息存储。

## 有限观察与监控

`observe()` 是对 `tabs` 或 `snapshot` 的有限读取，绑定到调用方 Session、安装和固定 observation grant epoch。提供方要求同时具备 read 和 observation scope，观察快照不会填充交互元素引用缓存。观察不可用是失败 outcome，绝不构成被监控页面未变化的证据。

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

<a id="browser-events"></a>

### `browser/*` events

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
<!-- END GENERATED cordis-surface -->
