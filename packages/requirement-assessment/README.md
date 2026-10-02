---
description: "Independent requirement investment reviews and immutable evidence history."
kind: "package-group"
---

# packages/requirement-assessment

English | [中文](README.zh.md)

## Summary

Requirement Investment Review retains bounded, advisory investment assessments independently of Planning. It freezes the evaluated inputs and baseline, records uncertainty, and preserves every completed result.

## Packages

- [requirement-assessment](requirement-assessment/README.md) owns the domain schemas and trusted Host service.
- [requirement-assessment-local](requirement-assessment-local/README.md) provides atomic local persistence and evaluator reservations.
- [requirement-assessment-review](requirement-assessment-review/README.md) freezes authorized inputs and runs isolated Quick Reviews.
- [requirement-assessment-remote](requirement-assessment-remote/README.md) serves authenticated human requests and read-time drift projections.

## Related documentation

- [Requirement assessment subsystem](../../docs/subsystems/requirement-assessment.md) describes authority and the review lifecycle.
- [Planning subsystem](../../docs/subsystems/planning.md) owns canonical Plans and Focuses.

## Dev Note

Assessment routes are advice and confer no authority to modify Planning or dispatch execution.
