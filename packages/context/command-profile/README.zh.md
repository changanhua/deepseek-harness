# @deepseek-ai/dsh-command-profile

[English](README.md) | 中文

命令知识平面注册表：关于"某个能力可能对应哪些可执行程序"的稳定知识。贡献者通过 `contribute` 注册知识记录；消费方通过 `query`/`resolve` 查询有效 profile。注册表存的是贡献而非合并后的视图，因此 provenance 在每次合并后都不丢失，且释放某位贡献者只撤回它自己的记录。它从不探测可执行程序、从不依赖 runtime facts——知识与现实保持平行。决策记录：[command-profiles Agent Note](../../../.agents/notes/implemented/architecture/2026-08-25-command-profiles-knowledge-plane.zh.md)。

## Config

```yaml
- id: command-profile
  name: '@deepseek-ai/dsh-command-profile'
  config:
    includeBuiltins: true
```

`includeBuiltins` 默认为 `true`，播种四个已验证的内置 profile：`github-cli` → `gh`、`claude-code` → `claude`、`codex-cli` → `codex`、`opencode-cli` → `opencode`。准入依据权威产品身份，而非本机可解析性。设为 `false` 得到空注册表，只由 plugin 与用户贡献填充。

## 贡献模型

`ctx.commandProfiles.contribute(contribution)` 存储一条知识记录并返回它的精确 disposer。每条记录自带 provenance（`contributorId`、`source`、`profileId`），因此不存在与它竞争的第二个入口。释放一条贡献只移除它自己的记录；其他贡献者的记录与 provenance 保留。

`candidateMode` 与 `disabled` 仅对 `source: 'user'` 有效。每个 candidate 都是裸可执行令牌：注册时拒绝空白、路径分隔符、shell 运算符与前导短横线，保证"知识 → `runtime_inspect`"链路类型安全。

## 合并规则

有效 profile 在读取时由全部活跃贡献计算得出。

- **身份字段**（`displayName`、`description`）：用户的显式值优先于 profile 的 definition owner。definition owner 为：存在内置贡献时是内置；否则是首个创建该 profile 的 plugin；否则是用户。第二个 plugin 不能重新定义它不拥有的 profile 的身份字段——注册即 fail loud。
- **别名与标签**：活跃贡献的并集，用不区分大小写的比较去重、保留首个 canonical 拼写。展示顺序为用户 → definition owner → 其余 plugin（按 contributor id）。
- **候选**：去重并完整保留 provenance，因此内置、plugin、用户都命名同一条候选时，合并为一条且 provenance 列出三者。尝试顺序为用户 → 内置 → plugin，与注册顺序无关。用户的 `candidateMode: 'replace'` 显式切断全部下层；`disabled: true` 使整个 profile 从查询结果中隐藏。

## 用户设置

`command-profiles` 设置命名空间以部分 profile 数组承载用户贡献：

```yaml
command-profiles:
  profiles:
    - id: github-cli
      candidates: [mygh]          # patch: append (default)
      # candidateMode: replace    # explicit replace cuts built-in candidates
      # disabled: true            # hide the whole profile
    - id: my-feishu               # new profile: displayName/description required
      displayName: My Feishu CLI
      description: My Feishu automation CLI
      aliases: [feishu-sync]
      candidates: [feishu-sync]
```

profile id 在段内必须唯一（注册即 fail loud）。全新 user profile 必须提供 `displayName` 与 `description`；patch 已有 profile 时身份字段从它的 owner 继承。变更对下一次查询即时生效。

## 查询

`query({ query, limit? })` 做确定性词法匹配：id 精确/前缀、alias 精确、displayName 包含、tag 精确、description token。匹配时 trim 并忽略大小写；同档结果按 profile id 排序。`limit` 默认 5，钳制在 1..10。

## Model Experience

间接通过 `@deepseek-ai/dsh-tool-command-profile` 注册的 `command_profile` 工具呈现；注册表自身不渲染任何 prompt、schema 或结果。

#### KV Cache effect

当注册表贡献与消费工具的定义不变时前缀稳定；profile 内容只出现在工具结果里，绝不进入请求前缀。

## 已知限制与待办

- **候选是标识符而非配方** — 诸如 `npx foo`、`python -m foo` 的启动形式被拒绝，留待后续 V2 切片。
- **无已装软件清单** — 注册表从不探测宿主；存在性只能通过 `runtime_inspect` 确立。
- **无语义搜索** — 查询是词法且有界；第二套搜索子系统留到真实使用证明需要时再引入。
