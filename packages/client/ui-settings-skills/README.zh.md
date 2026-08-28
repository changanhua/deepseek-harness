# @deepseek-ai/dsh-client-ui-settings-skills

[English](README.md) | 中文

技能管理功能插件：会话标题栏 Popover 与 Settings 中的 Skills 页面，基于会话寻址的只读 `capabilityRegistry.management` Remote。

本功能包含三部分：

- **视图状态控制器**（`createSkillsFeatureController`）：只承载由 Popover「管理全部」显式带入的会话。它通过 inject `hooks` 舱暴露裸 `HostObservable`（renderer 绑定的 `useAdopted` hook）以及普通 `adopt`/`followCurrent` 回调。不使用 `store` seat：两个槽位于不同 scope（root 设置页与每会话标题栏动作），而 slot 系统把共享 store handle 固定到单一 scope。快照数据不在此处。
- **apply 私有的快照控制器**：负责 `capabilityRegistry.management` 的单一响应寻址槽，暴露裸 `HostObservable`（inject `hooks` 舱 → renderer 绑定的 `useSnapshot` hook）以及普通 `load`/`retry`/`reset` 回调。取数与竞态状态（generation 守卫、last-good 保留）留在这里，不进入组件或视图 store。
- **Popover 与 Settings 页面**：两者都通过各自的派生 props share 组合。目标会话由 adoption 与 `useSessions` 的普通会话事实经纯函数派生；空白、子代理或无普通会话的选择渲染空态，不查询 host 全局 registry。

页面展示生效项置前列表、同名候选遮蔽组（原因 + 胜者 + 来源）、model/user 调用状态、provider/layer/resource kind/root 标签、分组诊断、incomplete/standing 横幅，以及复用同一会话的显式重试。连接重置会清空快照槽；capability-registry management 尚无转发的失效事件，因此其他刷新由用户显式触发。

## Model Experience

无。本功能渲染只读管理 UI，不向模型请求发送任何内容。

#### KV Cache 影响

无；本包不组装模型输入。

## 已知限制与后续工作

- **P0 为只读**——`actions.edit/remove/setInvocation` 仅具信息意义；尚无写入 RPC。
- **adoption 是进程内状态**——显式会话选择不持久化；刷新后回退为跟随当前普通会话。
- **standing 保真度**——冷组合的快照可能静默缺失 realm-only provider；UI 显示 standing 横幅，但无法检测 realm-only 缺失。
