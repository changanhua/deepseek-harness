# DSH Issue Stack Plan Template

Use after Feature Charter approval. Keep IDs stable across revisions. `I1` is a planning ID, not a GitHub Issue number.

```markdown
# <Capability> delivery DAG

## Charter boundary

- Approved outcome: <user-observable outcome>
- Entry path: <Profile/Tool/API/UI/consumer>
- Top-level closing condition: <observable proof>
- Explicit non-goals: <...>
- Current charter status: `not started | in progress | accepted`
- Self-hosting: `no — ordinary external delivery` | `yes — controller/subject/verifier separation required`

> Complete the controller fields and self-hosting edges only when the approved charter says DSH is developing, judging, admitting, or releasing DSH itself. Do not add them to ordinary external work.

## Self-hosting execution boundary (when applicable)

> Freeze this record in the DAG before subject execution. The controller/bootstrap preflight card and every self-hosting acceptance card repeat or immutably reference it; execution cannot fill it in later.

| Identity / isolation field | Controller known-good DSH | Subject DSH | Independent verifier |
| --- | --- | --- | --- |
| Checkout and revision | <approved checkout + revision> | <target checkout + start revision / dirty identity> | <separate checkout/revision or human review identity> |
| Build artifact | <path + digest/version> | <candidate path + digest/version> | <verifier tool/build digest/version> |
| Skill snapshot | <approved Skill paths + content digests> | <candidate/changing Skill paths + digests> | <approved verifier Skill/checker snapshot + digest> |
| Profile/runtime | <Profile/config + launch identity> | <candidate Profile/config + launch identity> | <verifier Profile/config + launch identity> |
| `DSH_HOME` / data / logs / ports | <controller home, data root, log root, ports> | <isolated home, disposable data, logs, ports> | <verifier home/evidence path, logs, ports> |

### Controller-owned immutable Verifier plan

- Plan digest: <pre-execution content digest>
- Assertion / command / checker: <claim, exact command(s), checker identity/version/digest>
- Fixtures / golden inputs: <immutable identities and digests, or `none`>
- Environment inputs: <non-secret runtime/platform inputs and identities>

### Credential & cost authority

- Status: `none` | `approved for this run`
- Authorization, target, provider/model: <all values, or `none`>
- Scope, budget ceiling, expiry: <all values, or `none`>

- Rollback point: <recoverable subject checkout/build/data and known-good controller launch>
- Human-only authority: <merge/push/publish/migration authority and required evidence>

## Dependency graph

```text
I1 kernel ─┬→ I3 bridge ─→ I4 composition ─→ I5 consumer ─→ I6 acceptance
I2 provider┘
```

For self-hosting, make the controller/bootstrap and isolated verifier dependencies visible. Keep the primary role labels unchanged:

```text
I0 composition (known-good controller bootstrap) ─┐
I1 kernel (subject) ─→ I3 bridge (subject) ───────┼→ I5 acceptance (isolated verifier)
I2 provider (subject) ────────────────────────────┘
```

## Delivery cards

### I1 — <short title>

- Role: `kernel`
- Depends on: <none | IDs>
- Executed by: <ordinary delivery actor, or controller/subject/bootstrap/human when self-hosting applies>
- Subject: <ordinary capability artifact, or exact subject checkout/build/runtime/artifact when self-hosting applies>
- Verified by: <focused test/reviewer, or independent verifier/human authority when self-hosting applies>
- Owns: <package, Definition, types, invariant>
- Advances: R1, R3
- Does not close: R2, R4, R5; the charter remains `in progress`.
- DoD: <observable, bounded condition>
- Verification and artifact: <focused command/check and artifact/report>
- Failure/uncertainty: <how failure is classified and surfaced>
- Self-hosting isolation: <N/A for ordinary delivery | controller/bootstrap dependency, isolated DSH home, rollback boundary>
- Self-host record: <required for controller/bootstrap preflight and every self-hosting acceptance card: immutable identity/isolation record or its digest/reference>
- Verifier plan: <required for controller/bootstrap preflight and every self-hosting acceptance card: controller-owned digest + assertion/command/checker/fixtures-golden/environment inputs>
- Credential & cost authority: <required for controller/bootstrap preflight and every self-hosting acceptance card: `none` or authorization ID/target/provider-model/scope-budget/expiry>

<Repeat for each Issue.>

## Requirement traceability

| Requirement | Charter meaning | Owning Issue(s) | Required evidence | Current status | Charter-closing? |
| --- | --- | --- | --- | --- | --- |
| R1 | <...> | I1 | <...> | not started | no |
| R2 | <...> | I2, I3 | <...> | not started | no |
| R3 | <real user path> | I4, I5 | <real request/UI/session evidence> | not started | no |
| R4 | <final acceptance> | I6 | <saved report/recorded observation> | not started | yes |

## Merge and review order

<Dependency order only. State “No GitHub stack action authorized” unless separately authorized.>

## Risks and decisions required

- <Decision that changes ownership, format, authority, or external side effect.>

## Final gate

`Charter outcome is not yet complete; only the listed acceptance evidence can close it.`
```

## Quality checks

- Every requirement maps to at least one Issue and matching evidence artifact.
- A user-visible charter has at least one `composition`, reachable `consumer`, and `acceptance` card.
- Every `kernel` card states which requirements remain blocked.
- When self-hosting applies, every card records `Executed by`, `Subject`, and `Verified by`; the final acceptance card depends on controller/bootstrap, subject work, and an isolated independent verifier.
- The controller/bootstrap preflight card and every self-hosting acceptance card carry the pre-execution identity/isolation record, controller-owned immutable Verifier plan digest, and Credential & cost authority. Missing fields block execution rather than being reconstructed from the result.
- A changed subject runtime or changed Skill is never its own sole acceptance verifier; merge/push/publish/migration remains human-authorized.
- Final acceptance proves the declared entry path, not a library API directly.
- The plan distinguishes implementation order from GitHub PR-stack operations.
