# Agent Note: fork 的 Windows-only CI

Status: implemented

[English](2026-08-29-windows-only-fork-ci.md) | 中文

## Problem

此 fork 在 Windows 上开发并验证受支持的应用程序。自动执行 Linux、macOS、发布打包、预览部署、Issue 管理和真实 API 工作流会占用 Runner 容量，并报告无法判断 Windows 应用程序是否可用的失败。

## Decision

PR 通过 `.github/workflows/ci.yml` 运行 4 个原生 `windows-latest` 作业：构建、覆盖率、Windows 专用测试和非阻塞观察检查。新的 PR 提交会取消同一 PR 的陈旧运行。

仓库的 Actions 设置禁用无关的自动工作流。仅支持手动触发的构建、发布和部署工作流仍可用于明确的发布操作。

## Alternatives considered

**保留上游跨平台拓扑。** 这种方案会把 Runner 容量用于此 fork 在日常开发期间不支持的操作系统和发布路径。

**完全移除远程验证。** 本地验证仍是限定范围更改的权威依据，但原生托管 Windows 检查仍可在合并前暴露环境相关失败。

## Consequences

PR 会生成一组精简的 Windows 检查，无需等待不可用的上游 Runner 标签或无关自动化。此 fork 不会自动获得 Linux、macOS、Wine、Landlock、Python 运行时 wheel 包、软件包发布、预览、Issue 策略或真实 API 证据；在依赖其中一个目标之前，请重新启用其所属工作流。
