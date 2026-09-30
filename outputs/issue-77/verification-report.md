# Issue 77 Phase A 验证与交付报告

状态：Phase A 实现与针对性验收已完成，按用户指定的失败回退策略交付完整 patch。没有创建 implementation commit、PR 或推送远端；本文明确区分通过、失败和未运行。

## 1. Package/group 放置

新增 `packages/domain-runtime/` 能力组，含 `@changanhua/dsh-domain-runtime`、`@changanhua/dsh-fc-sbc-domain`、`@changanhua/dsh-tool-fc-sbc-domain`。Browser 继续拥有 transport/页面身份/授权，Planning 继续拥有 Board；generic artifact registry 不适合归任何一个现有领域 owner，也不能由 experimental 提供 released 依赖。包保持 private 并登记现有 downstream personal identity；不新增发布渠道。

## 2. Public contract 与服务

`ctx.domainArtifacts`：`DomainArtifactRef/Header/View`、`DomainSourceRef`、`DomainDescriptor`、`DomainRuntimeProvider`，以及 register/discover/readHeader/readArtifact/parents。artifact/domain 跨界 identity 使用品牌类型，外部 JSON 与冷存储读取经 schema 校验。

`ctx.fcSbcDomain`：captureReality/buildPlan/readArtifact/getStatus。它接收已取得的 typed observation，不创建浏览器读取通道，不执行页面函数。

## 3. Provider registry

注册只保存 provider 与 detached descriptor。重复 domain、未知 provider/kind、错返 domain/kind/id/digest 均 fail closed。注册是贡献方 Cordis effect，dispose 后不可读；在途读取使用独立 registration identity，卸载后复用同一个 provider 对象注册也不能使旧调用成功。发现、header 与 payload 读取均 detached；完整 metadata envelope 的上限为 32,768 UTF-8 bytes，包含发现目录。

## 4. Artifact identity、immutability 与 digest

FC artifact ID 是规范化对象键顺序后完整 immutable header/payload 的 SHA-256，ref 携带 `sha256:` digest；不是 existing solver 的短候选 fingerprint。首次创建时间与观察时间分离；规范输入到 artifact 的映射及 requestId receipt 与 artifact 在同一 Storage Domain 提交。相同 canonical 输入跨并发、不同 requestId、重启复用同一 artifact；同 requestId 的不同输入拒绝。读取副本不能修改 owner state；冷读重新校验 schema、digest 与 lineage。新增观察产生新 artifact，不修改旧记录。

## 5. Coverage、freshness 与 lineage

库存 complete 要求 MAIN read 声明 complete、Club 和 SBC Storage 都有非零页数及明确 retrievedAll、合法且无重复实例、无未知来源或保护状态。可见卡、未知 source、缺 identity、重复、缺遍历终点均不会升级完整覆盖。重复实例不会作为可用未锁卡进入候选。

完整组覆盖独立保守：既有 main-read 可以按 challengeTitles 过滤，却不带全组 count/end proof，故 group 始终 partial/unknown。mixed-offset timestamps 按 Date.parse 比较，整体 observedAt 取最旧证据。没有 expiry 或观察时间在未来时 freshness unknown；status 随当前时间计算 stale，而历史 header/Plan 不变。

Plan 的 `derivedFrom` 严格等于一个 exact Reality ref（含 digest），payload 的 realityRef 与其相同。直接父引用足够本阶段追溯，不建图数据库。

## 6. Payload persistence owner

FC owner 的 `fc_sbc_artifacts` Storage Domain 保存 artifacts、canonical input mapping 和 idempotency receipts；generic registry 不持久化、不复制 owner payload。实际组合使用既有 storage-json + storage-domain；schema 验证、单一 owner 串行提交、artifact/完整存储字节容量边界与 dispose drain 保证失败不发布和重启可读。存储根应由一个 Host 管理；本阶段不增加跨 Host 分布式协调或自动淘汰证据。

## 7. FC Reality compiler 复用

使用既有 main-read 产物合同；实际 fixture 运行 `readFcSbcMain`（只 mock EA 外部读），再进入 Reality compiler。复用 `updateFcSbcPageModel` 与 `createSbcInventorySnapshot`，保留稳定 card instance/version identity。输入字段逐层 allowlist 投影，URL query/hash、token、raw DOM/textSample 和未声明字段不入 artifact。来自当前 application-model 的 unknown/coverage 约束被保留，未将历史模型经验当作实时账号事实。

## 8. Completeness 边界

page-only、规则缺字段、部分库存、未验证保护状态、未知平台/组身份、unknown market access 仍显式保留。库存完整不证明完整组或候选已通过所有规则；缺 reserveValue 不伪造成观测到的零资产价值，候选另列 reserve-value-unverified。未观察完成状态不会变成已完成。

## 9. Solver input compiler

从 exact Reality 的 typed requirements 与规范实例投影调用 existing `generateSbcPuzzleCandidates`；只有返回 ready 且无 provisional 的关卡候选才能进入 existing `buildSbcPlanVariants`。跨关组合复用实例冲突和非支配计划逻辑，并在调用前限制候选数量乘积。partial/缺原生验证的诊断候选保存在 challengeCandidates，不混入可核验整组候选。

## 10. Plan Artifact 语义

保留 solver version、searched、searchComplete、incompleteReasons、每关候选与 provisional/issues。bounded 空搜索保留 searchComplete=false；库存/组覆盖与候选截断分别列明。复用 quote-preflight，但无 real quote provider，quoteStatus 固定 missing，readiness 只能 candidate/blocked，绝不 ready-for-approval。native chemistry MAIN-world 函数不会执行；缺 evaluator 沿用既有 solver 的显式 provisional blocker。readiness 只共享提取出的纯 observation 判断，未调用原 approval/execution 报告链。

## 11. Agent-facing facade

`fc_sbc_inspect`、`fc_sbc_plan`、`fc_sbc_status` 均经过真实 tools registry，使用闭合 typed schema，只调用 FC service；返回 ref 与有界状态。输出完整 UTF-8 上限默认 8,192 bytes，可配置 1,024–32,768，超出则保留 ref/核心状态并将细节换成计数。大 payload 使用 artifact read API，不塞入工具结果。

## 12. Agent 编排收敛

Agent 在已有 observation 之后只需 inspect → plan → status；库存规范化、coverage 判定、solver 输入、candidate/quote/readiness 解释及持久 lineage 由 FC owner 收敛。没有 generic `domain.invoke(any JSON)`，也没有新 solver framework。初版不是 live FC browser adapter；用户或已有读 owner 仍须提供新鲜 observation。

## 13. Planning / Thinking / Safety 边界

未来消费者可把 kind/id/provider=fc27/revision=digest 放入既有 ResourceRef；本次不改 Planning schema、不提交 Board mutation、不改 Thinking Desk、不建立 Approval/Safety/Executor。下游只能引用 immutable ref，payload 仍由 FC owner读取。候选 ref 本身不授予执行权。

## 14. 实际验证

已通过：

- 源码针对性回归：23 个测试文件、129 tests passed，built 专用测试在默认 source run 中显式 skipped；含全部既有 fc-sbc-* 回归、新 generic/FC/真实 Loader/cold restart、实际 MAIN reader fixture 与 constraints 边界测试
- 新三个包及引用依赖 focused TypeScript project build；最终全 Host 与全 Client library build 均 exit 0，冻结后的 Host aggregate TypeScript 另行增量检查
- 新三包、变动脚本与测试的 project-free focused Oxlint
- 独立 built artifact 验证：复制 FC bundle 到临时目录，用 plain Node + Loader 启动；禁止访问 extension app source、MAIN-world services 与 network；Reality→Plan，完整销毁 owner/Loader后重新加载，读回逐字段相同 artifact。该 built-only测试独立执行通过
- 下游 package identities：75 personal packages 校验通过，新三包使用既有阻断发布策略
- 模块依赖图与工具目录生成通过；11 个本次双语文档 pair 检查通过；README limitations 与 Agent Note format 全仓检查通过，新包 Model Experience/invariant 文档问题均已修复
- 新 authored recorded-session 场景 `domain-runtime-missing-reality` 经真实 `dsh --profile headless` 启动，refresh 与独立 replay 各 1 passed；真实工具输出分别为 `Error: exact-reality-required` 和 `Error: artifact-not-found`。最终构建后再次 replay 与独立 built-only 回归均通过

主要复现命令（仓库根目录）：

```sh
pnpm install --offline --frozen-lockfile --ignore-scripts --store-dir /tmp/dsh-pnpm-store
node node_modules/typescript/bin/tsc -b packages/domain-runtime/domain-runtime packages/domain-runtime/fc-sbc-domain packages/domain-runtime/tool-fc-sbc-domain
node node_modules/vitest/vitest.mjs run packages/domain-runtime apps/chrome-extension/tests/fc-sbc-*.spec.ts scripts/check-workspace-constraints.spec.ts --maxWorkers=2
npm run build:lib:host
npm run build:lib:client
DSH_EXAMPLE_MODE=lib node node_modules/vitest/vitest.mjs run packages/domain-runtime/fc-sbc-domain/tests/built-artifact.spec.ts
node node_modules/oxlint/bin/oxlint --config .oxlintrc.staged.json packages/domain-runtime scripts/check-workspace-constraints.ts scripts/check-workspace-constraints.spec.ts scripts/gen-cordis-catalog.ts scripts/gen-doc-graphs.ts scripts/gen-tool-catalog.ts
node --import tsx scripts/package-identities.ts
DSH_SNAPSHOT=refresh DSH_EXAMPLE_MODE=lib node node_modules/vitest/vitest.mjs run --config vitest.snapshot.config.ts snapshots/session/headless.snapshot.ts -t domain-runtime-missing-reality
DSH_SNAPSHOT=replay DSH_EXAMPLE_MODE=lib node node_modules/vitest/vitest.mjs run --config vitest.snapshot.config.ts snapshots/session/headless.snapshot.ts -t domain-runtime-missing-reality
git diff --check
```

`--offline` 与 store 路径属于本次 cloud 环境；普通联网 checkout 使用仓库 `pnpm install`。built 测试之前必须按仓库 build命令准备发布产物；source tests 不以陈旧 lib 解析 workspace。

已确认但不修复的基线限制：

- 全仓 constraints 存在 upstream packages version 与 root downstream version 不一致；新三包没有此类错误。仅修复既有 downstream identity 与 constraints 的 private/public 归属不一致，精确匹配已登记 directory/sourceName/sourceIdentity/blocked policy，冒名/未登记/路径不符不能豁免
- gen-doc-graphs 因 12 个既有 service 的分类缺失失败；已登记新增两项，不修改旧业务分类
- gen-config-catalog 因既有 mcp-gateway 六个 Config 字段缺 JSDoc 失败；新 Config 字段完整
- 全仓 package invariant/export-JSDoc/README Model Experience 检查有旧包问题；本次新增三包的错误已单独修复。subsystem owner 检查剩既有 eval/image/task-queue 三处缺少 owner 页面链接/README；未修改这些无关组
- 真实 FC 登录、实时浏览器、真实报价、实际模型收费调用、purchase/fill/submit 未运行，也未以 fixture 结果冒称真实业务成功

recorded-session 使用专属 test-only composition：解除 storage-json 的既有 web-storage isolation，并禁用不相关的 session-projection-cache。此证据不表示未经修改的默认 headless 组合通过。成功 inspect → plan → status、精确 ref 与重启持久化由独立真实 Loader/tools 组合与 built 进程用例证明；该 Session 场景固定模型界面与缺失 Reality 拒绝路径。

初次完整 Host 检查发现本次测试 harness 的 ModuleLoader 断言类型错误，已修复后完整重跑通过；首次 snapshot 因未生成 Client 持有的 api-gateway 产物退出，完整 Client 构建后重跑通过。这些已解决问题未归类为未解决 baseline。完整 Web 产品构建、完整全仓测试/lint/doc-sync 与跨平台矩阵未全部运行，不声明全仓全绿。

## 15. 无真实外部副作用

真实 FC/browser external writes = 0，purchase = 0，fill = 0，submit = 0，market write = 0，Planning mutation = 0，Safety execution = 0。fixture 在具体禁止边界上使用调用计数与抛错 tripwire，built进程禁止network与MAIN-world访问；不是仅依赖自述。Git分支交付是本任务授权的代码交付，不属于 FC业务副作用。

## 16. Git 与补丁交付

目标分支 `dot/domain-runtime-plane`，精确补丁基线 `f961840fa51191dd4e70570df948fde94a830fd5`，是 Issue 指定代码基线之上的 Spec 提交。交付前 GitHub 再读确认目标分支仍在这个 commit。原始 Issue76 工作树和 Planning 分支均未修改。

命令行推送预检 `GIT_TERMINAL_PROMPT=0 git push --dry-run origin HEAD:refs/heads/dot/domain-runtime-plane` 返回 exit 128：`fatal: could not read Username for 'https://github.com': terminal prompts disabled`。GitHub 插件连接本身可读；本次没有把命令行失败冒称为插件失效，也没有再次重复此前不稳定的大文件上传。依据用户明确的 patch 回退策略停止远端代提交，交完整二进制兼容 Git patch、应用说明及本报告。

没有 implementation commit/PR/远端更新，没有 master merge，没有 Work/Codex 任务。最终 patch 基于暂存内容生成，包含全部新增文件；主任务用独立临时 Git index 从基线应用 patch，核对生成 tree 与交付暂存 tree 完全一致。最终 tree SHA 与 patch SHA-256 随交付说明提供，避免报告自包含哈希循环。
