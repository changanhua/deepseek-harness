# @deepseek-ai/dsh-client-ui-work-observatory

[English](README.md) | 中文

浏览器侧是 Work Observatory 的 App 级活动生产器，并带一个只读的 **工作观测** 设置分区。`apply()` 会针对 DSH 主文档安装一个 tracker，并注册该分区；生产器本身不读取 iframe 活动，也不改变应用状态。

每个文档生命周期只生成一个内存中的 `clientId` 和单调递增的 `seq`。tracker 发送初始快照；当页面可见且获得焦点时，主文档交互会发送 `active: true`；连续 60 秒没有交互后在本地结束 active；页面可见期间每 15 秒发送一次心跳。它处理可见性、焦点、失焦、pagehide、键盘、指针、滚轮和触摸信号；指针移动最多每 5 秒接受一次。

观测通过 `ctx.remote.workObservatory.observeClient` 按顺序调用。某次调用失败不会阻塞后续观测，effect disposer 会移除监听器和定时器。生产器不维护持久 outbox，也不提供独立的跨标签页身份。

本包还注册了一个只读的 **工作观测** 设置分区。该分区通过 BFF 的 `readRange` 回调加载一段归一化的 Host range，选择本地日历日期（解析为本地午夜 `[from, to)` 的 epoch，DST 安全），并渲染五个会计指标与三条归一化时间线，带加载、错误与重试状态。它从不重算业务指标，也从不自行监听文档活动：tracker 保持应用级生命周期，与分区生命周期相互独立。

## 模型体验

无。浏览器活动观测是 Work Observatory 的运行遥测，不进入 append-only Session 日志或模型上下文。

#### KV Cache 影响

无；tracker 不修改对话历史或 prompt 输入。

## 已知限制与暂缓事项

- **仅主文档** —— 本包不观测 iframe 和跨标签页活动。
- **生命周期状态在内存中** —— 刷新页面和新标签页会获得新身份；不提供持久 outbox 或本地持久化。
