# Command Profiles V2 — Architecture + Implementation Spec

> 前置：Runtime Awareness V1（`docs/specs/2026-08-23-runtime-awareness-implementation-spec.md`）已冻结。V2 引入 **Command Knowledge Plane**：Agent 不需要先知道"该查什么 X"，就能从"能力"映射到"候选 executable 名"。本 spec 小而硬。评审结论：**方向批准**，4 个 blocking（B1 provenance 存储单位 / B2 user 全新 profile / B3 candidate 语法边界 / B4 precedence≠attempt order）已吸收（见 §9）。通过后直接实现最小切片，不做多轮大设计。
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

> **数据模型核心（评审 B1）**：registry **不存"最终长什么样"，而存"谁贡献了什么"**，再计算 effective profile。`Contribution` 是存储单位，`Resolved Candidate` 是 merge 后视图。这与 V1 同构：`Settings/owners → Effective Runtime State` 在这里是 `Knowledge contributions → Effective Command Profile`。

```ts
/** 存储单位：一条来源对某个 profile 的贡献。 */
interface CommandProfileContribution {
  contributorId: string                 // 谁贡献的（builtin 包名 / plugin id / 'settings'）
  source: 'builtin' | 'plugin' | 'user'
  profileId: string                     // 目标 profile 的稳定 ID

  displayName?: string                  // 全新 user profile 需要；否则可省略
  description?: string
  aliases?: string[]
  tags?: string[]
  candidates?: CommandCandidateName[]

  candidateMode?: 'append' | 'replace'  // 仅 user 来源有效；默认 append
  disabled?: boolean                    // 仅 user 来源有效
}

/** 候选 executable 名：一个 executable lookup token，不是 invocation recipe（评审 B3）。 */
type CommandCandidateName = string      // 约束：bare executable，见 §2.5

/** merge 后视图：一条候选名 + 它的完整 provenance。 */
interface ResolvedCommandCandidate {
  command: CommandCandidateName
  provenance: Array<{
    source: 'builtin' | 'plugin' | 'user'
    contributorId: string
  }>
}

/** effective profile：registry merge 后对外呈现。 */
interface ResolvedCommandProfile {
  id: string                 // 稳定 ID，见 §3
  displayName: string
  description: string
  aliases: string[]
  tags: string[]
  candidates: ResolvedCommandCandidate[]  // 候选名，绝不表示已安装
}
```

**为什么 Contribution 是存储单位（评审 B1 核心）**：

- **provenance 不丢**：builtin + plugin-A + user 都贡献 `gh` 时，resolved 是：
  ```json
  {
    "command": "gh",
    "provenance": [
      {"source":"builtin","contributorId":"dsh-command-profiles-builtin"},
      {"source":"plugin","contributorId":"foo-plugin"},
      {"source":"user","contributorId":"settings"}
    ]
  }
  ```
- **plugin 精确 dispose**：卸载 plugin-A 只撤掉 `contributorId: foo-plugin` 那条，builtin/user provenance 保留。
- **调试可知来源**：模型和开发者都能看到"gh 这个候选名是谁声明的"。

### 2.3 显式否定（用户钉死）

`command_profile` 的返回值**绝不包含**：
```
available / installed / resolved / authenticated / version
```
一个都不要。否则 Knowledge / Reality 又混回去。

### 2.4 Candidate 语法边界（评审 B3）

**candidate 是 executable identifier，不是 invocation recipe。**

- **只允许 bare executable**：`gh`、`claude`、`codex`、`opencode`、`volc`、`my-company-cli`。
- **禁止**：
  ```
  空白参数（如 "npx foo"）
  shell expression / 管道（如 "foo | bar"）
  subcommand（如 "gh repo"）
  启动参数（如 "python -m foo"）
  路径（如 "C:\\Program Files\\foo.exe"）
  ```
- **登记时 fail loud**：非法 candidate 名（含空白/`|`/`&&`/路径分隔符/`-` 开头参数）注册即拒绝，不做静默归一。
- **deferred**：launcher recipes / argv templates（如 `python -m foo`、`npx foo`）→ **V2+**，本 spec 不做。

> 否则 Knowledge → Runtime Inspector 这条链不类型安全：`runtime_inspect(command="npx foo")` 语义直接坏掉。

### 2.5 User 覆盖面（评审 B2）

用户 schema 是 **partial contribution**，不是完整 profile 定义。分两种情况：

```yaml
commandProfiles:
  profiles:
    # 情况 1：patch 已有 profile（partial patch，无需重复 displayName/description）
    - id: github-cli
      candidates: [mygh]        # 追加（默认）
      # candidateMode: replace  # 显式 replace 才替换 built-in 候选
      # disabled: true          # 显式禁用整个 profile

    # 情况 2：全新 user profile（必须满足 resolved required fields）
    - id: my-feishu
      displayName: My Feishu CLI   # 必填（全新 profile）
      description: 我的飞书自动化 CLI  # 必填（全新 profile）
      aliases: [feishu-sync, my-feishu]
      tags: [feishu, automation]
      candidates: [feishu-sync]
```

规则：

- **已有 profile** → user 可 partial patch：只改提供的字段，其余继承 resolved 结果（displayName/description/aliases/tags 来自 built-in/plugin 或先前 user patch）。
- **全新 user profile** → merge 后**必须满足 `ResolvedCommandProfile` 的 required 字段**（displayName/description）。缺则 fail loud（settings 校验层报错，不静默降级）。
- 两种情况都保留 provenance：user 贡献的每条字段/候选都带 `source: 'user', contributorId: 'settings'`。

> 这解决"user 想定义一个全新自研 CLI，但 displayName/aliases/tags 从哪来"的问题：**patch 继承，全新必填**。

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
built-in + plugin + user candidates  → 默认 append（provenance 保留）
user candidateMode: replace          → 只暴露 user candidates（显式切断 lower layers）
user disabled: true                  → 整个 profile 不出现在查询结果
```

#### 3.2.1 Contribution precedence（去重，评审 B1）

重复 candidate **不覆盖**，而是**合并 provenance**：

```
同 command 多条 contribution → 合并为一条 ResolvedCommandCandidate，provenance 数组保留全部来源
```

例如 builtin + plugin-A + user 都贡献 `gh` → 一条 `gh`，provenance 含 3 个条目（见 §2.2）。**没有"保留最高优先级来源"这种覆盖**——provenance 永不丢失。

同一来源内同 profileId 再次注册：
- built-in：重复注册 **fail loud**（包内 bug，不允许静默）。
- plugin/user：按 append 合并（provenance 各自带 contributorId）。

#### 3.2.2 Candidate attempt order（展示/尝试顺序，评审 B4）

**Contribution precedence ≠ Candidate attempt order。** 去重只看"存在哪些"，顺序决定"模型先试谁"：

```
user candidate    → 用户明确配置，优先尝试
builtin candidate → verified canonical knowledge，次之
plugin candidate  → 扩展知识，最后
```

即默认展示/尝试顺序：**user > builtin > plugin**（组内按注册序或 id 字典序稳定）。

`candidateMode: replace` 是用户**显式切断 lower layers**：只暴露 user candidates（builtin/plugin 全部隐去），这才是"plugin 无 override 权"的真正实现——plugin 即使 append 了候选，排序也在 builtin 之后，无法把模型导向 `weird-gh`。

> **plugin contribution ≠ authority override**，且不因"排在前面"而获得事实上的优先权。

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

**确定性排序**（评审：避免测试非确定）：

```
normalization: trim + case-insensitive（匹配与返回排序都应用）
same-rank tie-break: profile.id lexical ascending
```

同一匹配域内的结果按 `profile.id` 字典序稳定输出，不依赖 Map/register 顺序。

### 4.2 返回（bounded）

```json
{
  "matches": [{
    "id": "github-cli",
    "displayName": "GitHub CLI",
    "description": "Official GitHub command-line interface",
    "candidates": [
      { "command": "gh", "provenance": [{ "source": "builtin", "contributorId": "dsh-command-profiles-builtin" }] }
    ]
  }]
}
```

只返回匹配的 profile 元数据 + 候选名（带完整 provenance）。**不返回 availability**。

### 4.3 模型规则（prompt，钉死 candidate ≠ existence）

> A command profile supplies candidate executable names only. It does not prove installation or runtime availability. Before concluding that a candidate command is available or unavailable, use authoritative runtime command inspection (`runtime_inspect kind=command`) unless current execution already established that fact.

## 5. Tool 与 Service 形状

### 5.1 Service（SD 包 `packages/context/command-profile`）

- `ctx.commandProfiles` 注册表：
  - `contribute(contribution, contributorId, source)` —— 存储一条 contribution；返回 disposer（plugin 卸载时撤回**自己的** contribution）。
  - `resolve(id): ResolvedCommandProfile` —— 单 profile 的 merge 后视图（含 provenance）。
  - `query(input): ResolvedCommandProfile[]` —— 确定性检索 + merge 后视图，按 §3.2.2 顺序输出候选。
  - `get(id)` / `list()` —— 程序化访问（供 tool 与测试）。
- 内部存 **contributions**，查询时 merge 计算 effective profile；**不 probe executable**，不依赖 `ctx.runtimeFacts`。

### 5.2 Tool（`packages/extensions/tool-command-profile`）

- 注册 `command_profile`（model-facing Consumer）。
- 参数：`{ query: string, limit?: number }`（object-root flat，`required: ['query']`）。
- 执行：调 `ctx.commandProfiles.query()`，返回 bounded matches。
- 稳定 prompt section：§4.3 规则。

### 5.3 Settings namespace（user 来源）

- `commandProfiles.profiles` 数组（partial contribution）：`{ id, displayName?, description?, aliases?, tags?, candidates?, candidateMode?, disabled? }`。
  - **全新 profile**：`displayName`/`description` 必填（settings 校验层 fail loud）。
  - **patch 已有 profile**：只提供要改的字段。
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

**依据**：built-in admission 依据 **canonical product identity / authoritative documentation**（如 GitHub 官方 `gh` 为 CLI 标准名）；**本机 resolvability 不作为知识正确性的依据**。这维持"Knowledge correctness ≠ Runtime presence"——某命令本机没装，不代表 built-in 知识错了；某命令本机装了，也不代表它是 canonical 名。

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

**merge/provenance（评审 B1，必测）：**
1. 两个 plugin 对同 candidate 贡献（如 `gh`），卸载其中一个 → **只撤掉自己的 provenance**，另一个 plugin + builtin 保留。
2. builtin + plugin + user 同时贡献 `gh` → dedupe 后**一条 candidate，provenance 三者都存在**（不覆盖）。
3. user 新建完整 profile → 可通过 alias / displayName 检索到；缺 displayName/description 的**全新** user profile fail loud。
4. plugin appended candidate **不排在 canonical builtin candidate 前**（attempt order: user > builtin > plugin）。
5. `npx foo` / `python -m foo` / `gh --hostname x` / 含空白的 candidate 登记 **fail loud**（语法边界 B3）。

**其余：**
- lifecycle：built-in 卸载撤回；user settings 变更 live 生效；contributorId 精确 dispose。
- 查询：id/alias/displayName/tag/description 各匹配域；trim + case-insensitive；same-rank `id` 字典序；limit 截断。
- **不 probe**：query 返回不含 availability，且不触发任何 subprocess 调用。
- tool：参数校验、object-root schema、bounded 结果、candidate 语法校验。

## 8. Package / File Changes（最小切片）

| 包 | 角色 | ctx key / 产物 |
|---|---|---|
| `packages/context/command-profile`（新） | Command Profile registry（SD） | `ctx.commandProfiles` |
| `packages/extensions/tool-command-profile`（新） | model-facing `command_profile` tool（Consumer） | 注册 `ctx.tools` + prompt section |
| `packages/context/command-profile` 内 | user settings namespace（`commandProfiles`） | `installSettingsSection` |

文档：本 spec + 对应 Agent Note（merge/provenance 决策记录）。

## 9. 评审结论与已吸收修正

**方向批准；4 个 blocking 已吸收，可进入实现。**

| Blocking | 修法（本节落点） |
|---|---|
| **B1** Provenance 不丢 + plugin 精确 dispose | §2.2：Contribution 是存储单位、ResolvedCandidate 带 provenance 数组、contributorId 精确撤回；§3.2.1 去重合并 provenance 而非覆盖 |
| **B2** user 定义不了全新自研 CLI | §2.5：patch 已有（partial）vs 全新必填（displayName/description）；§5.3 settings 校验 |
| **B3** candidate 语法边界 | §2.4：bare executable only、登记 fail loud、launcher recipes deferred V2+ |
| **B4** contribution precedence ≠ candidate attempt order | §3.2.2：展示顺序 user > builtin > plugin；replace 显式切断 lower layers |

**3 个通过项：**
1. **candidate ≠ existence**：批准。架构（registry 不 probe）+ DTO（返回禁 availability）+ prompt（candidate → runtime_inspect）三层同时约束。
2. **lexical query**：批准，已补确定性（trim + case-insensitive + same-rank `id` 字典序）。
3. **built-in 4 个**：批准。已修正证据文字（canonical identity / authoritative doc，本机 resolvability 不作为依据）。
