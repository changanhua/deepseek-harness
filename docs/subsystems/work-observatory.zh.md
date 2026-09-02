# 工作观测台（Work Observatory）

[English](work-observatory.md) | 中文

工作观测台是一张本地证据视图，只回答一个有限问题：在选定日期或项目中，Web 页面何时可见、人何时处于近期活跃状态，以及何时至少有一个 Session step 尚未结束。它展示观测到的墙钟时间区间，不会把这些数据解释为生产力、投入、CPU 使用量或节省时间。

源码：[`packages/host/work-observatory`](../../packages/host/work-observatory) 与 [`packages/client/ui-work-observatory`](../../packages/client/ui-work-observatory)

## 用户流程

从常驻侧栏打开**工作观测**。选择一个本地日历日期；页面会换算为正确的本地午夜边界，包括夏令时切换。如果当前 Session 属于某个项目，查询会沿用其规范 `cwd`。24 小时证据带先展示来源区间，再给出五项汇总；点击有贡献的 Session 行即可打开该 Session。

各项汇总的含义是：

- **人类活跃**——页面可见且获得焦点，并且近期发生过指针、键盘、滚轮或触摸交互。
- **页面可见**——浏览器报告文档可见，不要求人正在交互。
- **Agent 步骤**——一个或多个 Session `step/start` 区间尚未结束；其中可能包含 Provider、Tool、子 Agent 或等待人的时间。
- **协作重叠**——人类活跃区间与 Agent step 区间重叠。
- **Agent 单独**——Agent step 区间中未与人类活跃重叠的部分。

计算汇总前会先合并并发标签页和 Session 的区间。因此，同一个墙钟时刻对每项首要数字最多贡献一次。

## 证据路径

浏览器为每个文档维护一个活动追踪器。它发送随机文档身份、单调递增序号、可见性、近期活跃状态与当前 Session id，但不发送时间戳。Host 会拒绝陈旧序号，并用 `Date.now()` 为接受的观测盖时间戳，因此被篡改或漂移的浏览器时钟不能凭空制造时长。

页面保持可见时，未变化的心跳只更新最近一次 Host 证据，不会追加另一个状态转换。文档隐藏会清除活跃状态；再次可见后必须发生新交互才会恢复活跃。浏览器休眠、异常终止和传输中断都会让证据停在最后一次收到的心跳处，而不是外推活动时间。

Host 把 Session `step/start` 与 `step/end` 事件投影到同一存储域。这些事件时间戳仍是 Session 日志中的持久执行证据。读取时会把半开区间裁剪到请求范围、合并重叠、计算交集汇总，并用同一套区间算法返回按 Session 下钻的行。

## 持久化与边界

`@deepseek-ai/dsh-host-work-observatory` 通过 `ctx.storageDomain` 存储版本为 1 的 `work_observatory` 域，不会直接打开 SQLite 或文件。独立的 `samples`、`clients` 与 `steps` 表分别保留状态转换历史、最新客户端状态和 Session step 行。每条记录使用路径安全的哈希键，因此 JSON 与 SQLite 存储 Provider 能接受同一格式。

默认保留期是 90 天。单个部署最多接受 128 个并发浏览器身份；单次查询跨度最多 31 天；一次范围读取最多消费 10,000 条已保留的状态转换与 step 记录。这些是部署安全边界，不是分析采样目标。

## 权威性与隐私

所有证据都留在配置的本地 Host 存储中。首版不提供跨 Host 汇总、遥测导出、桌面后台监控、按键内容、指针坐标或浏览历史采集；它只记录粗粒度状态转换和 Session 身份。Queue、Delivery 与 Skill 记录保持独立；未来桥接包可以加入事实标签，但不得声称某个 Skill 导致了某段时长或生产力变化。

## 包所有权

[Host 包](../../packages/host/work-observatory/README.zh.md)拥有校验、Host 时间、保留策略、Session 投影、区间算法与 `ctx.workObservatory` Remote。[Client 包](../../packages/client/ui-work-observatory/README.zh.md)拥有文档追踪器、本地日期控制器、侧栏入口、专用工作区与 Session 导航。已发布的 Web bundle 会组合这两个包。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxworkobservatory--workobservatory"></a>

### `ctx.workObservatory` — `WorkObservatory`

Host service owning durable browser samples, Session-step projection, and range reads.

```ts cordis-catalog
/**
 * Accept one Host-stamped browser state transition or heartbeat.
 * @param observation - monotonic browser state without a client timestamp.
 * @returns whether the sequence was newer than the last accepted observation.
 */
@Remote('observeClient') observeClient(observation: ClientObservation): Promise<{ readonly accepted: boolean }>

/**
 * Read a bounded range; totals and Session rows derive from the same interval algebra.
 * @param request - finite epoch range and optional canonical project path.
 * @returns normalized timelines, headline totals, and contributing Session rows.
 */
@Remote('readRange') async readRange(request: WorkObservatoryRangeRequest): Promise<WorkObservatoryRange>
```

Source: [`packages/host/work-observatory/src/index.ts`](../../packages/host/work-observatory/src/index.ts)
<!-- END GENERATED cordis-surface -->
