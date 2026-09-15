# Delivery-mode learning protocol

This protocol records how `native`, `adaptive`, and `governed` delivery perform in real DSH work. It is a small local feedback loop, not telemetry, a repository Registry, a receipt, completion evidence, or interruption recovery.

## Storage and ownership

The primary agent owns one record per delivery task. The helper writes ignored local state under:

```text
.artifacts/dsh-feature-delivery/
├─ active/<run-id>.json
├─ finishing/<run-id>.json
└─ completed/<run-id>.json
```

Do not commit these files. Supply only short task and effect summaries. The helper rejects absolute paths, external URLs, prompt-shaped values, recognizable credential forms, and unknown options before writing. Callers remain responsible for omitting personal data and external payloads that no syntax check can classify. Workers and reviewers return facts to the primary agent; they do not create competing learning runs.

The active file exists only to retain the start timestamp until `finish`. It is not consulted for Codex interruption recovery. Resume from native task/tool state as usual. A stale active file is an incomplete measurement, not unfinished product work.

## Start and finish

From the repository root, start before the first delivery action:

```text
node .agents/skills/dsh-feature-delivery/scripts/mode-learning.mjs start --mode adaptive --task "Eval Queue bridge"
```

Retain the returned `runId` in the current task plan or OrchestrationReceipt. Finish once at the terminal handoff:

```text
node .agents/skills/dsh-feature-delivery/scripts/mode-learning.mjs finish \
  --run <run-id> \
  --outcome partial \
  --highest-evidence source-contract \
  --effect improved \
  --effect-summary "Independent review found two boundary defects before composition." \
  --action implementation \
  --action focused-test \
  --action reviewer \
  --checks 6 \
  --agent "explorer|gpt-5.6-luna|low|true|1" \
  --agent "reviewer|gpt-5.6-terra|high|true|2" \
  --review-findings 2 \
  --reused-evidence 4
```

When `adaptive` escalates, add `--escalated-to governed --escalation-reason "introduced durable WorkKind"`. `finish` writes the complete terminal record to a private temporary file, creates one exclusive per-run claim from those complete bytes, then atomically promotes it to `completed/` and removes the active file. A retry recovers a matching claim or completed record; different terminal values fail instead of overwriting it. If an older helper left a partial claim while the intact active record remains, `finish` replaces that claim from the active record.

Each `--agent` value is `role|actual-model|reasoning|changed-decision|findings`. Use the runtime-reported model when available, otherwise `unknown`; do not select future agents by copying a historical model string. `changed-decision` is `true` only when that agent changed a contract, implementation, verification scope, or completion conclusion. The helper derives the subagent count from these entries. If no agent was used, omit `--agent`; the OrchestrationReceipt still records why `agentPlan: none` was proportionate.

Allowed outcomes are `completed`, `partial`, `blocked`, and `abandoned`. Highest evidence is one of `not-run`, `implemented`, `source-contract`, `generated`, `composed`, `runtime-observed`, or `behavior-verified`.

## Assess effect conservatively

Use:

- `improved` only when a concrete comparison exists, such as reused evidence avoiding work, a reviewer finding a defect before a later boundary, or a mode escalation preventing a wrong completion claim;
- `neutral` when the mode completed the work but produced no observable advantage or regression;
- `worse` when measured duplicate work, avoidable delay, coordination failure, or a mode-caused defect exceeded its benefit;
- `unknown` when no comparison supports a direction.

The effect summary names the observation, not a general verdict about the mode. Duration alone does not prove a mode is better or worse. A failed product outcome can still reveal a useful mode effect, and a successful outcome does not prove the process was efficient.

## Read recent records sparingly

When no mode was explicitly selected and the choice is genuinely uncertain, inspect a small recent window:

```text
node .agents/skills/dsh-feature-delivery/scripts/mode-learning.mjs list --limit 12
node .agents/skills/dsh-feature-delivery/scripts/mode-learning.mjs list --limit 8 --mode governed
```

Use records as advisory evidence. Stable risk triggers still require `governed`; recent speed cannot waive security, durable-state, self-development, or acceptance boundaries. Do not scan the log on every obvious task, calculate a universal mode score, or automatically rewrite Skills from these records.

## Record shape

Each completed file contains:

```json
{
  "schemaVersion": 1,
  "runId": "...",
  "mode": "adaptive",
  "task": "Eval Queue bridge",
  "startedAt": "2026-08-31T00:00:00.000Z",
  "finishedAt": "2026-08-31T00:08:00.000Z",
  "durationMs": 480000,
  "outcome": "partial",
  "highestEvidence": "source-contract",
  "effect": "improved",
  "effectSummary": "Independent review found two boundary defects before composition.",
  "actions": ["implementation", "focused-test", "reviewer"],
  "counts": { "checks": 6, "subagents": 2, "reviewFindings": 3, "reusedEvidence": 4 },
  "agents": [
    { "role": "explorer", "model": "gpt-5.6-luna", "reasoning": "low", "changedDecision": true, "findings": 1 },
    { "role": "reviewer", "model": "gpt-5.6-terra", "reasoning": "high", "changedDecision": true, "findings": 2 }
  ],
  "escalation": null
}
```

This shape is intentionally local and versioned only for the helper. It is not a DSH public persistence contract.
