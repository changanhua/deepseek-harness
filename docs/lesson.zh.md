# Lesson

[English](lesson.md) | 中文

一些容易踩错、且确实在这里造成过代价高昂误判的环境事实。在诊断任何"命令跑不起来"或"这个进程不该动"的报告之前先读本文；通用模式是：**归因于 artifact、策略、或假设某进程不是自身运行时之前，先验证环境事实。**

## npm CLI 名很少是 shim 解析问题

Windows + npm + PowerShell 环境中，同一个 PATH 条目下会有多个同名 artifact——`arkcli`、`arkcli.cmd`、`arkcli.ps1`。`Get-Command arkcli` 报的 `arkcli.ps1`（ExternalScript）在前，看起来像是"PowerShell 选了受 ExecutionPolicy 约束的 .ps1"的铁证。但这个前提在**当前部署上是假的**：`.ps1` shim 会派发给 `node`，裸 `arkcli --version`、`claude --version`、`pnpm --version` 都能正常运行（exit 0）。

"Command Resolution 重写"（把 `claude` 解析到 `.cmd` artifact）这条思路被否了，因为它去解决一个不存在的问题，同时重引入一层脆弱的命令重写 seam（执行器得去解析 PowerShell 语法——引号、管道、`;`、变量——才能找出开头 token）。一次真实的 npm CLI 失败在这里被误归因了两次：一次当成登录过期上报（`refresh_token is invalid`），一次当成从未被检验过的 shim"真相"。

**规则**：当裸 npm CLI 名"跑不起来"时，先收集结构化环境事实——裸名与 `.cmd`/`.ps1` 变体的实际退出输出、以及登录/凭证状态——再假设是解析或策略问题。不要为了"修好它"去改用户 `$PROFILE`，也不要放宽 ExecutionPolicy：前者污染宿主、在别处全部失效（CI、Docker、其它 Windows 用户、远端 Linux），后者解决的是另一个命题（`.ps1` 是否允许执行）而非被问的那个（该选哪个 artifact）。

## 扩展服务或接口类型会让结构类型消费者集体失配

给 Service Definition 或接口类型加一个必填成员（这里新增了一个 `ApiProxy['skillManagement']` 成员），会让所有结构类型消费者同时失配，`implements` 该类型的 test double 就是其中之一：它只在 `tsc` 恰好编译到那个文件时才报错。`tsc -b` 是增量构建，host 阶段在自己三个错误后停绿，会遮住 client 阶段多得多的错误；而一个因修复而失效的 `@ts-expect-error`，在 allowlist 或契约扩展后自己也会变成新错误。这次具体漏点：独立包里两个 client 侧 `FakeApiClient` 替身，以及一个 `LocaleKeysOf<'taskQueue'>` 消费方——它的 common key 集合比替身的字典更宽，所以对替身看似完整，对 `ok` 这样的键却仍然非法。

**规则**：当一次改动扩长或重塑某个结构类型时，在同一次改动里枚举它的全部消费者——`implements X`、`: X`、`Partial<X[...]>`，以及受影响文件里的 `@ts-expect-error` 指令——因为 test double 是隐式消费者，编译器只会在编译到它们时才报。然后必须把整条增量链推到底（整个 `tsc -b` 聚合，而非某一个叶子）才视为验证完成，并反向检查受影响文件里那些已变成 unused 的 `@ts-expect-error`——一个比它压制的错误活得更久的指令就是新的失败。在 `exactOptionalPropertyTypes` 下用可能为 `undefined` 的变量填充可选成员时，用条件展开或把类型写成 `?: T | undefined`；当测试伪造 `TranslateNS`/`LocaleKeysOf` 读取方时，要覆盖合并后的 common key 集合，而不只是字典键。

## 你准备影响的进程可能就是自身运行时

当报告点名某个"不该碰"的进程 id 或端口时，先对照当前 host 验证再行动：DSH host 进程及其 web UI 端口就是这样一组受保护对象。误杀了正在修改本 workspace 的进程，正是本 Lesson 要防的失败。

两件事背后缺的是一层结构化的 runtime-awareness——Agent 如何知道自己所在的运行时、以及命令解析到哪个 artifact。这单独在 [future-work-candidate.md](future-work-candidate.md) 提案。
