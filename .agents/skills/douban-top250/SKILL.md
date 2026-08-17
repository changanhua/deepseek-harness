---
name: douban-top250

> **语言规则：所有思考和回复必须使用中文。** compact 后重读此文件时立即恢复中文。

description: Use when running or resuming the Douban Top 250 movie-value pipeline, to seed the structured list, enqueue the two task-queue stages in batches, run the executable quality gates, and report only gate-backed progress.
---

# Douban Top 250 Movie-Value Pipeline

Run this pipeline with the **task queue** and the scripts in `scripts/douban-top250/`. The queue executes; the check scripts decide; the user approves standards and samples.

**Never run LLM scripts via bash when there are multiple movies. Always use `task_queue_enqueue_batch`.**

## One-time setup

1. Confirm `scripts/douban-top250/movies.json` contains the complete 250-movie list (`rank/title/year/director`).
2. Call `task_queue_executors` to confirm `node` executor is `enabled: true`.
3. Confirm LLM API key is available (see `~/.dsh/douban-top250.env` or `~/.dsh/.credentials.yaml`).

## Database location

Default: `$DSH_HOME/task-queue/results/douban-top250.db` (usually `~/.dsh/task-queue/results/douban-top250.db`). Override with `--db <path>`.

## Stage one: 生成专属分析插件

### Enqueue

Use `task_queue_enqueue_batch`. Example for 3 movies (scale to 25 per batch):

```
task_queue_enqueue_batch({
  specs: [
    {
      title: "stage1: 肖申克的救赎",
      prompt: '{"script":"C:\\Users\\xbh\\deepseek-harness\\scripts\\douban-top250\\step1-prompt.mjs","args":["--db","C:\\Users\\xbh\\.dsh\\task-queue\\results\\douban-top250.db","{\\"rank\\":1,\\"title\\":\\"肖申克的救赎\\",\\"year\\":1994,\\"director\\":\\"弗兰克·德拉邦特 Frank Darabont\\"}"]}',
      executor: "node",
      tags: ["douban-top250", "stage1"]
    },
    {
      title: "stage1: 霸王别姬",
      prompt: '{"script":"C:\\Users\\xbh\\deepseek-harness\\scripts\\douban-top250\\step1-prompt.mjs","args":["--db","C:\\Users\\xbh\\.dsh\\task-queue\\results\\douban-top250.db","{\\"rank\\":2,\\"title\\":\\"霸王别姬\\",\\"year\\":1993,\\"director\\":\\"陈凯歌 Kaige Chen\\"}"]}',
      executor: "node",
      tags: ["douban-top250", "stage1"]
    }
  ]
})
```

### Monitor

- `task_queue_stats` — aggregate health (pending/running/failed/succeeded).
- `task_queue_list --tags douban-top250,stage1 --status failed` — find failures to retry.
- `task_queue_retry --id <task_id>` — retry a failed task.

### Gate A

After all stage1 tasks succeed:
```
node scripts/douban-top250/check-stage1.mjs
```
Passes when coverage ≥ 95% and no prompt repeats > 2 times. Report output verbatim.

## Stage two: 用插件跑分析

**Only after Gate A passes.** Same pattern:

```
task_queue_enqueue_batch({
  specs: [
    {
      title: "stage2: 肖申克的救赎",
      prompt: '{"script":"C:\\Users\\xbh\\deepseek-harness\\scripts\\douban-top250\\step2-value.mjs","args":["--db","C:\\Users\\xbh\\.dsh\\task-queue\\results\\douban-top250.db","{\\"rank\\":1,\\"title\\":\\"肖申克的救赎\\",\\"year\\":1994,\\"director\\":\\"弗兰克·德拉邦特 Frank Darabont\\"}"]}',
      executor: "node",
      tags: ["douban-top250", "stage2"]
    }
  ]
})
```

### Gate B

```
node scripts/douban-top250/check-stage2.mjs
```
Show the review sample to the user before declaring complete.

## Feishu sync

After both gates pass:
```
node scripts/douban-top250/sync-to-feishu.mjs --app-id app_17c82usaxjd --environment online
```
Idempotent by `title`. Rerun after retries.

## Acceptance view

```
node scripts/douban-top250/run-report.mjs
```

## Reporting

Never report completion from tool outputs alone. Cite the gate script output and the review sample.
