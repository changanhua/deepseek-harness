# Agent Note: Parent-free Codex app-server run

Status: implemented

English | [中文](2026-08-29-parent-free-codex-app-server-run.zh.md)

## Problem

The Codex Subagent Provider resolves its working directory from a parent Session, while a host-owned delivery attempt needs to run in a trusted Git worktree without inventing an Agent or Session identity. A fabricated parent would make lineage and authority data look real even though the host, not a Session, owns the attempt.

The app-server lifecycle already receives the prompt, cancellation signal, working directory, process spawn operation, environment, permission mode, and teardown bound as resolved inputs. Its Parent dependency belongs to the Provider adapter rather than the Codex process driver.

## Decision

`packages/subagent/subagent-codex/src/run.ts` separates the implementation-only `startCodexAppServerRun()` entry point from the shared Subagent adapter. The low-level request contains only `prompt` and `signal`; `CodexRunSpec.cwd` supplies the explicit absolute workspace. The existing `startCodexRun()` adapter removes the Parent field and delegates to that entry point after `CodexProvider` resolves the parent Session cwd under the existing policy.

The implementation-only entry point is not exported from the package root and does not establish a `ctx.codeExecutors` capability seam. A later delivery Consumer can use this result as feasibility evidence, but a second production Consumer must justify the final service contract, package ownership, and provider registry.

The shared local Subprocess Provider remains the process-tree owner. An AbortSignal settles local cancellation and sends a best-effort Codex interrupt; the caller must then await `SubagentRun.dispose()`, which terminates the managed tree and waits for quiescence. A canceled result alone does not prove process exit.

## Verification

The deterministic suite proves exact parent-free prompt, signal, and cwd wiring. It also proves that cancellation settles the run while disposal remains pending until the managed process reports exit.

The real-product suite contains a linked-worktree scenario that asks pinned `@openai/codex` to create a relative-path proof file and verifies the exact prompt, cwd, Git root, common directory, and file location. Its cancellation scenario holds a real Responses request open, captures the process tree (including distinct Node-wrapper and native-Codex identities on Linux), aborts, awaits disposal, and verifies that every captured identity is dead.

On the 2026-08-29 Work Mode executor, both the unchanged approve-for-me real-product baseline and the new scenarios stalled before run publication after Codex warned that it refused to create PATH helper aliases under `/tmp`. Therefore this checkout has no passed real-product Gate B evidence. A baseline-capable merge environment must first pass the unchanged baseline, then both parent-free scenarios; a new-scenario failure is attributable only after the baseline passes.

## Alternatives considered

**Make `SubagentStartRequest.parent` optional.** Rejected because Parent is a required authority and lineage input for the shared Subagent seam and its in-process Providers. One host-owned execution path does not justify weakening that contract for every caller.

**Fabricate a minimal Parent Agent.** Rejected because the object would claim a Session identity and workspace ownership that do not exist. It would also couple a durable delivery attempt to whatever additional Parent fields future Subagent Providers read.

**Add a public code-executor seam during the spike.** Rejected because no production Delivery Consumer or second Provider exists yet. Publishing a registry now would make the spike choose a service contract without current-consumer evidence.

**Fall back to `codex exec --json`.** Rejected because the existing pinned app-server driver accepts all required explicit inputs and already composes with the process-tree owner. A second Codex transport would duplicate permission, failure, cancellation, and result normalization.

## Consequences

Delivery implementation can proceed without a fake Parent Agent, and the existing Subagent Provider keeps its external behavior. The parent-free function remains an internal feasibility boundary rather than a stable cross-package API until the Delivery Consumer establishes the missing contract.

Every host-owned caller must provide a validated cwd and trusted spawn closure and must await disposal on success, failure, or cancellation. The real-product proof requires Git and the pinned Codex platform package; deterministic wire and lifecycle unit tests remain the lower-cost coverage for ordinary changes.
