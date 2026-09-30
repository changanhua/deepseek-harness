# Agent Note: Skill quality evidence

Status: implemented

English | [中文](2026-09-29-skill-quality-evidence.zh.md)

## Problem

Skill formatting, process compliance and self-rated improvements cannot establish actual task quality or a Skill's contribution. Freshness hashes cannot detect semantic obsolescence.

## Decision

The user manually invokes [dsh-skill-quality](../../../skills/dsh-skill-quality/SKILL.md). Its rubric evaluates task results, decision quality, scope and autonomy, reliability, current applicability and side effects. Matched baseline and candidate trials distinguish contribution from mere task success. Trace comparisons explain changed decisions; executable results and calibrated human or model judgments provide evidence. Token use is secondary to quality. This workflow does not authorize subagents.

Published Skill evaluations may supply prior evidence when their tested version, model, harness, scenarios, and visible results are recorded. Aggregate or analogous results guide risk reduction and clause-level reuse; they never become a score for a different local Skill.

## Consequences

There is no automatic evaluation, hygiene gate, scheduled task or freshness registry. Each assessment reports its tested scope, failures and uncertainty. The rubric and case bank exist; comparative behavioral trials have not run, so no positive-effect claim follows. The delivery-mode learning protocol remains observational evidence, not causal proof.

## Alternatives considered

**Static checks or self-ratings as quality certification.** These cannot establish semantic correctness or task benefit.

**Automatic re-evaluation after edits.** The user wants manual initiation and substantive standards, not automatic triggering infrastructure.

**A single score optimized for token savings.** It obscures regressions and rewards cheap incomplete work. Separate quality dimensions and consequential failures govern conclusions.
