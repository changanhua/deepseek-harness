---
name: dsh-task-queue
description: Use before submitting or managing durable cross-session background tasks through task_queue_* tools, to choose the right executor, encode payloads correctly, monitor, retry, or cancel work, and configure concurrency and model endpoints.
---

# DSH Task Queue

Use the `task_queue_*` tools for durable, cross-session background work. Consult this skill before enqueueing anything.

## When to use the queue

- **Three or more** independent tasks, a long-running job, work that may need retry, or anything that must survive the session.
- Inline execution (via bash) is only for a single quick interaction. Everything else goes through the queue.

## Before enqueueing — always do these three checks

1. **`task_queue_executors`** — call this first. Only use executors whose `enabled` and `toolAllowed` are both `true`. If the executor you need is not enabled, ask the user to enable it in `packages/bundle/base/cordis.patch.yml` under the `task-queue` row's `executors` map.
2. **`task_queue_stats`** — call at session start to see the backlog and avoid duplicate work.
3. **`task_queue_list`** — call before enqueueing to check for existing matching tasks (use `tags` filter).

## Executors — what they actually do

| Executor | What it runs | Prompt format | When to use |
|----------|-------------|---------------|-------------|
| `node` | A local Node.js script | JSON: `{"script":"<abs path>","args":["..."]}` | **Batch LLM calls**, data transforms, scripted work |
| `arkcli` | `arkcli +chat <prompt>` | Plain text (the full instruction) | Quick one-off ARK model calls; **not for batch** |
| `claude` / `codex` / `opencode` | Full CLI coding agent | Plain text (the full instruction) | Interactive coding tasks |
| `shell` | **Forbidden** | — | Inbox-only; tools always reject it |

**For batch LLM pipelines (like douban-top250): always use `node` executor.** The `arkcli` adapter is basic — it only passes the prompt as a positional arg to `arkcli +chat`, with no support for `--instructions`, `--model`, or `--text-format`. The `node` executor gives you full control via your own script.

## How `node` executor payload works

The `prompt` field must be a JSON string:

```json
{
  "script": "C:\Users\xbh\deepseek-harness\scripts\douban-top250\step1-prompt.mjs",
  "args": ["--db", "C:\Users\xbh\.dsh\task-queue\results\douban-top250.db", "{\"rank\":1,\"title\":\"肖申克的救赎\",\"year\":1994,\"director\":\"弗兰克·德拉邦特 Frank Darabont\"}"]
}
```

- `script`: **absolute path** to the `.mjs` file. On Windows use `C:\Users\...` (double backslashes in JSON).
- `args`: array of strings passed to `node <script> [args...]`.
- The script's `cwd` is set to the task's output directory.

## Enqueueing a batch — exact tool call

Use `task_queue_enqueue_batch` for 3+ tasks. Each spec has `title`, `prompt`, `executor`, and optional `tags`:

```
task_queue_enqueue_batch({
  specs: [
    {
      title: "stage1: 肖申克的救赎",
      prompt: '{"script":"C:\\Users\\xbh\\deepseek-harness\\scripts\\douban-top250\\step1-prompt.mjs","args":["--db","C:\\Users\\xbh\\.dsh\\task-queue\\results\\douban-top250.db","{\\"rank\\":1,\\"title\\":\\"肖申克的救赎\\",\\"year\\":1994,\\"director\\":\\"弗兰克·德拉邦特 Frank Darabont\\"}"]}',
      executor: "node",
      tags: ["douban-top250", "stage1"]
    },
    // ... more specs, up to 200 per call
  ]
})
```

**Important**: the `args` array elements are strings. The movie JSON inside `args` must be a string (not a nested object). Escape quotes properly for JSON-within-JSON.

## Concurrency configuration

In `packages/bundle/base/cordis.patch.yml`, under the `task-queue` row:

```yaml
executors:
  node:
    enabled: true
maxConcurrent: 4          # total concurrent tasks across all executors
maxConcurrentPerExecutor: 2  # concurrent tasks per executor type
intervalMs: 1000          # scheduler poll interval
```

- `maxConcurrent`: raise this to speed up batch processing (default 2).
- `maxConcurrentPerExecutor`: limit per executor type to avoid rate limits.
- To enable `arkcli` executor, add `arkcli: { enabled: true }` under `executors`.

## Model endpoint switching (for node scripts)

Scripts using `lib.mjs`'s `callLlm` resolve the API key in this order (first wins):

1. `DOUBAN_LLM_API_KEY` env var
2. `OPENCODE_GO_API_KEY` env var
3. `ARK_API_KEY` env var
4. `DEEPSEEK_API_KEY` env var
5. `~/.dsh/douban-top250.env` file (same key names)
6. `~/.dsh/.credentials.yaml` (`OPENCODE_GO_API_KEY`)

Base URL resolution:

1. `DOUBAN_LLM_BASE_URL` env var
2. `OPENCODE_BASE_URL` env var
3. `ARK_BASE_URL` env var
4. Default: `https://opencode.ai/zen/go/v1`

Model resolution: `DOUBAN_LLM_MODEL` env var, default `deepseek-v4-flash`.

To switch to ARK, set `ARK_API_KEY` and `ARK_BASE_URL` in `~/.dsh/douban-top250.env`:
```
ARK_API_KEY=ark-your-ark-api-key-here
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
```

**Note**: ARK Agent Plan keys only work through `arkcli +chat`, not via direct HTTP. If using `node` executor with `callLlm`, use OpenCode Go or a standard ARK API key.

## Monitoring and triage

- After enqueueing, report the queued ids and queue health (`task_queue_stats`).
- `task_queue_status <id>` for one task's full record (including `lastError`).
- Failed task: report proactively, suggest `task_queue_retry`. Do **not** re-enqueue the same work.
- `task_queue_cancel <id>` for pending work or a live stop request.

## Common mistakes to avoid

1. **Don't run scripts via bash when there are 3+ tasks.** Use the queue.
2. **Don't guess executor names.** Always call `task_queue_executors` first.
3. **Don't put nested objects in `args`.** Each arg must be a string.
4. **Don't forget `--db` flag.** Scripts default to `$DSH_HOME/task-queue/results/douban-top250.db`; override with `--db` if needed.
5. **Don't re-enqueue completed work.** Check `task_queue_list` first; `done` rows are skipped by scripts, but enqueuing wastes queue slots.
