---
description: "本地有来源项目记忆，提供持久版本、人工命令授权和有界召回。"
kind: "package-reference"
---

# @changanhua/dsh-memory-local

[English](README.md) | 中文

## 概述

此 provider 跨会话和存储重开保留项目记忆，保存候选、接纳、修订与撤回历史。它在暴露已接纳命题前检查当前文件字节或实际落盘的 Session 事件。冲突命题、不可读来源与逾期来源不会进入普通召回。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

在 Storage Domain、Workspace Registry、Session Store 与持久化、Session Query 和文件系统之后挂载此 provider。调用者的活动 Session 必须属于已注册的规范化 Workspace；未注册目录不会回退为全局记忆。文件读取使用 Agent 的文件系统执行世界，不绕过它直接读取宿主文件。

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `ownershipRoot` | 必填 | 指向同一记忆存储的组合共享的本地绝对锁目录 |
| `reviewAfterDays` | 30 | 已接纳版本需要人工复核前的默认天数 |
| `maxRecordsPerWorkspace` | 500 | 每项目记录上限 |
| `maxRevisions` | 50 | 每条记录的不可变内容版本上限 |
| `maxReceipts` | 200 | 每条记录的已提交变更上限 |
| `maxSourceBytes` | 1048576 | 单个来源的字节上限 |
| `maxOutputBytes` | 16384 | 完整模型可见服务结果的字节上限 |
| `maxSearchResults` | 5 | 每次查询已检查且可用的结果上限 |

命题最多包含 2,000 个 Unicode 字符和五个来源。记录、版本、回执、来源字节与输出字节上限可以调低，不能超过 schema 的硬上限。达到容量时拒绝写入，不淘汰既有数据。人工查看返回独立的领域记录副本；Command consumer 还必须约束最终呈现结果。

一个所有者锁保护沿用既有 Storage Domain 后端路由的 `project_memory`。锁已存在时拒绝启动。崩溃后先确认之前的 Host 已退出，再删除精确的 `owner.lock`；恢复时不能删除记忆 domain。卸载先等待已准入操作完成并关闭持久化，再释放匹配的所有者 token。

<a id="understand-the-implementation"></a>
## 理解实现

[存储变更](src/store.ts) 通过原子 domain 更新提交一条记录及其回执。[范围检查](src/scope.ts) 推导 Workspace 身份，并要求决策和历史查看具有精确、仍在执行的人工 `command/run`。[来源读取](src/sources.ts) 将完整文件字节或物理 Session 文本绑定到 SHA-256；来源改变或不可读时不会改写已捕获的指纹。[排序](src/search.ts) 使用归一化的拉丁词和中文双字片段，并处理显式主题冲突。

接纳后的复核期限保存在不可变决策记录中，因此重新确认未变化的命题不会改写内容版本。撤回记忆保留历史。不可用读取返回原因和来源定位，不返回旧命题正文或来源预览。

来源 IO 完成后，读取会重新检查活动 Session、记录版本、复核期限和主题冲突。搜索还会在返回早先命中项之前核对整个项目记录快照。快照改变时允许重试一次；持续变化则返回 `concurrent-change`。来源检查期间取消不会准入变更。已提交到原子存储的写入会等待明确结果；已落盘回执在取消或确认响应丢失后仍然保留。

<a id="model-experience"></a>
## Model Experience

无，因为此 provider 不注册工具、提示词或模型请求，这些效果由 Consumer 拥有。

#### KV Cache effect

无，因为记忆操作不直接改变请求前缀。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 每份记忆存储要求只有一个 Host。包括崩溃后在内，锁都不会被自动抢占；不支持网络共享根目录。
- 词法排序和相同主题的冲突分组不能识别任意语义关系或矛盾。自然语言适用条件仍是说明文本。
- 来源检查描述观察时刻，不与后续代码执行组成事务。文件恢复为相同字节时可以恢复可用性，但复核期限不会随之改变。
- 撤回停止普通复用，但不会擦除 domain 历史或 Session 日志。不提供自动提炼、外部来源或跨 Workspace 共享。

<a id="dev-note"></a>
### 开发备注

无。
