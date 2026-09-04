# Agent Note: 仓库拥有的 npm 发布身份

Status: implemented

[English](2026-09-04-repository-owned-npm-scope.md) | 中文

## Problem

个人发行版继承了官方 `@deepseek-ai/*` 包名、发布族和 npm workflow。一个 token、一次手工 workflow dispatch 或本机 baseline 发布器因此可能尝试用官方身份发布 fork 字节；个人包在尚无独立发布边界时，也会错误地声明官方仓库来源。

某个包在一个上游版本中不存在，并不能证明它属于个人。上游改名或删除的包同样可能不存在，因此自动 diff 不能决定命名空间归属。

## Decision

[`downstream/package-identities.json`](../../../../downstream/package-identities.json) 统一拥有两个 npm scope、各自唯一的发布仓库、受支持与已观察的上游 commit，以及显式个人包集合。未列出的包默认归上游所有，`vendor/*` 保持 vendor 来源；只有经过审查的 registry 修改才能把包认定为个人包。

个人 scope 是 `@changanhua`。每个已确认的个人包记录当前的官方形态名称、唯一目标名称和发布策略。所有条目都使用 `blocked-until-rescoped`；此决策不修改源码包名、import、bundle 行、TypeScript path、lockfile 和发布族。

## Publication firewall

[`scripts/package-identities.ts`](../../../../scripts/package-identities.ts) 要求 GitHub Actions 上下文，只允许 `GITHUB_REPOSITORY` 为 `deepseek-ai/deepseek-harness` 时发布 `@deepseek-ai/*`，只允许仓库为 `changanhua/deepseek-harness` 时发布 `@changanhua/*`，并要求个人目标名已显式登记且策略为 `personal`。Actions 或仓库身份缺失以及无人拥有的 scope 都会关闭式失败。

dsh、vendor、baseline 和 Landlock 发布路径都会在第一次访问 registry 前执行检查。只校验 tag 的发布检查使用 `RELEASE_VERIFY_TAG`，不会进入 registry 写入 guard，因此文档部署可以在没有 npm 权限时验证 release tag。官方 npm 发布 workflow 按仓库身份保护每个 job；在个人发行版拥有独立 PyPI 名称前，公开 Python 发布 job 也使用相同的官方仓库限制。个人 fork 的 dispatch 无法进入持有 token 的 job。这些检查防止误用仓库发布工具；npm 或 PyPI 凭据和 trusted-publisher 配置仍是外部授权边界，恶意本机进程可以绕过仓库脚本直接调用 registry 客户端。

## Package ownership

registry 包含个人分支在受支持上游 commit `cd5ef8148158c3a752a658978873241fdf8e2bbc` 之后引入的 41 个 package manifest。显式列入代表所有权决定；commit 比较只是审查证据，不是判断后来上游新增包的推断规则。

只有当完整模块解析和配置闭包都采用目标名称、repository 元数据指向个人仓库且 registry 策略改为 `personal` 时，一个包才可以发布。个人包可以继续依赖未修改的官方 Service Definition。依赖私改上游实现的包保持 source-only，直到该依赖被抽离或获得自己的个人发布身份。

## Alternatives considered

**立即 rescope 全部 workspace 包。** 不采用，因为 300 多个 manifest 和数千个源码、配置、测试与文档引用都带有官方 scope。在下游分支长期保留这次重写会扩大几乎每次上游合并，并把来源策略与运行迁移混在一起。

**只改 41 个 manifest。** 不采用，因为源码 import、workspace dependency、bundle 插件名、生成目录、TypeScript path 和 lockfile 都按包名解析。只改 manifest 可能通过表面审查，却产出无法安装的发行版。

**仅在 pack 时改写包名。** 不采用，因为发布后的模块图会与源码模块图不同，普通 checkout 无法复现安装产物。

**只依赖 fork workflow 没有 npm token。** 不采用，因为以后可能添加凭据，本机发布路径仍然存在，而缺少 secret 并不能说明命名空间由谁拥有。

## Consequences

fork 已拥有个人命名空间，但没有声称个人 npm 发行版已经存在。当 Actions 与仓库身份不一致时，仓库发布路径会在访问 registry 前失败；每个个人包也都有唯一、可审查的目标身份和显式停止状态。

源码树在后续独立 rescope 变更落地前仍然是混合身份。这增加了一份 registry 和一道检查，但让首批变更可逆，也要求后续每个包族在允许发布前先证明完整依赖闭包。较早的[发布序列](2026-08-10-npm-release-sequences.zh.md)与[访问级别](2026-08-13-public-vendor-and-native-sequences.zh.md)决策仍管理官方 scope 产物；本决策增加仓库所有权和个人发行边界。
