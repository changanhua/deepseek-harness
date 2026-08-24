# Agent Note: 命令知识平面：贡献存储与 provenance 合并

Status: implemented

[English](2026-08-25-command-profiles-knowledge-plane.md) | 中文

## Problem

`runtime_inspect(command=X)` 能回答"X 是否可解析"，但前提是模型已经知道该问哪个 X。`gh`、`codex`、`claude` 这类高频 CLI 模型通常认识；飞书、火山、云厂商、内部与自研 CLI 往往不认识，而它们的确切可执行程序名正是模型缺失的知识。此前没有稳定的 Knowledge 平面：一个不探测宿主的、把能力映射到候选可执行程序名的模型侧注册表。

## Decision

`@deepseek-ai/dsh-command-profile` 注册 `ctx.commandProfiles`，`@deepseek-ai/dsh-tool-command-profile` 注册模型侧 `command_profile` 工具。知识与现实保持平行：注册表从不探测可执行程序、从不依赖 `ctx.runtimeFacts`；唯一的连接是一条候选名从 `command_profile` 流进 `runtime_inspect kind=command`。

### 存贡献而非合并视图

注册表存 `CommandProfileContribution` 记录——谁、向哪个 profile 贡献了什么——并在读取时计算有效 profile。`contribute(contribution)` 接收一条自包含记录，携带 `contributorId`、`source`（`builtin`/`plugin`/`user`）与 `profileId`；provenance 身份没有第二个入口。返回的 disposer 精确撤回该记录，因此卸载某个 plugin 只移除它自己的候选与 provenance。

### 合并规则与 provenance

重复候选合并时完整保留 provenance 而非覆盖：内置、plugin、用户都命名 `gh` 时得到一条候选，其 provenance 列出三者。尝试顺序为用户 > 内置 > plugin，与注册顺序无关，因此 plugin 无法靠晚注册把模型导向自己的别名。身份字段（`displayName`/`description`）解析为用户显式值 > definition owner；owner 为存在时的内置、否则首个创建 plugin、否则用户；第二个 plugin 重新定义身份字段即 fail loud。别名与标签做不区分大小写的去重并集，按用户 → owner → 其余 plugin 的顺序保留首个 canonical 拼写。

### 候选 ≠ 存在

`command_profile` 只返回带 provenance 的候选可执行程序名。返回 DTO 不暴露任何 `available`/`installed`/`resolved`/`authenticated`/`version` 字段，且本包 prompt 段指示模型在未由当前执行确立该事实时，用 `runtime_inspect kind=command` 确认候选。注册表自身从不探测，因此 Knowledge 平面永不断言存在性。

### 候选语法

候选是裸可执行令牌，不是调用配方。注册时拒绝空白、路径分隔符、shell 运算符与前导短横线，因此 `npx foo`、`python -m foo`、管道、子命令与文件路径在注册时即 fail loud，保持"知识 → 检查"链路类型安全。启动配方留待后续。

### 内置知识保持可验证

四个内置 profile 作为 V2 最小集交付（`github-cli` → `gh`、`claude-code` → `claude`、`codex-cli` → `codex`、`opencode-cli` → `opencode`）。准入依据权威文档中的 canonical 产品身份，而非本机可解析性，因为内置知识错误会在很长一段时间里误导每一次查询。飞书与火山在 canonical CLI 身份确立前不进内置；user/plugin profile 是它们被验证的路径。

### 用户设置命名空间

`command-profiles` 设置命名空间（settings 平台要求小写 kebab）承载部分用户贡献。profile id 在段内必须唯一。全新 user profile 必须提供 `displayName` 与 `description`；patch 已有 profile 时身份字段从它的 owner 继承。`candidateMode: 'replace'` 与 `disabled` 仅用户可用，变更对下一次查询即时生效。

## Alternatives considered

**在注册时把 profile 解析成最终形态。** 被否：会丢失 provenance，无法在不重算的情况下撤回单一贡献者，并让加载顺序决定权威。

**允许 plugin 覆盖身份字段。** 被否：第三方 plugin 不能拥有它未创建的 profile 的公共知识语义；definition-owner 规则在无加载顺序敏感性的前提下保证单一权威。

**让 profile 注册表报告可用性。** 被否：等于把现实塞回知识层；DTO 与 prompt 让"候选 ≠ 存在"显式化，存在性只通过 `runtime_inspect` 确立。

**用驼峰 `commandProfiles` 暴露设置命名空间。** 被否：settings 平台强制小写 kebab namespace；service key `ctx.commandProfiles` 不受影响。

## Consequences

模型获得从能力到候选可执行程序名的确定性词法查询，用户还能通过设置教会模型自己的或内部 CLI，无需写代码。provenance 对模型与调试可见，plugin 知识可按贡献者撤回。该平面刻意不成为已装软件清单、推荐排序器或语义搜索子系统；存在性仍是 `runtime_inspect` 的职责；在飞书/火山 CLI 的产品身份确立前，四个内置就是已验证知识的上限。
