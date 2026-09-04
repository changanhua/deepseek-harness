---
name: dsh-personal-platform-routing
description: Use when planning, assigning, verifying, or triaging deepseek-harness work in the changanhua personal downstream, where Windows 10 is the operated runtime and Linux is a conditional compatibility carrier rather than a deployment target.
---

# DSH Personal Platform Routing

Route work by the product claim that needs proof, not by whichever runner or shell is easiest to start. This skill applies to the `changanhua/deepseek-harness` personal downstream. If the user names another repository, a Linux deployment, or an upstream contribution, verify that target and do not import the personal defaults silently.

This skill is task-routing guidance. It does not authorize installing WSL, Docker, a Linux server, a self-hosted runner, changing repository settings, creating a pull request, enabling a workflow, or deploying anything. The [Windows-first routing decision](../../notes/implemented/process/2026-09-05-personal-windows-platform-routing.md) owns the rationale.

## Operating contract

- The user's operated product environment is local Windows 10. A personal-runtime completion claim requires evidence from that environment when the change can affect CLI launch, a shipped `dsh` Profile, native processes, paths, permissions, watchers, persistence, browser integration, credentials, or real Provider behavior.
- GitHub-hosted `windows-latest` is a clean Windows compatibility carrier. It does not prove the exact local Windows 10 environment, installed tools, Profile, credentials, filesystem state, or interactive workflow.
- Linux is not a personal deployment target. Use GitHub-hosted Linux only when a changed contract is cross-platform, Linux-specific, release-related, or intended for official upstream.
- Not deploying Linux does not authorize removing portable behavior, weakening an affected Linux test, or describing cross-platform behavior as verified without Linux evidence.
- Do not require the user to operate Linux infrastructure. WSL, containers, remote Linux hosts, and self-hosted runners need an explicit task and authorization.

## Record the route

Before implementation or verification, add a lightweight route to the working plan, WorkItem, or handoff. Do not create a new registry or control plane for it.

```yaml
product_target: windows-10 | cross-platform | linux-specific | upstream-infrastructure
execution_carrier: local-win10 | github-windows | github-linux | upstream-only
evidence_role: primary | compatibility | diagnostic
blocking_for: <the exact completion claim, or none>
reason: <the changed behavior that selects this route>
```

One task may have more than one route. For example, a portable path change can require local Windows 10 as primary product evidence and GitHub-hosted Linux as blocking compatibility evidence.

## Route task classes

| Task class | Execution carrier | Evidence role | When it blocks |
|---|---|---|---|
| Personal CLI, Profile, Web UI, local service, credential, filesystem, process, watcher, persistence, or real-Provider behavior | Local Windows 10; add GitHub-hosted Windows when a clean checkout matters | Primary on local Windows 10; compatibility on hosted Windows | Always blocks the affected personal product claim |
| Platform-neutral TypeScript, API, schema, documentation, catalogs, lint, unit tests, or builds | Run the narrow repository command locally on Windows; consume current PR CI only when a PR exists | Primary for the platform-neutral contract | Blocks when the changed contract is in scope |
| Portable path, subprocess, teardown, locking, native addon, archive, or installer behavior | Local Windows 10 plus GitHub-hosted Linux when the change or claim is cross-platform | Windows product proof plus Linux compatibility proof | Both block a cross-platform claim; Windows blocks a Windows-only personal claim |
| Linux-only primitives such as Landlock, `bwrap`, POSIX mode bits, signals, or Linux package artifacts | GitHub-hosted Linux | Primary for that Linux-specific contract | Blocks only when that contract, an upstream contribution, or a release artifact is in scope |
| Personal-fork Actions, branch protection, or runner routing | GitHub-hosted Windows by default; use hosted Linux only for an explicitly selected compatibility job | Clean remote policy evidence | Blocks the exact repository policy being changed |
| Official-upstream runner pools, standby drills, deployment previews, release publication, or capacity benchmarks | Upstream-owned infrastructure only | Diagnostic or upstream-primary | Does not block the personal Windows product unless the user explicitly adopts that scope |
| Linux deployment | None by default | Out of scope | Stop and obtain a new target before planning or mutating infrastructure |

## Select the evidence

1. State the exact claim. Separate “works for this user on Windows 10,” “portable across Windows and Linux,” and “ready for official upstream”; they have different evidence owners.
2. Inspect current source, workflows, runner availability, branch or PR state, and the commands that own the affected behavior. Do not infer the active matrix from an old note or a branch name.
3. Treat `process.platform`, shell syntax, native paths, permissions, process trees, symlinks, file watching, keyrings, native addons, and filesystem durability as platform-sensitive until the owning contract proves otherwise.
4. For a personal runtime change, exercise the real Windows 10 entry path from the exact checkout and build being accepted. Unit tests or hosted CI supplement this observation; they do not replace it.
5. For a cross-platform change, use host-native fixtures and assertions. Do not normalize Windows into POSIX strings, skip an entire supported package, or emulate Linux behavior and call it native Windows proof.
6. Reproduce a suspected pre-existing failure on the same platform and a trustworthy base. Record branch regressions and inherited failures separately; a baseline failure is not green evidence, and an environment label alone is not a diagnosis.
7. A branch push may produce no pull-request workflows. Query current runs before citing CI, report absent or pending signals honestly, and do not create a PR or synthetic commit without authorization.

## Personal fork CI policy

The personal fork's current automatic pull-request owner is [Fork-owned Windows differential CI](../../notes/implemented/process/2026-08-29-fork-windows-differential-ci.md). Inspect the live workflow before relying on it. It uses GitHub-hosted Windows and does not turn inherited Linux, macOS, Wine, release, preview, or issue-automation jobs into personal product requirements.

Never install a self-hosted runner merely to unqueue public-fork work. Prefer a GitHub-hosted carrier or keep upstream-only jobs repository-guarded. A self-hosted runner, new deployment target, or repository-setting change requires its own authorized task and security review.

When official upstream or a cross-platform release is in scope, use the affected upstream matrix and platform contracts. The personal Windows-only merge verdict cannot be reused as evidence that Linux or release artifacts work.

## Report completion

Report evidence by carrier and role:

```text
Local Windows 10 (primary): <observed behavior or not run>
GitHub-hosted Windows (compatibility): <run/check or not applicable>
GitHub-hosted Linux (compatibility or Linux-primary): <run/check or not applicable>
Excluded infrastructure: <what was intentionally not operated and why>
Claim supported: <the narrow conclusion the evidence permits>
```

Do not say “all platforms pass” when only Windows ran. Do not let Linux green replace required Windows 10 runtime proof. A Linux result may be non-blocking only when the changed code and claimed outcome do not own a Linux or cross-platform contract; state that boundary explicitly.

Use [dsh-pre-push-checks](../dsh-pre-push-checks/SKILL.md) before publishing a branch and [dsh-change-verification](../dsh-change-verification/SKILL.md) before declaring the affected behavior complete. Route a concrete failure through systematic debugging before changing its platform classification.
