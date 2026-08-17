# Douban Top 250 movie-value pipeline

[中文](README.zh.md)

Queue-backed, two-stage batch that mines and persists one durable "value" per movie in the Douban Top 250 list, with executable quality gates between stages.

## Pipeline

1. Replace `movies.json` with the current structured list (`rank/title/year/director`).
2. Enable the `node` executor in the task queue host row.
3. Enqueue one stage-one task per movie, in batches of 25-50: `step1-prompt.mjs '<movie-json>'`.
4. Run `check-stage1.mjs`; rerun only `failed` movies until it passes.
5. Enqueue one stage-two task per movie: `step2-value.mjs '<movie-json>'`.
6. Run `check-stage2.mjs`, review the deterministic sample, then `run-report.mjs` for the acceptance view.
7. Run `sync-to-feishu.mjs` to batch-upsert the local rows into the Feishu Miaoda app database (online by default).

## Files

- `lib.mjs` — shared SQLite and Volcano Engine DeepSeek helpers.
- `movies.json` — structured list; replace with the complete current Top 250.
- `step1-prompt.mjs` — stage one: generates the movie-specific analysis prompt.
- `step2-value.mjs` — stage two: runs that prompt and persists `{ value, reason }`.
- `check-stage1.mjs` — gate A: completion ratio and over-duplicated prompts.
- `check-stage2.mjs` — gate B: completion ratio plus a deterministic review sample.
- `run-report.mjs` — acceptance view over the database.
- `sync-to-feishu.mjs` — batch sync into the Feishu Miaoda app database (`app_17c82usaxjd`, online by default, idempotent upsert).

## Database

Default: `$DSH_HOME/task-queue/results/douban-top250.db`; override with `--db <path>`. One `movies` row per title tracks `prompt_status`, `value_status`, `prompt`, `value`, `reason`, `attempts`, and the latest `error`, so every stage is idempotent and restartable.

## Feishu sync

Target: Feishu Miaoda app "豆瓣电影价值库" (`app_17c82usaxjd`). `sync-to-feishu.mjs` calls `lark-cli apps +db-execute` to idempotently upsert local rows by `title` into the remote `movies` table (PostgreSQL), writing the online environment by default; override with `--app-id` / `--environment`. Schema changes land in dev first and publish to main through `lark-cli apps +db-env-migrate`.

## API

Volcano Engine OpenAI-compatible endpoint by default: base URL `https://ark.cn-beijing.volces.com/api/v3`, model `deepseek-v4-flash`. Key resolution: `DOUBAN_LLM_API_KEY`, then `ARK_API_KEY`, then `DEEPSEEK_API_KEY`. Overrides: `DOUBAN_LLM_BASE_URL` / `ARK_BASE_URL`, `DOUBAN_LLM_MODEL`.
