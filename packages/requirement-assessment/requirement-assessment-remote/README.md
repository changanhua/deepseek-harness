# Requirement Assessment Remote

English | [中文](README.zh.md)

Trusted Host namespace `requirementAssessment` exposes `list({workspaceId})`, `get({workspaceId,id})`, and `review({workspaceId,requestId,subject,text?,evidence?,supersedes?})`. Subject is Manual `{kind:'manual',id,title}`, Plan `{kind:'plan',id}`, or Focus `{kind:'focus',id,planId}`. Manual requires text; evidence accepts only source and excerpt. Actor comes from deployment `operatorId`, and the selected workspace is checked against Workspace Registry at operation boundaries.

Responses are `{assessment,drift}` (or an array for list); Typert wraps client results. Drift is `fresh`, `stale`, `unknown` or `unavailable`. Manual has no external current revision and returns unknown. Missing/unreadable Planning subjects never return fresh. Live status reads do not rebuild historical input, mutate Planning or automatically rerun a review.

## Invariant policy

No invariant companion is published: this adapter owns no durable projection or second source of truth.

## Model Experience

### No direct model context

#### What the model sees

`ctx.requirementAssessmentRemote`: No tools or prompt are registered by this adapter. The review service owns the bounded evaluation request.

#### Token effect

Reads spend no model tokens. Only an explicit review invokes the evaluator.

#### KV Cache effect

None directly; the review runner owns model input.

## Known Limitations and Deferred Work

- Local Host operator identity follows the existing Planning Remote trust model; this is not a multi-tenant authentication layer.
- List compares all assessments against one authorized Planning snapshot; it never fetches opaque resources.
