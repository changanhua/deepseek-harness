# Command Profiles V2 — Architecture + Implementation Spec

> 前置：Runtime Awareness V1（`docs/specs/2026-08-23-runtime-awareness-implementation-spec.md`）已冻结。V2 引入 **Command Knowledge Plane**：Agent 不需要先知道"该查什么 X"，就能从"能力"映射到"候选 executable 名"。本 spec 小而硬，重点评审三件事：**merge/provenance**、**candidate ≠ existence**、**profile identity**。通过后直接实现最小切片，不做多轮大设计。
>
> 一句话：**RuntimeFacts = current reality；CommandProfiles = stable knowledge；两者平行，互不依赖。**

## 0. 核心洞察（为什么需要 V2）

`runtime_inspect(command=X)` 能回答"X 在不在"，但前提是 Agent **先知道该查什么 X**。高频 CLI（`gh`/`codex`/`claude`）模型通常知道；但飞书、火山、云厂商 CLI、公司内部 CLI、自研脚本，模型很可能连真正 executable 名字都不知道。

V2 补一层：**"这个能力可能对应哪些命令？"** —— 这是稳定知识，不是运行现实。

## 1. 三层分离（Knowledge ≠ Reality ≠ Diagnostic）

```
             Agent Environment Knowledge

┌──────────────────────────────────────┐
│ Command Profile / Knowledge          │  ← 本 spec（V2）
│ "可能有什么、叫什么、怎么辨认"       │
└──────────────────┬───────────────────┘
                   │ candidate
                   ▼
┌──────────────────────────────────────┐
│ Runtime Inspector                    │  ← V1 已有（runtime_inspect）
│ "现在实际上怎么样？"                 │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│ Execution / Diagnostic               │  ← V2+ 后续，非本 spec 范围
│ "它真正运行以后怎么样？"             │
└──────────────────────────────────────┘
```

- **Knowledge**（本 spec）：`ctx.commandProfiles`——稳定语义，候选名。
- **Reality**：`runtime_inspect`——当前 execution world 的解析结果。
- **Diagnostic**：版本/认证/配置——decision-time 按需 probe，**不自动执行**。

**边界铁律**：`ctx.commandProfiles` **不依赖** `ctx.runtimeFacts`；profile registry **自己绝不 probe executable**。两层只通过"candidate 名 → runtime_inspect"串联。

## 2. Profile Identity 与 Schema

### 2.1 命名（用户修正 1）

- Service：`ctx.commandProfiles`
- Settings namespace：`commandProfiles`
- Model-facing tool：`command_profile`

避免 `commands` 与 shell command / tool command 混淆。明确它是**知识配置**，不是 PATH、不是 Runtime State。

### 2.2 Schema（V2 最小版）

```ts
/** 一个候选 executable 名，带来源标注（provenance）。 */
interface CommandCandidate {
  command: string
  source: 'builtin' | 'plugin' | 'user'
}

/** 稳定知识：一个 CLI 能力是什么、通常怎么探测。 */
interface CommandProfile {
  id: string                 // 稳定 ID，见 §3
  displayName: string
  description: string
  aliases: string[]          // 检索别名（不含 executable）
  tags: string[]
  candidates: CommandCandidate[]  // 候选名，绝不表示已安装
}
```

### 2.3 显式否定（用户钉死）

`command_profile` 的返回值**绝不包含**：
```
available / installed / resolved / authenticated / version
```
一个都不要。否则 Knowledge / Reality 又混回去。

### 2.4 User 覆盖面（用户修正 2）

用户可对已有 profile 增删候选，但必须显式声明，且**保留 provenance**：

```yaml
commandProfiles:
  profiles:
    - id: github-cli
      candidates: [mygh]        # 追加（默认）
      # candidateMode: replace  # 只有显式 replace 才替换 built-in 候选
      disabled: false
```

- 默认 `candidateMode: 'append'`：`gh`（builtin）与 `mygh`（user）**并存**，`gh` 不被静默吃掉。
- 显式 `candidateMode: 'replace'`：用 user 列表替换 built-in 候选（用户确实把 gh 重命名成 mygh 时）。
- 合并后 candidates 保留 source：

```json
{
  "id": "github-cli",
  "candidates": [
    { "command": "gh", "source": "builtin" },
    { "command": "mygh", "source": "user" }
  ]
}
```

> **知识 registry 最怕 silent override**——因此任何贡献都带 source，模型能看到"这个候选名是谁声明的"。

## 3. Contribution 与 Merge/Provenance（重点评审 1）

### 3.1 三来源与权限（用户修正 3）

| 来源 | 权限 |
|---|---|
| **built-in** | 注册新 profile；**已验证**的 knowledge（见 §6） |
| **plugin** | 默认只能：新增 profile；给已有 profile **追加** candidates/aliases/tags。**无 override 权** |
| **user** | 最终拥有 override / disable 权（`candidateMode: replace` / `disabled: true`） |

> **plugin contribution ≠ authority override。** 一个第三方 plugin 注册 `id = github-cli, command = evil-gh-wrapper` 不能抢走公共知识语义——它只能追加，且模型能看到 source。

### 3.2 Merge 规则（V2 最小版）

```
built-in + plugin + user candidates  → 默认 append
user candidateMode: replace          → user 列表替换前两层
user disabled: true                  → 整个 profile 不出现在查询结果
```

- 重复 candidate 名去重（保留最高优先级来源：user > plugin > builtin）。
- 同一来源内同 ID 再次注册：built-in 重复注册 fail loud；plugin/user 重复按 append 合并。

### 3.3 Lifecycle

- built-in：注册于包 apply，随插件生命周期卸载。
- plugin：`ctx.effect` 注册，卸载即撤回。
- user：settings namespace `commandProfiles` 读入，live 更新（settings 变更后下次查询生效）。

## 4. 查询语义（重点评审 2：candidate ≠ existence）

### 4.1 V1 查询：确定性 lexical，不做 semantic/vector（用户修正 4）

```ts
interface CommandProfileQuery {
  query: string
  limit?: number   // 默认 5，上限 10
}
```

匹配域（按序）：`id` 精确/前缀 → `aliases` 精确 → `displayName` 包含 → `tags` 精确 → `description` token 匹配。**不引入 embedding/vector/search subsystem**——几十个 profile 用不上第二套搜索基础设施；真实使用证明 lexical 不够再考虑。

### 4.2 返回（bounded）

```json
{
  "matches": [{
    "id": "github-cli",
    "displayName": "GitHub CLI",
    "description": "Official GitHub command-line interface",
    "candidates": [
      { "command": "gh", "source": "builtin" }
    ]
  }]
}
```

只返回匹配的 profile 元数据 + 候选名（带 source）。**不返回 availability**。

### 4.3 模型规则（prompt，钉死 candidate ≠ existence）

> A command profile supplies candidate executable names only. It does not prove installation or runtime availability. Before concluding that a candidate command is available or unavailable, use authoritative runtime command inspection (`runtime_inspect kind=command`) unless current execution already established that fact.

## 5. Tool 与 Service 形状

### 5.1 Service（SD 包 `packages/context/command-profile`）

- `ctx.commandProfiles` 注册表：
  - `register(profile, source)` —— built-in/plugin 用；返回 disposer。
  - `query(input): CommandProfileMatch[]` —— 确定性检索 + merge 后视图。
  - `get(id)` / `list()` —— 程序化访问（供 tool 与测试）。
- **不 probe executable**，不依赖 `ctx.runtimeFacts`。

### 5.2 Tool（`packages/extensions/tool-command-profile`）

- 注册 `command_profile`（model-facing Consumer）。
- 参数：`{ query: string, limit?: number }`（object-root flat，`required: ['query']`）。
- 执行：调 `ctx.commandProfiles.query()`，返回 bounded matches。
- 稳定 prompt section：§4.3 规则。

### 5.3 Settings namespace（user 来源）

- `commandProfiles.profiles` 数组：`{ id, description?, candidates?, candidateMode?, disabled? }`。
- 由 `command-profile` 包（或独立 host provider）经 `installSettingsSection` 注册，live resolve。
- 参考 V1 `web` settings namespace 模式（`settingsNamespace('commandProfiles')`）。

## 6. Built-in Profiles（重点评审 3：不能写错知识）

### 6.1 V2 最小切片：4 个 verified built-ins（用户确认）

| id | displayName | candidates |
|---|---|---|
| `github-cli` | GitHub CLI | `gh` |
| `claude-code` | Claude Code | `claude` |
| `codex-cli` | Codex CLI | `codex` |
| `opencode-cli` | OpenCode | `opencode` |

**依据**：这 4 个的 executable 名是稳定、无歧义、可验证的（本仓库开发环境已实测 `codex`/`claude`/`opencode` 解析；`gh` 为 GitHub 官方标准名）。

### 6.2 明确不放进 built-in（V2）

- **火山/飞书**：暂**不**做 built-in——两者正是"模型不知道名字 + 名字变化 + 多产品都有 CLI + 用户可能自己包装"的典型。火山官方当前资料显示：
  - 通用/机器学习平台 CLI：`volc configure` / `volc v`（非单一 `ve`）
  - 另有 `veCLI`（AI 命令行 Agent）与 `@volcengine/ark-cli`（方舟页推广）——"火山 CLI"已非单一概念
  - 飞书官方资料未提供足够证据支持 `lark-cli` 作为 canonical 名
- **处置**：火山/飞书**拿来当 user/plugin profile 的测试对象**（例如 user 定义 `my-volcengine: [volc]`），证明 user-defined knowledge 的价值；等官方 identity 调查清楚后再晋升 built-in。

> **Built-in Knowledge 的错误会长期、稳定地误导每一次**（比 Runtime Fact 的单次错误严重得多）。因此 built-in 只放可验证的。

## 7. Behavior Eval + Non-goals

### 7.1 behavior e2e（新增 2 场景，`examples/headless-agent/tests/command-profile.behavior.e2e.ts`）

1. **能力 → candidate → inspect 确认**：问"用 GitHub CLI 看这个 PR"，模型应 `command_profile(query)` 得到 `gh`，再 `runtime_inspect(command=gh)` 确认，不直接猜路径、不把 candidate 当 installed。
2. **user-defined profile 可检索**：装配一个 user profile（如 `my-feishu: [feishu-sync]`），问"用我的飞书 CLI"，模型应能检索到该 profile 并拿到 `feishu-sync` candidate，再 inspect。

断言读 tool-call 事件 + 最终文本（durable，model-visible），不依赖模型自述。

### 7.2 Non-goals（明确拒绝）

```
no PATH scan
no installed-software inventory
no auto probe（profile 不探测 executable）
no semantic/vector search V1
no auth probe
no version probe
no capability execution
no CLI recommendation ranking
```

### 7.3 测试（单元层）

- merge/provenance：append vs replace vs disabled；来源优先级；去重。
- lifecycle：built-in 卸载撤回；user settings 变更 live 生效。
- 查询：id/alias/displayName/tag/description 各匹配域；limit 截断。
- **不 probe**：query 返回不含 availability，且不触发任何 subprocess 调用。
- tool：参数校验、object-root schema、bounded 结果。

## 8. Package / File Changes（最小切片）

| 包 | 角色 | ctx key / 产物 |
|---|---|---|
| `packages/context/command-profile`（新） | Command Profile registry（SD） | `ctx.commandProfiles` |
| `packages/extensions/tool-command-profile`（新） | model-facing `command_profile` tool（Consumer） | 注册 `ctx.tools` + prompt section |
| `packages/context/command-profile` 内 | user settings namespace（`commandProfiles`） | `installSettingsSection` |

文档：本 spec + 对应 Agent Note（merge/provenance 决策记录）。

## 9. 评审重点（3 件事）

1. **merge/provenance**：append 默认、replace 显式、user > plugin > builtin、source 永不丢失——是否合理？plugin 无 override 权是否够？
2. **candidate ≠ existence**：`command_profile` 返回绝不含 availability、绝不 probe——边界是否钉死？模型规则是否够防"看到候选就当已安装"？
3. **profile identity**：稳定 ID 的粒度（`github-cli` vs `volcengine-cloud-cli`/`vecli`/`ark-cli` 分离）是否对？built-in 只放 4 个 verified、火山/飞书走 user/plugin——是否同意？
