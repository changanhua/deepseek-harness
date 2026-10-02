---
description: "Optional Requirement Investment Review UI over trusted Host projections."
kind: "package-reference"
---

# @changanhua/dsh-client-ui-requirement-assessment

English | [中文](README.zh.md)

## Summary

The optional client plugin adds a manual review view and a read-only action in the Planning subject slot. The Host owns assessment persistence, model calls, and authorization.

## Configuration

Mount with the optional investment-review patch from [personal-planning](../../bundle/personal-planning/README.md). It requires the Planning client, assessment Remote, locale, renderer, and navigation owners. It does not alter default profiles.

## Behavior

Create a review from a Plan / Focus action or select a project in the manual view. Only an explicit click starts Quick Review. History retains immutable assessments and captured input; refresh reads live drift without starting a model call. Re-evaluation produces a linked new assessment. Closing the panel or changing its subject cancels outstanding requests and ignores late responses.

All product copy is locale-owned. Model output and code enums are shown verbatim. The interface displays advisory allocation and route, not a total score or execution approval.

## Model Experience

### Explicit review requests

#### What the model sees

Nothing directly; only the Host `ctx.requirementAssessmentReview` runner constructs the model request.

#### Token effect

Reading or refreshing assessments costs no model tokens. An explicitly requested review uses the configured Host model; retrying after cancellation can incur another call.

#### KV Cache effect

No prompt registrations or automatic background model calls.

## Known Limitations and Deferred Work

- Manual subjects have no live canonical revision and display unknown drift. No polling or automatic rerun is performed. Real model quality acceptance requires the three cases in the specification and is separate from fixture UI tests. No invariant companion is published: this UI retains no independent durable relation; lifecycle and projection behavior are verified by component and registration tests.
