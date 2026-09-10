---
description: "SQLite 存储后端：面向在单个数据库文件中选择、配置或排查按行存储文档的 KV 存储的宿主与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-storage-sqlite

[English](README.md) | 中文

## 概述

`dsh-storage-sqlite` 把已路由单元托管在一个 SQLite 数据库文件中，每条记录按行保存一份 JSON 文档。组合可以挂载多个命名实例，并要求实例在打开领域前证明独占所有权、提交同步和私有文件系统根目录。它适合频繁的定点写入或本地可查询数据库；需要让人直接阅读纯文件时选择 JSON 后端。本后端只面向宿主侧：它不贡献提示词、工具或 schema，因此模型与 agent loop（智能体循环）永远不会看到它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当组合把频繁更新的领域数据保存在一个数据库中时使用本包：把相关领域路由到此后端，每个单元即作为表物化在配置的数据库文件中。

### 何时选择

当写入频繁且为定点更新时选择它——每个键恰好映射到一行，因此更新一条记录只触碰一行，而不是重写整个文件。当人类需要以纯文本文件查看或编辑已存数据时选择 JSON 后端。同步的 `node:sqlite` 驱动会在每条单语句调用期间阻塞 JavaScript 线程，这在领域数据规模下可以接受，但高写入率时值得纳入考量。

### 配置

默认实例与已有配置保持兼容。只有要求相应保证的领域才需要显式设置所有权、同步、身份与目录控制。`:memory:` 打开一个进程内数据库，其内容随进程消失。

```yaml
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-sqlite'
  config:
    path: /var/lib/dsh/data.db
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: sqlite
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `backendName` | `sqlite` | 在存储枢纽中的注册名称 |
| `path` | 必填 | SQLite 数据库文件路径，或 `:memory:` |
| `journalMode` | `wal` | Journal mode：`wal`、`delete`、`truncate` 或 `persist` |
| `pathBase` | `cwd` | 相对路径基于进程 cwd 或 `dsh-home` 解析 |
| `ownership` | `shared` | 共享锁，或文件数据库的 `exclusive` 连接 |
| `synchronous` | SQLite 默认值 | `normal`、`full` 或 `extra`；`full` 和 `extra` 声明 `commit-sync` |
| `applicationId` | 未设置 | 仅文件库可用的非零身份；外来或未版本化数据库会被拒绝 |
| `privateDirectory` | `false` | 打开前创建或核对仅所有者可访问的本地目录 |

`exclusive` 要求文件数据库和 `delete` journal，并持有连接锁直至关闭；第二个所有者会立即失败。`applicationId` 也要求文件库，因为内存数据库无法在重新打开后保留身份。`privateDirectory` 在 Windows NTFS 上逐层创建并复验受保护 DACL，并拒绝不安全的既有 ACL、reparse point、硬链接别名、UNC 路径和非 NTFS 卷。它不能隔离以同一 Windows 用户运行的另一个进程。生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-storage-sqlite)是每个受支持字段及其 JSDoc 的穷尽式真源。

### 可观察行为

在支持 POSIX mode 的平台上，缺失目录和数据库文件使用仅所有者可访问的 mode。启用 `privateDirectory` 时，后端会在 SQLite 打开前核对真实目录和文件权限。显式 `applicationId` 防止系统认领看似为空的外来数据库；不兼容的物理版本或单元版本会被拒绝而不是迁移。写入在配置的 SQLite 保证下 resolve 后即已持久。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本后端是在单个 `node:sqlite` 连接之上的文档按行布局，设计目标是让每次按键更新都是一条预处理语句。

### 设计理念

- **每行一份文档。** 每个单元表都变成一张物理 STRICT 表 `u_<unit>_<table> (key TEXT PRIMARY KEY, value TEXT)`，其 `value` 列保存记录的 JSON 文本；全局单例存放在共享的 `unit_globals` 表中。一个键的更新恰好触碰一行——这就是把高频变更领域路由到这里的原因。
- **单语句原子性。** 每个写入原语都是一条预处理语句，因此 SQLite 的逐语句原子性无需显式事务即可满足 KV 约定；写入顺序仍由调用方负责（领域层的写入链）。
- **名称在 DDL 之前校验。** 单元名与表名在进入 DDL 之前必须匹配 `UNIT_NAME_RE`，因此任何外部输入都不会被插值进 SQL 标识符。
- **版本明确报错。** 物理布局版本存放在 `PRAGMA user_version`（全新数据库最后盖戳）；单元格式版本存放在 `units` 表中。任何其他已标记值都会被拒绝——不做迁移。

### 打开顺序

打开过程会禁用扩展加载、应用连接安全设置、核对可选私有路径、取得所需锁，并在事务中检查 journal mode、应用身份与物理版本后才发布 ready。全新元数据与每个单元的表都以事务物化，因此初始化失败不会留下版本标记或半成品单元注册。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：命名注册、配置、保证与单元表 |
| [`src/schema.ts`](src/schema.ts) | 打开顺序、物理布局版本、元数据表、记录表命名 |
| [`src/private-directory.ts`](src/private-directory.ts) | 私有路径创建与原生权限核对 |
| [`src/unit.ts`](src/unit.ts) | 一个已打开单元：预处理语句、JSON 值解析、关闭 |
| [`src/invariant.ts`](src/invariant.ts) | 不变式伴生插件（无运行时不变式：版本是打开时检查） |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当本后端视角不够用时阅读以下页面：子系统参考是权威约定，兄弟后端展示了另一种介质。

- [存储子系统](../../../docs/subsystems/storage.zh.md)——后端约定、领域语义与生成的 API。
- [存储包映射](../README.zh.md)——家族的各包及其在仓库中的位置。
- [JSON 存储后端](../storage-json/README.zh.md)——面向小而可检查数据的人类可读介质。
- [领域 KV 存储 Agent Note](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.zh.md)——后端家族背后的设计与被推迟的会话后端迁移。

-----

<a id="model-experience"></a>
## 模型体验

### 已存领域记录

#### 模型看到什么

无。本后端不贡献提示词、工具或 schema；它在 `ctx.storage` 后面持久化非会话领域数据，只供宿主侧消费方使用。

#### Token 影响

实时请求 token 为零。

#### KV Cache 影响

无：本后端从不触碰实时请求前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明本后端何时不合适，或何时需要特别的运维注意。它们是当前包约束，不是任务积压。

- **同步驱动阻塞事件循环**——每次写入都是一次同步 `DatabaseSync` 调用；阻塞只持续一条语句，在领域数据规模下可以接受。
- **不忙等待或抢锁**——存在竞争连接时立即拒绝；独占所有者不会等待、终止或回收另一个进程。
- **Windows ACL 不能隔离同一用户**——另一个持有相同用户 token 的进程可以读取数据库文件；能力发现与 Agent 授权需要单独的策略层。
- **只打开当前的物理布局版本**——任何其他已标记的 `user_version` 都会被拒绝而不是迁移（预发布立场）。
- **打开顺序与会话包重复**——`openDatabase` 与会话持久化 SQLite 的打开顺序一致；提取到共享介质层的工作被推迟到计划的会话后端迁移。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
