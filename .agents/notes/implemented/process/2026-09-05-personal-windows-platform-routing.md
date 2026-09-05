# Agent Note: Windows-first personal platform routing

Status: implemented

English | [中文](2026-09-05-personal-windows-platform-routing.zh.md)

## Problem

The personal downstream is operated on Windows 10 but inherits a cross-platform codebase and official-upstream automation. Treating an available runner as the product target can replace native Windows evidence with a Linux result, require Linux infrastructure the user does not operate, or discard portable behavior merely because Linux is not deployed.

Local Windows 10, GitHub-hosted Windows, GitHub-hosted Linux, and official-upstream infrastructure prove different facts. Work planning and completion reports need to preserve those evidence roles without creating another task registry or changing the product's supported-platform contracts.

## Decision

The [`dsh-personal-platform-routing` skill](../../../skills/dsh-personal-platform-routing/SKILL.md) classifies work by product target, execution carrier, evidence role, blocking claim, and reason. The route remains lightweight metadata in the current plan, WorkItem, or handoff; it is not a new durable control plane.

Local Windows 10 is the primary acceptance environment for personal CLI, Profile, Web UI, service, credential, filesystem, process, watcher, persistence, and real-Provider behavior. GitHub-hosted Windows supplies a clean compatibility result but does not replace the user's exact operating system, Profile, installed tools, credentials, or interactive workflow.

Linux is not a personal deployment target. GitHub-hosted Linux runs only when changed behavior owns a cross-platform or Linux-specific contract, a release artifact needs its native producer, or work targets official upstream. WSL, containers, remote Linux hosts, self-hosted runners, repository-setting changes, and deployments remain separate explicitly authorized work.

The absence of Linux deployment does not remove portable product behavior. Cross-platform source retains host-native fixtures and affected Linux evidence. Linux-only evidence is non-blocking for a Windows-only personal outcome only when the changed code and completion claim do not own that contract.

The personal fork's automatic pull-request verdict remains the Windows-hosted workflow defined by [Fork-owned Windows differential CI](2026-08-29-fork-windows-differential-ci.md). A branch push without a matching workflow run supplies no remote CI evidence. Upstream or release claims use their own current platform matrix and cannot inherit the fork's Windows-only verdict.

Failures are compared with a trustworthy base on the same platform before classification. Branch regressions block the affected claim; inherited failures remain visible debt and are not relabeled as passing evidence.

## Alternatives considered

**Remove Linux checks from the codebase.** This would confuse a deployment preference with a supported-behavior change and hide regressions in portable or Linux-owned contracts.

**Use Linux CI as the universal completion signal.** Linux is readily available in hosted automation, but it cannot prove NT paths, permissions, process behavior, local Profiles, credentials, or the user's Windows 10 workflow.

**Operate personal Linux or self-hosted runner infrastructure.** This adds administration and, for public-fork code, a substantial trust boundary. Hosted carriers provide conditional compatibility evidence without making Linux operations part of the personal product.

**Require Windows and Linux for every task.** Documentation, schema, and other platform-neutral changes do not automatically need duplicate carriers. Routing from the changed claim retains cross-platform proof where it is meaningful without spending it as ceremony.

## Consequences

Personal product completion reports name local Windows 10 evidence separately from hosted Windows and Linux results. A clean hosted result improves reproducibility, while the local exact-checkout observation remains the primary proof for user-operated runtime behavior.

Cross-platform, Linux-specific, release, and upstream changes can still require hosted Linux and can block their own claims. The user does not need to install or administer Linux merely to preserve that evidence.

Future adoption of a Linux deployment target, a self-hosted runner, or an expanded personal CI matrix requires an explicit scope change. Until then, those systems cannot become hidden prerequisites for ordinary personal Windows work.
