---
description: "The evaluation package group: deterministic regression contracts and keyless snapshot execution, for readers choosing or extending DSH evaluation."
kind: "package-group"
---

# eval/ — deterministic regression evaluation

English | [中文](README.zh.md)

## Summary

The eval group lets callers compare recorded DSH behavior without a judge model. `eval` owns strict suite/run values, ordered execution, outcome folding, and reports. `eval-session-snapshot` drives those cases through the existing keyless ACP snapshot harness. Recording, replay derivation, and snapshot normalization remain owned by the test-support packages.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Choose the pure contract library unless the evaluation must boot a DSH application and compare persisted session logs.

| Package | Role |
|---|---|
| [`eval`](eval/README.md) | Strict suites and runs, ordered execution, four-class outcome folding, and stable reports |
| [`eval-session-snapshot`](eval-session-snapshot/README.md) | Keyless ACP replay executor and normalized session-log comparison |

The checked-in [`minimal-v1` suite](eval-session-snapshot/suites/minimal-v1/suite.json) provides ten cases and twenty independent route fixtures for the first reproducible comparison.

<a id="related-documentation"></a>
## Related documentation

- [Deterministic Eval decision](../../.agents/notes/implemented/architecture/2026-08-31-deterministic-eval-contract-and-snapshot-adapter.md) — package ownership, evidence classes, and rejected alternatives.
- [ACP snapshot tests](../../.agents/notes/implemented/testing/2026-06-19-acp-snapshot-tests.md) — recording, replay, normalization, and application-launch owner.

<a id="dev-note"></a>
## Dev Note

None.
