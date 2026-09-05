# DSH capability charter

## Epic outcome

**Actor and finished scenario:** <actor uses the supported entry and obtains the observable result>

**Independent result:** <who or what verifies it, and why the producer cannot merely self-declare success>

## Self-hosting boundary

**Applies:** `no — ordinary external development` | `yes — DSH is developing, judging, admitting, or releasing DSH itself`

> Complete this section only when `Applies` is `yes`. A developer editing the DSH repository with ordinary tools does not make the work self-hosted. Freeze this record before subject execution; do not let the subject fill missing fields after observing a result.

| Identity / isolation field | Controller known-good DSH | Subject DSH | Independent verifier |
| --- | --- | --- | --- |
| Checkout and revision | <approved checkout + immutable revision> | <target checkout + start revision / dirty identity> | <separate checkout + immutable revision, or human review identity> |
| Build artifact | <build path and digest/version> | <candidate build path and digest/version> | <verifier build/tool identity and digest/version> |
| Skill snapshot | <approved Skill paths + content digests> | <candidate/changing Skill paths + content digests> | <approved verifier Skill/checker snapshot + digest> |
| Profile / runtime configuration | <Profile/config identity and launch identity> | <candidate Profile/config identity and launch identity> | <verifier Profile/config identity and launch identity> |
| `DSH_HOME` | <controller-only home> | <subject-only isolated home> | <verifier-only home or explicit read-only evidence path> |
| Data root | <controller-only data root> | <disposable subject data root> | <verifier data root / declared evidence input> |
| Log root | <controller log root> | <subject log root> | <verifier log root> |
| Ports | <controller allocation> | <non-overlapping subject allocation> | <non-overlapping verifier allocation> |

### Controller-owned immutable Verifier plan

- Plan digest: <content digest recorded before subject execution>
- Assertion: <world behavior / artifact claim that closes or rejects the vertical>
- Commands and checker: <exact command(s), checker implementation/version/digest>
- Fixtures and golden inputs: <immutable paths/identities and content digests, or `none`>
- Environment inputs: <non-secret variables, platform/runtime inputs, and their identities; never record credential values>
- Evidence destination: <controller/verifier-owned artifact location and retention>

### Credential & cost authority

- Status: `none` | `approved for this run`
- Authorization: <`none` or human authorization ID>
- Target and provider/model: <target operation plus provider/model, or `none`>
- Scope and budget ceiling: <allowed request/data scope and max cost/tokens, or `none`>
- Expiry: <valid-until timestamp, or `none`>

### Rollback and human authority

- Rollback: <recoverable subject checkout/build/data point and known-good controller launch>
- Human authority: <who alone may merge/push/publish/migrate, and which evidence they require>
- No self-certification: <why the subject runtime and any Skill it changes cannot be the sole acceptance verifier>

## Boundary

| Concern | Frozen decision |
| --- | --- |
| Definition | <stable contract and obligations, or to verify> |
| Provider | <implementation/lifecycle owner, or to verify> |
| Consumer | <Tool/UI/API/Goal/Workflow caller, or to verify> |
| Bridge | <named cross-domain connector, or explicitly none> |
| Authority and visibility | <human/Host/model/project/Session/external boundaries> |
| Lifecycle and persistence | <foreground/process-local/Session-durable/host-durable; cancel/retry/recovery/retention> |
| Supported entry | <Profile/Bundle plus user-visible path> |
| Evidence artifacts | <report, record, trace, result, or UI; owner and audience> |

## Required real vertical

1. **Input and identity:** <input, fixed revision/configuration/model/authority where needed>
2. **Composition:** <Profile/Bundle and selected provider/consumer>
3. **Execution:** <real action and in-scope side effects>
4. **Observed evidence:** <artifact or visible state read by the appropriate actor>
5. **Decision:** <pass/fail, accept/reject, retry/block, or equivalent>

## Five-layer closure evidence

| Layer | Disposition | Proof or reason |
| --- | --- | --- |
| `source-contract` | `required` or `N/A with reason` | <definition/ownership proof, or why no source contract applies> |
| `generated-declaration` | `required` or `N/A with reason` | <generated surface proof, or why no generated surface applies> |
| `composed` | `required` or `N/A with reason` | <Profile/Bundle proof, or why composition does not apply> |
| `runtime-observed` | `required` or `N/A with reason` | <exact live-process observation, or why no runtime surface applies> |
| `behavior-verified` | `required` | <real vertical result; required for Epic closure> |

## Explicit non-goals

- <out-of-scope feature or platform generalization>
- <out-of-scope migration, compatibility, or automation>

## Open facts for the next workflow

- <current-contract or reuse fact for dsh-reuse/xia-pluginmaster to verify>

## Top-level closure condition

<The Epic is complete only when the required real vertical is behavior-verified, its evidence is available to the stated actor, and every frozen boundary/non-goal remains true. A kernel, schema, fixture, or unit-test-only slice does not close this charter.>
