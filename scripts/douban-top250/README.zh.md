# 豆瓣 Top 250 电影价值流水线

[English](README.md)

基于队列的两阶段批处理：为豆瓣 Top 250 的每部电影挖掘并持久化一条“最大价值”，阶段之间用可执行脚本做质量闸门。

## 流水线

1. 用当前结构化榜单替换 `movies.json`（`rank/title/year/director`）。
2. 在任务队列 host 行启用 `node` executor。
3. 按 25-50 部一批，为每部电影入队一个阶段一任务：`step1-prompt.mjs '<movie-json>'`。
4. 运行 `check-stage1.mjs`，只重跑 `failed` 的电影，直到通过。
5. 为每部电影入队一个阶段二任务：`step2-value.mjs '<movie-json>'`。
6. 运行 `check-stage2.mjs`，查看确定性抽检样本，再用 `run-report.mjs` 生成验收视图。
7. 运行 `sync-to-feishu.mjs` 把本地行批量 upsert 到飞书妙搭应用数据库（默认 online 环境）。

## 文件

- `lib.mjs` — 共享的 SQLite 与火山引擎 DeepSeek 辅助函数。
- `movies.json` — 结构化榜单；请替换为完整的最新 Top 250。
- `step1-prompt.mjs` — 阶段一：生成该电影的专属分析提示词。
- `step2-value.mjs` — 阶段二：执行该提示词并持久化 `{ value, reason }`。
- `check-stage1.mjs` — 闸门 A：完成率与过度重复的提示词。
- `check-stage2.mjs` — 闸门 B：完成率与确定性抽检样本。
- `run-report.mjs` — 数据库验收视图。
- `sync-to-feishu.mjs` — 批量同步到飞书妙搭应用数据库（`app_17c82usaxjd`，默认 online，幂等 upsert）。

## 数据库

默认：`$DSH_HOME/task-queue/results/douban-top250.db`，可用 `--db <路径>` 覆盖。每部电影一行，记录 `prompt_status`、`value_status`、`prompt`、`value`、`reason`、`attempts` 与最新 `error`，因此每个阶段都幂等且可断点续跑。

## 飞书同步

目标应用：飞书妙搭「豆瓣电影价值库」（`app_17c82usaxjd`）。`sync-to-feishu.mjs` 经 `lark-cli apps +db-execute` 把本地行按 `title` 幂等 upsert 到远程 `movies` 表（PostgreSQL），默认写 online 环境；可用 `--app-id` / `--environment` 覆盖。结构变更先落 dev，再经 `lark-cli apps +db-env-migrate` 发布到 main。

## API

默认走火山引擎 OpenAI 兼容端点：base URL `https://ark.cn-beijing.volces.com/api/v3`，模型 `deepseek-v4-flash`。Key 解析顺序：`DOUBAN_LLM_API_KEY`，其次 `ARK_API_KEY`，再次 `DEEPSEEK_API_KEY`。可覆盖：`DOUBAN_LLM_BASE_URL` / `ARK_BASE_URL`、`DOUBAN_LLM_MODEL`。
