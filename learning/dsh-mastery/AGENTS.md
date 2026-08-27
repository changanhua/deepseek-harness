# AGENTS.md — DSH Mastery Lab

This file governs Agent changes under `learning/dsh-mastery/`.

## Purpose

This directory is an engineering training runtime for building independent DSH / Agent Runtime judgment. It is not a tutorial dump and not a manually maintained checklist.

## Before editing

Read, in order:

1. `TRAINING-CONTRACT.md`
2. `CURRICULUM.yaml`
3. relevant files under `evidence/`
4. the lesson, lab, case, or tooling artifact being changed

## Invariants

- `CURRICULUM.yaml` is the single curriculum/capability graph truth.
- Do not create a second manual progress ledger.
- Do not mark mastery because content was read or a learner said “懂了”.
- Mastery requires evidence of transfer to an unseen example or real engineering task.
- Failed attempts are valid evidence and must not be discarded when they reveal a misconception.
- Distinguish current DSH source facts from teaching abstractions, local conventions, and historical behavior.
- Prefer current repository/runtime evidence for implementation claims.
- Use trace-driven source learning; avoid broad linear source tours when a smaller path answers the question.
- Local custom plugins are case studies, not framework contracts.
- Case-study existing solutions stay hidden until independent reconstruction evidence exists.
- Prefer adapting an existing DSH seam or precedent before inventing a new primitive.
- Any new primitive must state why composition of existing seams is insufficient.

## Training-unit quality

A lesson should establish a mental model and include a knowledge check.
A lab must require an observable action, prediction, experiment, modification, or verification.
A case study must separate problem reconstruction from solution reveal.
A challenge should minimize scaffolding and test transfer.

Use the templates under `templates/` rather than inventing a new layout without reason.

## Evidence

Evidence records live under `evidence/` and should follow `evidence/README.md`.

An evidence record should capture:

- unit and capability IDs;
- target DSH commit/version when relevant;
- learner prediction or design before reveal;
- observed source/runtime facts;
- verification result;
- misconception or failure if any;
- assessment and next-routing implication.

Do not rewrite old evidence merely to make the learner look successful; append a later correction instead.

## Source evolution

DSH changes quickly. If implementation details drift:

1. re-check the target source/commit;
2. update version-specific training material;
3. preserve the conceptual invariant only if it still holds;
4. record evidence with source version/commit;
5. do not keep stale APIs for narrative consistency.

## Tooling direction

Future `tooling/next`, `tooling/status`, and `tooling/check` should derive state from `CURRICULUM.yaml + evidence/`. They must not introduce another authoritative progress store.
