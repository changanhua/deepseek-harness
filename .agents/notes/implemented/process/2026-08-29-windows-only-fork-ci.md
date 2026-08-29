# Agent Note: Windows-only fork CI

Status: implemented

English | [中文](2026-08-29-windows-only-fork-ci.zh.md)

## Problem

This fork develops and validates the supported application on Windows. Automatic Linux, macOS, release-packaging, preview-deployment, issue-management, and real-API workflows consume runner capacity and report failures that do not decide whether the Windows application is usable.

## Decision

Pull requests run four native `windows-latest` jobs from `.github/workflows/ci.yml`: build, coverage, Windows-specific tests, and non-blocking observational checks. Superseded pull-request runs are cancelled.

The repository Actions settings keep the unrelated automatic workflows disabled. Dispatch-only build, publication, and deployment workflows remain available for an explicit release operation.

## Alternatives considered

**Keep the upstream cross-platform topology.** This spends runner capacity on operating systems and release paths that this fork does not support during ordinary development.

**Remove remote validation entirely.** Local verification remains authoritative for scoped changes, but native hosted Windows checks still expose environment-specific failures before a merge.

## Consequences

Pull requests produce a small Windows-focused check set without waiting for unavailable upstream runner labels or unrelated automation. The fork does not receive automatic Linux, macOS, Wine, Landlock, Python runtime-wheel, package-release, preview, issue-policy, or real-API evidence; re-enable the owning workflow before relying on one of those targets.
