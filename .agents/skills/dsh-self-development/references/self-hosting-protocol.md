# DSH self-hosting protocol

Use this reference when a DSH runtime participates in changing or evaluating its own checkout, plugins, profiles, or Skills. The protocol establishes a narrow trust boundary; it does not define a new agent protocol, Queue backend, or release mechanism.

## 1. Roles and trust direction

```text
approved human authority
        │ authorizes irreversible operations
        ▼
known-good controller ──typed bounded work──> subject world
        │                                      │
        └──── independent verifier <── artifacts/world state
```

The controller is trusted only for the recorded approved revision, build, Profile, and Skill snapshot. The subject may generate evidence but cannot choose the final assertion, verifier, or acceptance outcome. The human remains the authority for external and irreversible actions.

Do not collapse controller and verifier merely because they are started by the same machine. They may share a machine only if the verifier uses controller-owned, frozen policy and observes a subject-controlled runtime/artifact through a boundary that the subject cannot rewrite.

## 2. Snapshot protocol for dynamically discovered Skills

Repository `.agents/skills` content can be reread dynamically. Therefore launch-time file paths do not freeze policy.

Before starting a self-hosted run:

1. Choose the approved controller revision and enumerate each Skill it may use.
2. Copy or otherwise make immutable the exact `SKILL.md` and required referenced instructions into a controller-owned snapshot outside the subject worktree.
3. Record a deterministic digest for each file and a manifest digest for the complete policy set. Record the relative path, digest, and snapshot location in task metadata.
4. Launch the controller using the snapshot. Forbid live registry rereads for policy selection during this run.
5. Treat a Skill changed by the task as subject content. Test its trigger/content through the subject runtime, but do not use it to route, grade, or approve that same task.

If a required controller Skill has no prior approved version, use a separately approved external controller policy for the first bootstrap run. The candidate Skill may then become a future controller candidate only after an independent acceptance run.

## 3. Freeze the verifier plan before subject startup

The verifier has its own policy surface. Before starting the subject, the controller creates an immutable verifier-plan snapshot outside the subject worktree. It includes:

- assertions and exact commands;
- checker/parser code and its runtime identity;
- input fixtures and golden/expected artifacts;
- the closed list of environment inputs the verifier may consume;
- a per-file digest and a manifest digest.

The verifier may execute only this snapshot and read declared subject artifacts. The subject cannot add a checker, alter a golden artifact, expand an environment input, or reinterpret its result after startup. Subject tests, reports, transcripts, and Git diffs are useful diagnostic artifacts, but cannot by themselves satisfy an independent world assertion.

## 4. Runtime fencing checklist

Allocate distinct controller and subject values for every mutable or discoverable surface:

| Surface | Fence |
| --- | --- |
| Git | controller worktree at known-good revision; subject target worktree, with WIP recorded |
| Build/module resolution | independent output/dependency resolution; no subject `lib` or workspace source imports into controller |
| Skill registry | controller immutable snapshot; subject live candidate registry |
| Profile/config | named controller Profile and distinct subject Profile/config files |
| `DSH_HOME` | two unique directories; never the user's normal home |
| durable data | separate data/Queue/session roots, ideally disposable subject data |
| networking | distinct port allocations; controller checks subject endpoint deliberately |
| logs/artifacts | separate roots; evidence is copied/read after completion, not shared as mutable policy |
| credentials | least privilege; normally absent from subject. Any injection, resolution, or use needs recorded run-id, target, provider/model, scope or usage limit, and expiry authorization |

Preflight these values before starting either runtime. If a port or durable data root is unexpectedly already in use, stop and choose a new isolated allocation; do not connect the subject to an existing user service.

## 5. What the verifier must establish

An acceptable verifier executes the frozen verifier plan and checks at least one world fact not equivalent to the subject's success message. It must read only declared subject artifacts and the plan's allowed environment inputs.

Examples:

- The subject Profile starts through `dsh`, exposes the intended registered service, and a controller-side request receives the expected structured result.
- A subject package build exports the new contract and the built consumer loads it rather than source-path code.
- A durable WorkKind writes its result, the subject runtime is restarted, and a controller-owned assertion observes correct recovery without duplicate side effects.
- A recorded ACP Session is replayed against the subject artifact and deterministic comparison finds the expected evidence.
- A real Provider request, separately authorized and with no secret disclosure, produces the model-specific expected mapping and usage record.

Negative cases matter. Verify that the old/incorrect Profile, unauthorized scope, missing artifact, or invalid input fails in the promised way. A subject passing its own unit tests does not establish this boundary.

## 6. Authority for credentials and paid calls

No credential is implicitly inherited from the machine, controller, Profile, or environment. Before this self-hosted run injects, resolves, or uses any credential in either world, record an authorization that names the run id, exact target, provider/model, scope or usage limit, and expiry. Redact the credential value everywhere.

Before any paid call, record the accurate target and an approved budget or maximum amount. A general statement that a provider is available, a prior local-test approval, or possession of a test key is insufficient. Stop when either authorization is absent or exceeds its recorded limit.

Any merge requires explicit human authorization, even when the merge is fast-forward or appears non-destructive. Push, publish, data migration, and deletion remain separately authorized operations.

## 7. Evidence and retention

For every run retain enough data to reproduce or reject it:

- controller revision, target start/result revisions, and WIP identity;
- policy manifest and per-file digests;
- verifier-plan manifest, per-file digests, and allowed environment inputs;
- Profile/config identities with secrets redacted;
- isolated path/port/data identities;
- typed admission/work identifier and cancellation/retry observations where Queue is involved;
- commands or observations selected by `dsh-change-verification`;
- verifier output, generated/behavior artifacts, and known limitations;
- rollback launch/reference and human approvals.

Do not retain secrets in reports, task payloads, Session logs, or Skill snapshots. Treat the evidence root as subject data unless separately protected.

## 8. Failure handling

| Condition | Required result |
| --- | --- |
| controller/subject share live Skill policy or code | contaminated; no acceptance claim; rebuild fenced worlds |
| subject runtime cannot start | report `runtime-observed` not proven; retain diagnostic evidence |
| verifier unavailable | report partial result; do not infer acceptance |
| verifier plan changed, missing, or reads an undeclared input | contaminated; no acceptance claim; recreate the frozen plan |
| credential or paid-call authorization missing/exceeded | stop before resolution/use; retain no secret and request human direction |
| merge requested without explicit authorization | prepare evidence and stop before merge |
| subject mutates out-of-scope shared data | stop work, preserve evidence, require human direction before cleanup |
| retry/cancel occurs | record WorkKind/admission state and verify no duplicate side effect before retrying |
| human authority boundary reached | prepare exact operation/evidence and pause for approval |

## 9. Bootstrap and promotion

Bootstrapping a new self-development capability needs an already trusted outside edge: an external Codex/controller, a known-good released DSH runtime, or a human-reviewed static procedure. One successful candidate run does not make its Skill or runtime a controller. Promote it only after an independent verifier accepts it and the approved snapshot is recorded as the next known-good controller candidate.