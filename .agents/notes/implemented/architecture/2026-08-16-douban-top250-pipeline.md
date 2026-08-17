# Agent Note: Douban Top 250 two-stage queue pipeline (Narrative Mechanism Diagnostician)

Status: implemented

English | [中文](2026-08-16-douban-top250-pipeline.zh.md)

## Problem

Two LLM passes per movie × 250 movies requires quality control, idempotent recovery, and durable result storage. Letting the model judge quality or batch-running everything at once makes the entire run unreproducible.

## Decision

Pipeline lives in `scripts/douban-top250/`, executed via the task queue's `node` executor. `movies.json` carries the structured list (`rank/title/year/director`).

**Stage one** (`step1-prompt.mjs`): Uses a "叙事机制诊断师" (Narrative Mechanism Diagnostician) meta-prompt to generate a **bespoke analysis plugin** per movie (core research questions, analysis dimensions, caveats). Output stored in the `prompt` column.

**Stage two** (`step2-value.mjs`): Feeds the stage-one plugin verbatim as the system prompt; the user message contains only movie facts. The LLM produces a full analysis with **no imposed length or format restriction**. `reason` stores the complete analysis; `value` is auto-extracted from the first sentence.

A single SQLite database (`$DSH_HOME/task-queue/results/douban-top250.db`) stores one row per movie with `prompt_status`, `value_status`, `prompt` (plugin), `value`, `reason` (full analysis), `attempts`, and latest `error`, making both stages idempotent and resumable.

Quality is gate-checked: `check-stage1.mjs` enforces prompt coverage and plugin structural completeness; `check-stage2.mjs` enforces value coverage and outputs a deterministic human-review sample. `run-report.mjs` produces the acceptance view. `sync-to-feishu.mjs` upserts rows into the Feishu Miaoda app (`app_17c82usaxjd`) `movies` table by `title`.

The `douban-top250` skill teaches the agent to enqueue batches of 25 via `task_queue_enqueue_batch`, retry only failed tasks, and never report completion without passing gates. The `dsh-task-queue` skill teaches correct `node` executor payload construction.

## Model endpoints

`lib.mjs`'s `callLlm` supports multi-endpoint switching (env var priority):
1. `DOUBAN_LLM_API_KEY` + `DOUBAN_LLM_BASE_URL` (highest)
2. `OPENCODE_GO_API_KEY` + `OPENCODE_BASE_URL`
3. `ARK_API_KEY` + `ARK_BASE_URL`
4. `DEEPSEEK_API_KEY`

Default model: `deepseek-v4-flash` (override via `DOUBAN_LLM_MODEL`).

Credential resolution: process env → `~/.dsh/douban-top250.env` → `~/.dsh/.credentials.yaml`.

## Alternatives considered

- **Single LLM pass per movie** — cheaper, but cannot inspect or reuse the bespoke plugin.
- **Model judges its own quality** — no persistent thresholds, no reproducible report.
- **No gates, batch everything** — if a template issue surfaces after 500 calls, full redo.
- **Use `arkcli` executor instead of `node`** — the `arkcli` adapter is too basic (only `arkcli +chat <prompt>`), no system prompt, model selection, or JSON format support; batch LLM work should always use `node` executor.

## Consequences

- Retries never duplicate LLM work: `done` rows are skipped.
- Crash or session loss: both stages resume from database state.
- Feishu Miaoda DB is a consumption layer, not the source of truth.
- Human attention集中在 three points: initial list & standards, stage-two sample review, final acceptance view.
