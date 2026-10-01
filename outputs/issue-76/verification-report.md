# Issue 76 — SSP-WP1 实现与验证报告

## 结论

本实现位于 `codex/side-effect-safety-plane`，基线 `e3c5294`，仅包含 SSP-WP1 及用户明确批准的最小 Dynamic Cordis 存储权限修复。通用 synthetic/restart/CAS/预算/绕过测试及 keyless transcript 场景通过。仍有下述全仓既有失败、环境受限检查及新增包 publication metadata 检查冲突，不能宣称全仓 CI 绿色。编写本报告时尚未 commit、push 或 merge；最终交付身份由主代理报告。

发现过的真实反例是 Dynamic 插件通过 `storageDomain.get(...).global.set(...)` 伪造 CONFIRMED，而 sender 调用为零。初始诊断已替换为拒绝该路径的负向回归。运行时现拒绝 raw storage hub/facility/backend registry/backend/KV facet 与其已注册身份别名，以及返回这些对象的服务入口；同时阻止 descriptor/prototype/original-symbol/valueOf 反射回到 raw service，并使 `domain/changed` 的 on/once payload 脱离内存权威对象。普通业务服务、可调用服务、自返回服务 façade 和静态 Host 存储消费者仍可用。

这是现有可达存储能力的限制，不是任意恶意 Host 代码、Node VM 或文件系统沙箱。可信 Host 不得把私有 Domain/global/table 写 handle 重新导出给动态代码。没有新增通用权限标记平台或 scoped storage 产品。

## 实现与边界

- 计划：[15 问实施计划](implementation-plan.md)。包/Service owner 为 `packages/guard/side-effect-safety` / `SideEffectSafety`，Storage Domain owner 为该包的 `side_effect_safety` version 1。
- 公开 Host 类型包括 approval/draft/human proof、execution/action/lease identity、risk budget/cost、adapter/binding、admitted handle、settlement、snapshot。Service 仅公开 detached `snapshot`；所有 mutation 都在静态 Host adapter capability 下，实际事务槽验证 domain 和生命周期。
- 一个有界 global 文档包含 approvals、executions、revision、control、lease、hard blocker、actions；不保存领域 payload、transcript 或 evidence 字节。提交与 reopen 验证身份、摘要、唯一审批绑定、lease 时间关系、预算总量和 terminal 约束。每个已发送 action 保留唯一 sentRevision，连续失败按发送顺序计算，不受准备顺序或同毫秒时间戳影响。
- 合法 action transition：PREPARED → SENT → CONFIRMED / NOT_APPLIED / UNKNOWN；UNKNOWN → RECONCILING → CONFIRMED / NOT_APPLIED / UNKNOWN；仅 PREPARED 可 CANCELLED。没有 UNKNOWN → PREPARED。
- commit 顺序：durable approval → execution/lease → PREPARED → 检查并 mint process-local handle → 重查并原子提交 SENT + budget → 私有 sender → durable settlement。SENT 提交失败不会调用 sender。
- 重启释放旧 lease，将遗留 SENT/RECONCILING 持久改为 UNKNOWN；恢复只允许 metadata-only inspect。证据不足、抛错或 malformed settlement 保持 UNKNOWN；同 target 的后续工作被阻止。
- 确定性预算在 SENT 原子消费，由 ledger 派生；NOT_APPLIED 不退款。CAS 序列化读改写；幂等 retry 返回原 action，异摘要冲突持久 hardBlock。Breaker 派生 READY/RUNNING/PAUSED/RECONCILING/BLOCKED/COMPLETED。
- Execution Lease 绑定业务 execution、approval、target、runtime owner 与期限；它不替代 Session 日志 writer 排他锁。仅单 Host writer，非分布式锁。
- 复用 `ctx.approval.request` 作为一次性交互；另需可信 adapter 的精确 draft digest、人类身份和 evidence proof 才冻结 durable artifact。`allowed-once` 或 Planning adoption 本身不授权。
- BrowserTask/extension journal 与本内核均采用 intent-before-send、lookup-only recovery、unknown no replay。未迁移其传输；未来浏览器层仍须明确定义低层 intent/Safety SENT 的 commit 映射。Delivery prepared/publishing/unknown 对应 PREPARED/SENT/UNKNOWN；其 confirm-not-created retry 留给原 owner，本内核原 action 终结后不可重放。
- FC27 未来可复用 approval-preview、risk-preflight、execution-gate、write-lease、execution-dry-run、transaction-readback；本包不 import FC 概念。inventory completeness、quote/market proof、solver proof、真实 executor 与浏览器集成未实现。

## 验证证据

所有操作均使用 dot cloud shell 和仓库正常工具；没有启动 Work/Codex/外部编码任务，没有进入 WP2，没有真实 FC27 purchase/fill/submit、Browser write 或其它外部业务写入。测试 executor 全部为 synthetic callback。

| 实际命令 | 结果与证明范围 |
|---|---|
| `node_modules/.bin/vitest run packages/guard/side-effect-safety/tests packages/extensions/cordis-host-runner/tests/sandbox-context.spec.ts --coverage --coverage.include='packages/guard/side-effect-safety/src/**/*.ts'` | 79 tests 通过，退出 0。kernel statements/branches/functions/lines 均 100%；仓库默认排除 extensions coverage，因此不声称 guard.ts coverage 为 100% |
| 上述 built Loader test | 真实 Loader + built exports + JSON storage；built Dynamic guard 拒绝 storageDomain 访问。进程在 durable SENT 后退出，重启阻断 B，A 对账为 NOT_APPLIED 后仅执行 B；外层独立读取持久文件验证 |
| `npm run build:lib:host` | 最终 Host aggregate typecheck + tsdown 通过，退出 0 |
| `npm run build:lib:client` | Client aggregate typecheck + tsdown 通过，退出 0；未执行完整 Web 应用 build |
| `node_modules/.bin/tsc -b packages/extensions/cordis-host-runner/tsconfig.json packages/guard/side-effect-safety/tsconfig.json` | focused 类型检查通过，退出 0；最终 sentRevision 变更另由最终 Host aggregate 覆盖 |
| `node --import tsx scripts/run-oxlint.ts packages/guard/side-effect-safety packages/extensions/cordis-host-runner/src/guard.ts packages/extensions/cordis-host-runner/tests/sandbox-context.spec.ts` | focused lint，无诊断 |
| `node --import tsx scripts/gen-cordis-catalog.ts --check` | 119 个 artifact/region 新鲜；Safety Service catalog 仅公开 snapshot |
| `DSH_SNAPSHOT=refresh DSH_EXAMPLE_MODE=lib node_modules/.bin/vitest run --config vitest.snapshot.config.ts snapshots/session/headless.snapshot.ts -t 'side-effect-storage-denial'` | 1 场景通过，退出 0；通过真实 headless dsh、Session、工具与 Dynamic runner 生成当前 transcript/header，不使用手写工具结果作为验收 |
| 同命令 `DSH_SNAPSHOT=replay` | 独立 keyless replay 通过，退出 0；tool/result 固定 `cordis_run` 的 isError=true 与精确 Host-only storage 拒绝文本 |
| 五对本次文档的 `verify-translation-pairing.ts <paths>` | group/package/subsystem/Agent Note/runner README 配对一致，退出 0 |
| package paths / package identities / Agent Note format / README limitations | 检查通过；全仓其他检查的限制见下一节 |
| `git diff --check` | 通过 |

snapshot 是 `snapshots/session/side-effect-storage-denial` 下独立的 test-only composition。其默认 headless 基线原本因无关 session-projection-cache 的 storageDomain isolation 无法激活；测试 patch 显式禁用该 cache，没有改 shipped profile。因此此结果不等于原始默认 headless composition 通过。当前 prompt/tool schema sidecar 由实际 refresh 生成，未改旧 fixture pin 来消除既有漂移。

测试所需 native Session lock 最初缺失；使用官方 Node v24.19.0 headers 和仓库官方 `native/system/scripts/build.ts --host-addon-only` 构建成功。没有 mock 锁、改变 native 源码或修改系统 Node 安装。生成的 binary 属忽略构建产物，不随本变更提交。

## 未通过或未完成的检查

- 全 runner + kernel 的较广回归运行 221 tests：220 通过，1 个既有 `runner.inventory()` expected 缺 `ownerKind` 的失败。对应 runner.spec.ts、index.ts、registry.ts 已逐文件与 HEAD 字节比对一致；没有更新不相关 golden 来掩盖它。之后增加的 sentRevision 回归已在上述 79 项 focused 运行通过。
- workspace constraints 对本新增包仍报 private/publication/repository 三项：旧 checker 将 guard 视作 upstream release family，要求 public 与 deepseek-ai repository；本包真实身份是 personal @changanhua 且禁止未经验证发布，保留 private 和真实 fork 地址。这是新增包自己的未通过项，不能称为纯基线失败。
- constraints 中另涉及的 343 个已存在文件与 HEAD 字节相同；package-invariants 的 65 个既有失败文件、subsystem 现有目录问题、markdown-wrap 的 7 个既有文件、markdown-links 的 16 个既有文件均未被本任务修改。分类来自逐文件 `git show HEAD:<path>` 字节比对。
- 全仓 README Model Experience 和 translation-pairing 仍有其它文件问题；本次文档自身规则已修复，本次配对已单独验证。
- `doc-sync` 已通过真实 pnpm runner 重试，关闭运行脚本时的自动重装后，并在允许的 sandbox escalation 下仍因 tsx `listen EPERM /tmp/tsx-1000/*.pipe` 未能启动 aggregate。不能宣称 doc-sync 完成；没有为此更改平台安全设置。
- lockfile-only 离线解析尝试因全仓既有 registry metadata 缺失失败。新增 runner 依赖仅为已在 workspace 中的 Storage 类型依赖，lockfile 记录其现有 `link:../../storage/storage`，未引入新外部版本。
- Corpus metadata 的选定检查退出 1，阻塞于已有 `web-ptc/web-ptc` duplicate header pin；本场景采用独立 `side-effect-safety/side-effect-safety` key，已独立 refresh/replay 通过，不宣称全 corpus 校验通过。
- 完整 Web build、全仓 lint、全仓 tests、跨平台矩阵未运行；不声称通过。

## 交付边界

SSP-WP1 后停止。BrowserTask transport requestId/locator integration、FC adapter、真实 inventory/market/solver proof、生产操作 UI 与任何真实外部 executor 仍属于后续明确授权的工作。现有 BrowserTask 和 Delivery 未迁移；没有第二个 evidence byte store。
