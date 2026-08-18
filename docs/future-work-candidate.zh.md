# Future work candidate

[English](future-work-candidate.md) | 中文

尚未实现的能力与策略提案，放在这里便于在真正开工时好找、好引用。各候选彼此独立，各有范围、验收标准与风险。这些候选要预防的踩坑教训在 [lesson.md](lesson.md)。

## 1. runtime command & host-process inspection

一个只读、平台中立的 inspection 面，把环境与命令解析事实以结构化数据暴露出来——不重写命令、不改变 shell 工具 contract。Agent 继续写 `claude --version`；解析和诊断改为读事实，而不是猜。

- **环境盘点** —— OS、shell、Node/npm（或当前包管理器）、以及与命令解析相关的 `PATH` 条目。
- **命令解析** —— 按平台的 `resolve(name)`：名称映射到哪个 artifact kind（`exe` / `cmd` / `ps1` / `bat` / PATH 未命中）、选中路径、候选、以及选择原因。仅作建议：它报告 shell 将要使用的事实，不重写命令字符串。
- **Doctor** —— 一次性诊断：渲染已知工具（git、包管理器、模型 CLI）的环境与命令事实，让一条失败命令能对着已知良好基线核对。
- **Host 进程感知** —— DSH host pid 和受保护端口（例如 web UI 端口），让 Agent 在任何动作之前先认出自身运行时是受保护进程。

inspection 是建议性、只读的：它不得改变命令如何执行、不得修改用户 `$PROFILE`、不得放宽 ExecutionPolicy、不得改动 shell 工具的 `command` 字符串 contract。解析逻辑放在 platform adapter 之后——Linux/macOS 走现有 `PATH` 解析，不产生 Windows 专属字段。

探索中已识别的实现 seam：

- `packages/shell/shell-env` —— 已在每次执行时注入 `DSH_*` 事实；一个 `runtime-facts` contributor 可以把命令解析和 host 进程事实并入现有 `collect()` 路径。
- `packages/shell/pwsh-local/src/resolve.ts` —— 已有无依赖的按平台 resolver；一个并行的 `resolve-command` 模块可以枚举 `PATH` artifact 并分类，和 `resolvePwshPath` 一样与测试共享定义。
- `packages/shell/tool-pwsh` 与 `tool-bash` —— 保持 `command` 参数原样。

### 沿途被否决的东西

- **在 executor 里把命令重写到 `.cmd` artifact** —— 否决：本部署上"`.ps1` shim 会失败"的前提不成立，且字符串重写会迫使 executor 解析 PowerShell 语法。见 [lesson](lesson.md)。
- **只靠 prompt 指令（"记得用 `xxx.cmd`"）** —— 否决：把负担甩给模型记忆，跨会话会腐化；结构性事实是持久的，提示不是。
- **本次就实现带执行策略与安全的完整 runtime model** —— 暂缓：本候选只加只读意识；策略属于独立设计。

### 验收标准（实现时）

- 一个只读的 `runtime` inspection 面，在 Windows 上对给定命令名返回分类后的 artifact kind 和选中路径，且不修改环境、不执行该命令。
- shell 工具的 `command` 参数和输出 schema 不变；Agent 仍写 `claude --version`。
- Linux/macOS 走 `PATH` 解析，无 Windows 专属字段。
- 不引入任何用户 `$PROFILE` 修改或 ExecutionPolicy 变更。

### 风险

- **策略确实不同时，诊断幻象仍在。** 在更严的 ExecutionPolicy 宿主上 `.ps1` shim 可能真的失败；inspection 会报告这个事实，但如何行动由操作者决定。
- **向完整 runtime model 蔓延。** 本候选刻意止步于只读 inspection；过早把策略/安全并进来会重新打开那个已被否决的重写讨论。

## 2. 每日批量中文同步

在本 fork 中，**英文是唯一事实源**；中文对应文件只给单一读者（所有者）存在，不承担评审或发布的义务。upstream 的 `translation-pairing` 契约（见 [docs/i18n/README.md](i18n/README.md)）让两种语言地位相等，并强制每次编辑都同步重新确认配对——在这里是纯成本：每次英文改动立刻要求同步中文并重录哈希，即使所有者并不常读中文页。

本候选把两者解耦：英文保持为事实源，中文改为**每日定时批量**更新，而不是随每次编辑即时同步。

- **选择性同步，merge 时站 fork 这边** —— fork 在配对冲突时以 fork 侧为准；upstream 的改动按所有者的节奏并入。
- **定时脚本，非即时** —— 每日任务处理"待同步的英文 diff → 中文"的更新，而不是阻塞每次编辑。
- **所有配对文档** —— 放宽全局生效，含生成的 catalog（`config-catalog`、`module-graph`、`persistence-catalog`、`tool-catalog`），它们是最高的变动对，也是今天成本最大的部分。

### 提案

- 把 `verify-translation-pairing` 从硬性的 `doc-sync` 门禁放宽为可容忍待同步中文的状态，让仅改英文的编辑不红。
- 新增一个每日（或按需）的批量任务：把待同步的英文 diff 翻成中文，并重录 `.i18n.yaml` 哈希。
- 记录本 fork 与 upstream [docs/i18n/README.md](i18n/README.md) 契约的差异：单一读者假设覆盖了"地位相等"。

### 暂缓的内容

- **本次不写脚本** —— 同步机制只记录为候选，尚未自动化任何事情。
- **翻译质量审校** —— 机器生成且无人审校的中文在此是可接受的，因为读者是所有者；术语漂移被容忍。

### 验收标准（实现时）

- 仅改英文的编辑在中文仍待同步时，不令 `doc-sync` 失败。
- 每日（或按需）批量更新待同步的中文对应文件并重录哈希。
- fork 记录"英文是事实源、中文仅所有者"，刻意偏离 upstream 的地位相等。

### 风险

- **偏离 upstream。** fork 偏离共享的 bilingual 契约；合并 upstream 的配对改动可能冲突（由选择性同步策略承担）。
- **丢失评审信号。** 若中文日后真用于发布或外部读者，机器翻译且未经审校的文本将原样流出。
