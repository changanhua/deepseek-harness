# 下游功能放置政策

[English](feature-placement.md) | 中文

## 概述

每项个人修改都应放在第一个能够拥有其真实生命周期、权限、事实和失败语义的层级。新增配置、插件、个人 package、Bundle、适配器、通用上游 seam 或私人 core patch 前，先复用官版行为。这项政策可以防止便利性修改变成永久的 fork 级耦合。

## 目录

- [强制放置顺序](#mandatory-placement-order)
- [层级判定](#layer-tests)
- [事实与权限规则](#fact-and-authority-rules)
- [当前个人增量矩阵](#current-personal-increment-matrix)
- [准入记录](#admission-record)
- [进一步探索](#further-exploration)
- [Dev Note](#dev-note)

<a id="mandatory-placement-order"></a>

## 强制放置顺序

按照以下顺序评估一项功能，并在第一个能够满足完整需求的层级停止：

```text
official capability（官版能力） → configuration/Profile（配置/Profile） → Plugin/Slot → @changanhua package（@changanhua 包） → Bundle → Compatibility Adapter → general upstream seam（通用上游 seam） → private core patch（私人 core patch）
```

代码量不是决定因素。应比较用户结果、输入与输出、权限、生命周期、副作用、事实所有权、组合、恢复和验证。如果一个包装层必须重新实现持久化、重试、授权、清理或领域状态机，它就不是适配器。

<a id="layer-tests"></a>

## 层级判定

| 层级 | 适用条件 | 绝不能变成 |
|---|---|---|
| 官版能力 | 现有源码和已组合 provider 已经拥有所需语义，只需新增调用方或 Profile 选择。 | 没有行为差异的复制实现或个人别名。 |
| 配置/Profile | 行为已经存在，只改变参数、provider 选择、scope 或有序组合。 | 编码在数据里的隐藏代码、持久事实或第二套策略引擎。 |
| Plugin/Slot | 已记录的 event、service、tool registry、command、Remote 或浏览器 slot 可以贡献并释放该行为。 | 仅因贡献顺序不方便而形成的宿主 patch。 |
| `@changanhua` 包 | 个人产品领域、provider、Consumer 或 UI occupant 具有独立所有权和测试。 | 混合无关生命周期与事实的通用 `common` package。 |
| Bundle | 现有 plugin 需要一个可安装、有序的部署选择。 | scheduler、store、executor、verifier、parser 或领域决定所有者。 |
| Compatibility Adapter | 两个现有接口需要有界字段、framing 或 protocol 转换，同时各自领域保持独立。 | 业务事实、权限、重试、持久化或验收的所有者。 |
| 通用上游 seam | 没有已记录扩展点可以表达一项超出个人产品也有用的行为，并且修改可以保持最小且独立测试。 | 个人命名、策略、数据模型、UI workflow 或共享 core 中永久的下游专用开关。 |
| 私人 core patch | 每个更低层级都无法满足具名的不可妥协语义，剩余修改本质上属于 fork 策略或共享 core 行为。 | 缺少预算、证据、期限和退出路线的未登记便利性修改。 |

<a id="fact-and-authority-rules"></a>

## 事实与权限规则

一项领域事实只有一个所有者。Queue 继续拥有 Work、Attempt、result、lease 和 retry 生命周期；Delivery 拥有 Case、Contract revision、dispatch binding 和人工 acceptance；repository workspace 拥有已验证 Git 状态；evidence storage 拥有不可变证据 bytes。bridge 或 UI 可以引用这些记录，但不能把它们复制进竞争状态机。

Bundle 选择 provider 和 Consumer，但不拥有 runtime 事实。Compatibility Adapter 必须声明 `factOwnershipEffect: "none"`。除非单独授权的 command 或 Remote 拥有修改，否则浏览器 projection 只读。人类可以看到的能力不会自动进入 Agent 的 tool schema、发现 scope 或修改权限；每个 Consumer 都必须显式注册并限制这些 surface。

Package 来源和 core-patch 治理保持分离。只有 `downstream/package-identities.json` 能分类个人 npm package 和发布政策。只有 `core-patches.json` 能登记保留在上游所有代码中的修改。下方矩阵解释它们当前的产品角色，不会建立第三套 registry。

<a id="current-personal-increment-matrix"></a>

## 当前个人增量矩阵

| 能力或资产 | 主要分类 | 当前放置与事实所有者 | 删除或上游路线 |
|---|---|---|---|
| Session、Agent、tool、Profile、Cordis composition | 官版原生 | 直接复用 `@deepseek-ai/*`；相应官版 service 与 event log 保留事实。 | 跟随官版更新；不得复制为等价个人 service。 |
| Queue（`packages/task-queue/*`、`ui-task-queue`） | 个人产品 + 独立插件 | `@changanhua` Service Definition、provider、Consumer、command、Remote 和 UI；`ctx.taskQueue` 拥有 Work 与 Attempt 事实。 | 官版 Queue 具备等价持久性、权限、幂等和恢复能力时删除个人适配器；通用修复单独向上游贡献。 |
| Personal Delivery（`packages/delivery/*`） | 个人产品 + 独立插件 | `ctx.delivery`、evidence、repository workspace、runner、verifier、GitHub、Queue bridge、Remote 和 UI 保持独立所有者；Delivery 不复制 Queue 生命周期或 evidence bytes。 | 产品语义留在个人层；只把通用 seam 或可靠性修复贡献给上游。 |
| Runtime Facts（`runtime-facts*`、`tool-runtime-inspect`） | 个人产品 + 独立插件 | `ctx.runtimeFacts` 拥有有 scope 且无 secret 的 declaration；Host 和 tool package 是 projection 或 Consumer。 | 官版提供等价的 scope fact 注册与 projection 时删除兼容性 row。 |
| Capability 与 Skills 视图 | 个人产品 + 独立 UI 插件 | Host gateway 读取实时 Skills、Tools 和 MCP registry；UI package 占用 slot，且不暴露隐藏修改路径。 | 官版只读 projection 与 slot 的 scope 和 secret 脱敏等价时替换。 |
| 个人 UI module 与 workbench 视图 | 独立 `@changanhua` 插件 | Queue、Delivery、Capability、Architecture 和 Observatory package 占用 `shell.view`、sidebar 与 settings slot；领域 service 保留权威状态。 | 官版 slot 能保持 conversation 生命周期与导航时删除上游所有 layout patch。 |
| `personal-delivery` | Bundle | 静态 patch carrier，选择 Delivery、evidence、Git workspace、Queue bridge、Remote 和 UI provider。 | Profile 或官版下游 overlay 无需修改官版 bundle 即可组合相同 row 时删除。 |
| 无 parent 的 Codex 执行 | Compatibility Adapter | patch 通过显式 cwd、取消和完全停稳扩展现有 Codex provider；不拥有 Delivery 或 Queue 事实。 | 官版 provider 暴露等价调用语义时删除。 |
| Web provider 与 settings 集成 | Compatibility Adapter | 现有 Web provider 消费 settings、credential 和 runtime fact，不创建 provider 专属策略 store。 | 官版 provider 消费相同约定后删除。 |
| Windows 优先的 fork CI 与仓库信任策略 | 不可避免的 core patch | fork 自有 workflow 控制仓库权限，让托管 Windows 阻断而 Linux 只提供建议；不创建 runtime 产品状态。 | 官版 workflow 提供仓库安全的下游模式与等价 Windows 路由时删除。 |
| Client module ring 与官版 package composition 修改 | 不可避免的 core patch，可删除 | 对官版 layout、sidebar、base、headless 和 Web bundle 的窄修改暴露或选择个人 plugin。 | 用官版通用 slot 或下游 overlay 替换；不得把 UI／领域事实移入 patch。 |
| Process、取消与权限加固 | 可向上游贡献 | 已登记的 `upstream-candidate` patch 只在个人产品需要修复时留在共享 package。 | 贡献最小通用修复；等价官版测试通过后删除私人差量。 |
| 仓库文档与下游治理门禁 | 不可避免的 core patch，可删除 | root instruction、workflow test、patch check 和双语政策属于仓库控制，而不是 runtime service。 | 官版治理支持相同下游所有权与审查语义时删除本地差异。 |

<a id="admission-record"></a>

## 准入记录

每项非简单功能修改都要在其 Feature Charter、Agent Note 或已有所有者文档中记录需求、已检查候选、所选层级、被否决的更低层级、事实所有者、权限边界、状态与副作用、测试、回滚，以及删除或上游条件。私人 core patch 还必须更新 `core-patches.json`，并保持在数量和风险预算内。

不要建立新的持久化放置数据库。记录只解释一项决定；package identity、Git 基线、core-patch 清单和领域记录继续由现有机器所有者保存。

<a id="further-exploration"></a>

## 进一步探索

- [上游同步 SOP](upstream-sync.zh.md)
- [下游 core patch registry](core-patch-registry.zh.md)
- [能力 seam](../capability-seams.zh.md)
- [Package group](../../packages/README.zh.md)

## Dev Note

本矩阵覆盖与当前 fork 维护相关的个人增量。`downstream/package-identities.json` 仍是完整 package 清单。
