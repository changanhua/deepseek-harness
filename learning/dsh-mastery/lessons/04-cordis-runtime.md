# Lesson — Cordis Minimal Runtime

## Why

DSH 的插件化能力只有放进 Context、Service、inject、activation、effect ownership 和 disposal 的生命周期模型中才真正成立。

## Objectives

训练 `cordis_lifecycle` 与 `seam_selection`。

## Mental Model

```text
plugin declared
→ dependencies available
→ activate
→ register services/effects
→ runtime work
→ dependency/plugin disappears
→ dispose owned resources
```

## Source Trace

课程执行时必须以当前 DSH/Cordis checkout 重新定位最小实现路径，不把旧教程 API 当契约。

## Knowledge Check

- 为什么依赖 service 未出现时不应该自己轮询等待？
- timer、listener、route、watcher 分别应该由谁清理？
- 插件 reload 时哪些隐藏全局状态会造成错误？

## Evidence Required

- `explain_activation_and_disposal_story`
- `identify_lifecycle_leaks`
