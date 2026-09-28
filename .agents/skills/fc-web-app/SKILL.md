---
name: fc-web-app
description: Use when an Agent needs to inspect or operate FC Web App with a fresh browser observation, reuse its sparse application model, or record a bounded evidence-backed update after an FC task.
---

# FC Web App

用于 FC Web App 的读取、操作和经验更新。它保存应用级知识，不是某个 SBC 的自动执行脚本；俱乐部、阵容、转会及未观察区域一律保持 `unknown`。

## 按需读取

1. 先读 `references/application-model.json`。它是应用知识唯一来源，包含范围、页面识别、对象关系、动作模板、任务模式和 evidence/coverage 语义。
2. 依实际浏览器通道读 `references/tool-bindings.md`。Codex 与 DSH 不交换 requestId 或临时引用。
3. 只有当前不确定性或恢复路径对应时，才读 `references/experience.md`。它是带日期的证据索引，不是当前状态。

## 执行循环

1. 发现可用安装并取得新鲜页面观察。
2. 用模型识别页面和对象；未观察字段保持 `unknown`。
3. 选一个动作模板，以新鲜观察满足其前置条件后执行。
4. 按模板读回业务条件。仅收到确认、URL 改变或控件填入均不等于业务成功。
5. `unknown` 时，先在同一通道查询原请求，再考虑写操作。`target_busy` 的请求未发送，应恢复更早的 in-flight 或 unknown 请求。
6. 只有观察和读回支持时才记录简短更新；保留反例并收窄适用范围。

## 边界

- 只使用当前页面身份和控件引用，绝不写入本 Skill。
- 有界读取不能推出完整库存、缺卡、价格、余额、权限或挑战完成。
- 只有当前用户请求授权且新鲜页面确认目标时，才能提交挑战、购买或消耗账户资产。
- DSH 源码、配置或可发现的 Skill 不代表目标 DSH Session 已加载它；需要时单独验证实际 Session。
