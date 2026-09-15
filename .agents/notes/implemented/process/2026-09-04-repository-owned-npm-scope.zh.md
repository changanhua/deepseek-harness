# Agent Note: 仓库拥有的 npm 发布身份

Status: implemented

[English](2026-09-04-repository-owned-npm-scope.md) | 中文

## Problem

个人发行版继承了官方 `@deepseek-ai/*` 包名、发布族和 npm workflow。一个 token、一次手工 workflow dispatch 或本机 baseline 发布器因此可能尝试用官方身份发布 fork 字节；个人包在尚无独立发布边界时，也会错误地声明官方仓库来源。

某个包在一个上游版本中不存在，并不能证明它属于个人。上游改名或删除的包同样可能不存在，因此自动 diff 不能决定命名空间归属。

## Decision

[`downstream/package-identities.json`](../../../../downstream/package-identities.json) 统一拥有两个 npm scope、各自唯一的发布仓库、受支持与已观察的上游 commit，以及显式个人包集合。未列出的包默认归上游所有，`vendor/*` 保持 vendor 来源；只有经过审查的 registry 修改才能把包认定为个人包。

个人 scope 是 `@changanhua`。每个已确认的个人包都记录旧名称、源码名称、源码身份、发布策略、尚不存在的发布族，以及明确的发布阻断项。全部 41 个条目都使用 `blocked-until-release-verified`；manifest、import、bundle 行、TypeScript path、目录和 lockfile 采用个人源码名称，现有版本保持不变。源码版 CLI 把个人 Delivery bundle 声明为 workspace dependency，因此构建后的入口会从安装本身解析该 bundle，不依赖测试运行器或全局模块搜索路径。

## Publication firewall

[`scripts/package-identities.ts`](../../../../scripts/package-identities.ts) 要求 GitHub Actions 上下文，只允许 `GITHUB_REPOSITORY` 为 `deepseek-ai/deepseek-harness` 时发布 `@deepseek-ai/*`，只允许仓库为 `changanhua/deepseek-harness` 时发布 `@changanhua/*`，并要求个人源码名称已显式登记且发布策略为 `personal`。Actions 或仓库身份缺失以及无人拥有的 scope 都会关闭式失败。

dsh、vendor、baseline 和 Landlock 发布路径都会在第一次访问 registry 前执行检查。官方 DSH 发布族在排除已登记的个人目录前，会验证该目录的 manifest 仍使用已登记的个人源码名称、仓库和 source-only 发布设置；随后拒绝官方成员通过任何运行时依赖或 peer dependency 指向个人 scope。publish 步骤还会独立地把同一闭包规则应用到每个 packed manifest，并在第一次读取 registry 前要求打包集合、顺序、身份、版本和运行时依赖名称与当前源码 family 完全对应。

官方 DSH 发布演练和文档部署 job 只在 `deepseek-ai/deepseek-harness` 运行：这棵混合源码树应当让官方闭包失败，不能为通过检查而削弱闭包。个人仓库 CI 会执行 immutable install 和完整构建，然后用隔离 home 启动构建后的 CLI；验收 Profile 由官方 base 与个人 Delivery bundle 组成，运行检查要求个人 Delivery、evidence、repository-workspace 和 Remote 服务全部挂载。官方 npm 发布 workflow 按仓库身份保护每个 job；在个人发行版拥有独立 PyPI 名称前，公开 Python 发布 job 也使用相同的官方仓库限制。个人 fork 的 dispatch 无法进入持有 token 的 job。这些检查防止误用仓库发布工具；npm 或 PyPI 凭据和 trusted-publisher 配置仍是外部授权边界，恶意本机进程可以绕过仓库脚本直接调用 registry 客户端。

## Package ownership

registry 包含个人分支在受支持上游 commit `cd5ef8148158c3a752a658978873241fdf8e2bbc` 之后引入的 41 个 package manifest。显式列入代表所有权决定；commit 比较只是审查证据，不是判断后来上游新增包的推断规则。

个人包是 source-only workspace 成员：manifest 指向个人仓库，设置 `private: true`，省略 `publishConfig`，并按目录从官方 DSH 发布族中排除。只有当 tarball 依赖和配置闭包经过独立验证、Personal 发布族已经定义、`private` 被移除且发布策略改为 `personal` 后，一个包才可以发布。个人包可以继续依赖未修改的官方 Service Definition。依赖私改上游实现的包保持 source-only，直到该依赖被抽离或获得自己的个人发布身份。

## Alternatives considered

**立即 rescope 全部 workspace 包。** 不采用，因为 300 多个 manifest 和数千个源码、配置、测试与文档引用都带有官方 scope。在下游分支长期保留这次重写会扩大几乎每次上游合并，并把来源策略与运行迁移混在一起。

**只改 41 个 manifest。** 不采用，因为源码 import、workspace dependency、bundle 插件名、生成目录、TypeScript path 和 lockfile 都按包名解析。只改 manifest 可能通过表面审查，却产出无法安装的发行版。

**仅在 pack 时改写包名。** 不采用，因为发布后的模块图会与源码模块图不同，普通 checkout 无法复现安装产物。

**只依赖 fork workflow 没有 npm token。** 不采用，因为以后可能添加凭据，本机发布路径仍然存在，而缺少 secret 并不能说明命名空间由谁拥有。

## Consequences

fork 已拥有个人源码命名空间，但没有声称个人 npm 发行版已经存在。当 Actions 与仓库身份不一致时，仓库发布路径会在访问 registry 前失败；每个个人包也都有唯一、可审查的源码身份和显式停止状态。

源码树有意让官方上游包与已登记的个人包使用不同 scope 并存。运行时 service key、Loader row ID、Remote namespace、WorkKind 和持久化格式不随 npm 身份改变，因此回滚 rescope 不需要数据迁移。registry 和发布 guard 要求后续发布族变更先证明个人 tarball 闭包，才能允许发布。publish 阶段的 manifest 校验可以阻止 source-only scope 通过陈旧工件泄漏，但它不是对其余相同 package 字节的密码学证明；后者属于独立的供应链加固事项。较早的[发布序列](2026-08-10-npm-release-sequences.zh.md)与[访问级别](2026-08-13-public-vendor-and-native-sequences.zh.md)决策仍管理官方 scope 产物；本决策增加仓库所有权和个人发行边界。
