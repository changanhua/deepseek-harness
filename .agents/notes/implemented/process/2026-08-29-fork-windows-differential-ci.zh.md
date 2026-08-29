# Agent Note: fork 自有的 Windows 差分 CI

Status: implemented

[English](2026-08-29-fork-windows-differential-ci.md) | 中文

## Problem

此 fork 在 Windows 上进行日常应用程序开发，而继承的全仓库检查包含已知 foundation 失败，以及仅适用于上游的 Runner、发布、部署和 Issue 管理假设。运行继承的 PR 矩阵会占用容量，却无法区分贡献引入的回归与仓库既有债务。

## Decision

仓库的 Actions 设置禁用 `.github/workflows/ci.yml` 和无关的自动工作流。`.github/workflows/ci-fork-windows.yml` 负责此 fork 的 PR 验证，并且只使用 GitHub 托管的 Windows Runner。

阻塞构建作业运行仓库构建和客户端 typecheck，但不构建文档站点。独立的 C0 作业检测 Delivery 所属路径；存在这些路径时，该作业构建可信 base 和 head，在两个 checkout 中运行相同的 Static、Knip、文档、lint 和 duplication 定义，并拒绝 head 新增的诊断。C0 作业还运行定向 Delivery 测试，并执行逐文件 100% 覆盖率门槛。

`fork checks passed` 作业汇总构建和 C0 结果。base 分支 ruleset 要求这个稳定检查名称，因此阻塞作业失败、取消或跳过都会阻止合并。

## Alternatives considered

**替换继承的 CI 工作流。** 重写 `.github/workflows/ci.yml` 会把 fork 策略与上游同步耦合，并让功能 PR 携带全仓库流程更改。

**只在 head 上运行完整的继承检查。** 已知 foundation 失败会让结果持续为红色，并且无法识别贡献是否新增了回归。

**只使用本地验证而不提供远程结论。** 本地证据仍然必要，但它无法强制执行合并边界，也无法证明代码在干净的托管 Windows Runner 上运行。

## Consequences

日常 PR 会得到一个稳定的阻塞结论，不运行 Linux、macOS、Wine、发布、预览或 Issue 自动化作业。Delivery C0 更改需要使用两个干净 checkout 并执行两次构建，以获得可信的失败差集；C0 之外的 PR 会跳过这项差分工作。跨平台和发布证据保持手动执行，直到明确启用其所属工作流。
