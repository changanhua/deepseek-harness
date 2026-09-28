# Dated experience index

Use these cases to choose a cautious observation or recovery step. They are not current account facts and do not authorize an action.

## 2026-09-26 — independent Codex connection, SBC list

- Observed: Chinese FC SBC list; the group titled “重大比赛” displayed `0/4` in the loaded list content.
- Action result: clicking a normal group card returned `unknown` / `effect_unverified`; querying that original request was also `unknown`.
- Follow-up: a later action was rejected as `target_busy` and was not sent. A subsequent page read remained on the list.
- Lesson: resolve the earlier original request in the same channel before another write. Do not turn this into a reusable group-entry success rule.

## 2026-09-26 — 早期 SBC 材料

- [FC Web App 落地交接](../../../../docs/specs/2026-09-26-fc-web-app-model-handoff.md)记载了用户提供的侧栏结果：四关、313 张卡、24 个待核验候选和 0 个方案。这些数字不能证明当前库存、覆盖率、可解性或完成状态。
- [FC 27 SBC 助手交接快照](../../../../docs/specs/2026-09-26-fc27-sbc-handoff.md)记录于 2026-09-26 00:19（香港时间），记载了点击整张卡片可能触发收藏/取消收藏。它只是定位歧义，不能证明标题点击当前能稳定进入群组。

## 2026-09-26 — 新 DSH 会话的模型加载试跑

- 运行时报告 preset id 为 `field-cordis`，UI 显示标准模式。该会话成功发现并调用 `fc-web-app`，读取了 `application-model.json` 和 `tool-bindings.md`。
- `browser_instances` 与 `browser_tabs` 成功；`browser_snapshot` 因本会话 `browser_target_unbound` 未发出。
- 因此未读取 TOTW 升级的实页事实，未执行或验收动作；这不是跨 Agent 行为复验通过。

## Recording a new case

Include the date, tool channel, page/task scope, action precondition, outcome, fresh readback, and a conclusion whose applicability is no broader than the evidence. Link the corresponding revision in `application-model.json`; never place credentials, full account inventory, or temporary browser references here.
