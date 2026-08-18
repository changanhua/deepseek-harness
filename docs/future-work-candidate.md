# Future work candidate

English | [中文](future-work-candidate.zh.md)

Not-yet-built capability and policy proposals, recorded here so each is easy to find and reference when picked up. Candidates are independent; each has its own scope, acceptance criteria, and risks. The hard-won failures these would prevent are in [lesson.md](lesson.md).

## 1. Runtime command & host-process inspection

A read-only, platform-neutral inspection surface exposing environment and command-resolution facts as structured data, without rewriting commands and without changing the shell tool contract. The agent keeps writing `claude --version`; resolution and diagnosers read facts instead of guessing.

- **Environment inventory** — OS, shell, Node/npm (or the active package manager), and the `PATH` entries relevant to command resolution.
- **Command resolution** — per-platform `resolve(name)`: which artifact kind a name maps to (`exe` / `cmd` / `ps1` / `bat` / a PATH miss), the selected path, alternatives, and the reason. Advisory only: it reports the fact the shell will use, and does not rewrite the command string.
- **Doctor** — a one-shot diagnostic rendering environment and command facts for well-known tools (git, the package manager, the model CLIs) so a failing command can be checked against a known-good baseline.
- **Host-process awareness** — the DSH host pid and protected ports (e.g. the web UI port) so the agent recognizes its own runtime as a protected process before acting.

Inspection is advisory and read-only: it must not change how a command executes, modify user `$PROFILE`, relax ExecutionPolicy, or alter the shell tool's `command`-string contract. Resolution lives behind a platform adapter — Linux/macOS resolve through the existing `PATH` and produce no Windows-specific fields.

Implementation seams identified during exploration:

- `packages/shell/shell-env` — already injects per-execution `DSH_*` facts; a `runtime-facts` contributor can add command-resolution and host-process facts to the existing `collect()` path.
- `packages/shell/pwsh-local/src/resolve.ts` — already owns a dependency-free per-platform resolver; a parallel `resolve-command` module can enumerate `PATH` artifacts and classify them, sharing its definition with tests exactly as `resolvePwshPath` does.
- `packages/shell/tool-pwsh` and `tool-bash` — keep the `command` parameter as-is.

### What was rejected along the way

- **Rewrite the command to the `.cmd` artifact in the executor** — rejected: the premise that the `.ps1` shim fails is false on this deployment, and string-rewriting forces the executor to parse PowerShell syntax. See the [lesson](lesson.md).
- **Rely on prompt instructions only ("remember to use `xxx.cmd`")** — rejected: it moves the burden onto model recall and rots across sessions; a structural fact is durable where a reminder is not.
- **Implement a full runtime model with execution policy and safety in this pass** — deferred: this candidate only adds read-only awareness; policy belongs to a separate design.

### Acceptance criteria (when built)

- A read-only `runtime` inspection surface returns, for a given command name on Windows, the classified artifact kind and selected path, without modifying the environment or executing the command.
- The shell tool's `command` parameter and output schema are unchanged; the agent still writes `claude --version`.
- Linux/macOS resolve through `PATH` with no Windows-specific fields.
- No user `$PROFILE` modification and no ExecutionPolicy change is introduced.

### Risks

- **Diagnosis illusion persists where policy genuinely differs.** On a stricter ExecutionPolicy host the `.ps1` shim may really fail; inspection reports that fact, but the decision to act on it stays with the operator.
- **Scope creep toward a full runtime model.** The candidate deliberately stops at read-only inspection; folding policy/safety in prematurely would reopen the rejected rewrite discussion.

## 2. Daily-batch Chinese synchronization

In this fork, **English is the sole source of truth**; the Chinese counterpart exists only for a single reader (the owner) and carries no review or release obligation. The upstream `translation-pairing` contract (see [docs/i18n/README.md](i18n/README.md)) makes both languages equal authority and forces each pair to re-confirm synchronously on every edit, which is pure cost here: every English change immediately demands a matching Chinese update and a hash re-record, even when the owner does not read the Chinese pages that often.

This candidate decouples the two: keep English as the source of truth, and update Chinese on a **daily scheduled batch** instead of synchronously with each edit.

- **Selective sync, owner wins on merge** — the fork resolves pairing conflicts in favor of the fork side; upstream changes merge in on the owner's schedule.
- **Scheduled script, not immediate** — a daily task runs the pending-English-diff-to-Chinese update rather than blocking each edit.
- **All paired documents** — the relaxation applies corpus-wide, including the generated catalogs (`config-catalog`, `module-graph`, `persistence-catalog`, `tool-catalog`), which are the highest-churn pairs and therefore the largest cost today.

### Proposal

- Relax `verify-translation-pairing` from a hard `doc-sync` gate to a state that tolerates pending Chinese, so an English-only edit does not go red.
- Add a scheduled batch job that translates pending English diffs to Chinese and re-records the `.i18n.yaml` hashes once a day (or on demand).
- Document the fork-specific divergence from the upstream [docs/i18n/README.md](i18n/README.md) contract where the single-reader assumption overrides equal-authority.

### What is deferred

- **No script in this pass** — the synchronization mechanism is recorded here as a candidate only; nothing is automated yet.
- **Translation quality review** — a machine-generated Chinese without human review is accepted because the reader is the owner; terminology drift is tolerated.

### Acceptance criteria (when built)

- An English-only edit does not fail `doc-sync` while the Chinese counterpart is pending.
- A daily (or on-demand) batch updates pending Chinese counterparts and re-records hashes.
- The fork documents that English is the fact source and Chinese is owner-only, diverging deliberately from upstream equal-authority.

### Risks

- **Divergence from upstream.** The fork diverges from the shared bilingual contract; merging upstream pairing changes may conflict (owned by the selective-sync policy).
- **Losing the review signal.** If the Chinese is ever needed for a real release or outside reader, machine-translated, unreviewed text goes out as-is.
