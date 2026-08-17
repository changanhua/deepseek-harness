# Agent Note: Douban Top 250 两阶段队列流水线（叙事机制诊断师）

Status: implemented

[English](2026-08-16-douban-top250-pipeline.md) | 中文

## 问题

对 250 部电影各做两次 LLM 调用，需要质量控制、幂等恢复和持久结果存储。让模型自行判断质量，或一次性全量批跑，都会让整轮结果不可复现。

## 决策

流水线位于 `scripts/douban-top250/`，经任务队列的 `node` executor 执行。`movies.json` 携带结构化榜单（`rank/title/year/director`）。

**阶段一**（`step1-prompt.mjs`）：用"叙事机制诊断师"母提示词为每部电影生成**专属分析插件**（含核心研究问题、专属分析维度、分析注意事项）。输出存入 SQLite 的 `prompt` 字段。

**阶段二**（`step2-value.mjs`）：将阶段一生成的插件作为 system prompt 直接交给 LLM，user 消息只给电影事实。LLM 按插件要求自由产出完整分析，**不限制长度和格式**。`reason` 存完整分析正文，`value` 从首句自动提取。

一个 SQLite 数据库（`$DSH_HOME/task-queue/results/douban-top250.db`）为每部电影存一行，记录 `prompt_status`、`value_status`、`prompt`（插件）、`value`、`reason`（完整分析）、`attempts` 与最新 `error`，使两个阶段都幂等且可断点续跑。

质量由闸门脚本背书：`check-stage1.mjs` 强制提示词覆盖率并检查插件结构完整性；`check-stage2.mjs` 强制价值覆盖率并输出确定性人工抽检样本。`run-report.mjs` 生成验收视图。`sync-to-feishu.mjs` 把本地行经 `lark-cli apps +db-execute` 按 `title` 幂等 upsert 到飞书妙搭应用「豆瓣电影价值库」（`app_17c82usaxjd`）的 `movies` 表。

`douban-top250` skill 教导 agent 每批 25 个任务经 `task_queue_enqueue_batch` 入队、只重跑失败行、没有通过的闸门不得报告完成。`dsh-task-queue` skill 教导 agent 如何正确构造 `node` executor 的 payload（JSON `{script, args}`）。

## 模型端点

`lib.mjs` 的 `callLlm` 支持多端点切换（环境变量优先级）：
1. `DOUBAN_LLM_API_KEY` + `DOUBAN_LLM_BASE_URL`（最高优先）
2. `OPENCODE_GO_API_KEY` + `OPENCODE_BASE_URL`
3. `ARK_API_KEY` + `ARK_BASE_URL`
4. `DEEPSEEK_API_KEY`

默认模型：`deepseek-v4-flash`（可通过 `DOUBAN_LLM_MODEL` 覆盖）。

凭证读取顺序：进程环境变量 → `~/.dsh/douban-top250.env` → `~/.dsh/.credentials.yaml`。

## 替代方案

- **每部电影只调用一次 LLM** — 更便宜，但无法检视或复用每部电影的专属插件。
- **每批后让模型自行判断质量** — 没有持久阈值，没有可复现报告。
- **不带闸门全量跑完** — 若 500 次调用后才发现问题，需要全部重跑。
- **用 `arkcli` executor 代替 `node`** — `arkcli` adapter 太基础（只做 `arkcli +chat <prompt>`），不支持 system prompt、model 选择和 JSON 格式；批量 LLM 调用应始终用 `node` executor。

## 后果

- 重试不会重复调用 LLM：`done` 行直接跳过。
- 崩溃或会话丢失后，每个阶段都能从数据库状态恢复。
- 飞书妙搭库是结果消费层，不是执行真相层。
- 人工精力集中在三个点：初始榜单与标准、阶段二抽检样本、最终验收视图。
