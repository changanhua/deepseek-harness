# AGENTS.md — DSH Mastery

This file governs AI/agent changes under `learning/dsh-mastery/`.

## Purpose

This directory is a long-lived learning system, not a dump of generated tutorials. Preserve continuity, evidence, and progression.

## Before editing

Read, in order:

1. `TEACHING-CONTRACT.md`
2. `CURRICULUM.md`
3. `PROGRESS.md`
4. the lesson or artifact being changed

## Invariants

- Do not silently change the teaching sequence or mental model.
- If a better teaching strategy conflicts with the contract, propose an explicit contract revision.
- Distinguish current DSH source facts from analogies, local conventions, and historical behavior.
- Prefer current repository evidence for implementation claims.
- Do not mark a lesson complete without an explicit learner checkpoint.
- New lessons must state learning objective, minimal model, concrete story/trace, common failure mode, exercise, and acceptance check.
- Avoid large code dumps before the architecture is understood.
- Preserve SEE / ACT / OWN / SURVIVE and the five-layer model unless an explicit curriculum revision replaces them.
- Treat local custom plugins as case studies, not automatically as best practices.

## Progress updates

`PROGRESS.md` is an evidence ledger. Update it only when there is a concrete learning interaction or assessment supporting the change.

## Source evolution

DSH changes quickly. If a lesson depends on implementation details that drift:

1. re-check the current code;
2. update the lesson;
3. record the conceptual invariant separately from the version-specific implementation;
4. do not preserve stale API details merely for consistency with older text.
