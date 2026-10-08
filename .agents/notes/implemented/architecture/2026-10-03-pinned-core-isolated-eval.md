# Agent Note: Isolated Eval with a Host-pinned trusted core

Status: implemented

English | [中文](2026-10-03-pinned-core-isolated-eval.zh.md)

## Problem

An Agent's description of its tools, skills or successful execution does not establish what ran. Separate process ids and directories also do not stop same-account code from reading a grader's private material or changing execution evidence. Evaluation needs authenticated observations and OS-enforced custody without duplicating Plan admission, Queue, Git leases, Budget or the Agent loop.

## Decision

The trusted computing base contains the Host, its pinned Harness core and approved plugins, and Windows. Agent text, skill instructions and repository task code are untrusted. The Host selects and hashes each role's complete physical core artifact, copies it into a role-specific read-only image, and verifies it before reuse and after execution. Task repositories are data, not implicitly loaded core implementations. This boundary permits core registry observations while excluding arbitrary malicious Harness changes from certification.

Each Subject or Grader runs through the existing `dsh` Profile launcher under a fresh AppContainer without network capabilities. The core Job allows one process. Approved tools route task code to a Host-owned Job with a distinct AppContainer SID, explicit workspace ACLs and bounded output. Process/thread ACLs deny that task identity access to core memory and handles. Private role homes, Sessions and grader state are never shared; the Host grants the Grader only a read-only result copy. The core path adapter translates the actual Windows volume mapping without inventing filesystem identity.

A per-execution key enters the trusted core through a private inherited handle; its carrier is cleared before Agent input. Direction-bound signatures and monotonic sequences authenticate request and response frames. Agent instructions cannot access the key or execute code in this process. The Host accepts registry snapshots only through this channel, observes image/config/process/lease identity independently, and validates actual final model dispatch facts before the existing Budget guard reserves or sends a request. Approved expectation values are comparison inputs, never fallback observations.

The execution owner consumes the original Plan resolution and admission, matches the actual active Queue Attempt and uses its RepoWorkspace lease. Subject and Grader share the cell's repository provenance but have separate execution identities and writable worlds. Manifest references point to retained materials with content digests. Every model dispatch retains the existing Budget owner's request, attempt, decision and usage receipt. A refusal before a model identity exists has evidence but no invented Manifest.

Cancellation requests Agent stop and Session flush before a finite force-stop deadline. The Host joins the protocol, broker and entire Job before cleanup. Evidence transfers under exact-digest acknowledgement; missing acknowledgement, unknown usage or uncertain quiescence retains custody and produces Queue unknown Attention. Native resources close after confirmed quiescence; referenced files survive until handoff. Cleanup captures directory identity and unlinks junctions instead of following them. Windows Session write-through resolves from an existing ancestor so restricted roles do not need a probe at the volume root.

## Alternatives considered

**Trust Agent JSON or expected capability lists.** Rejected because both can describe a composition that never executed. The locked core reads actual scoped registries, and the Host retains mismatches rather than substituting expected values.

**Let task code run inside the core or inherit its identity.** Rejected because it would gain the core's signing memory and private state. A process boundary with the same unrestricted account is insufficient; distinct AppContainer identities and Job/process ACLs enforce the boundary.

**Attest arbitrary modified Harness implementations.** Not provided by this trust model. It requires a separately trusted execution/observation runtime and independent verifier. Pinning an approved core is an explicit restriction, not evidence that malicious core code is safe.

**Create an Eval scheduler, budget ledger or durable evidence store.** Rejected because those owners already exist or belong to downstream run-control and retention work. This library owns one execution and its transfer, not a GateDecision or automatic continuation.

## Consequences

The [package contract](../../../../packages/eval/eval-isolated/README.md) requires Windows x64, explicit core images, same-volume workspaces and approved task-bridge plugins. Writable worlds have sampled growth limits with graceful/forced cancellation, but no filesystem quota or bound on one-interval overshoot. Missing capabilities or OS isolation fail closed; no in-process fallback exists. Core upgrades require fresh approval and pins. A keyless composed test proves execution mechanics, not current provider quality or independent self-development certification.

Required evidence includes real Profile startup, cross-role canary read/write denial, task-to-core process/thread access denial, forbidden core child creation, authenticated replay/tamper rejection, actual capability mismatch, Budget denial with zero HTTP, graceful Session flush, full Job quiescence and failed-handoff retention. Built-artifact tests must consume the bundled worker/preloader rather than TypeScript emit files. The [producer and Budget decision](2026-10-02-trusted-eval-producers-and-resource-budgets.md) remains active because its admission, ledger and lease ownership is unchanged; this note adds the execution trust boundary.
