# Session Review V0：手动会话复盘

[English](README.md)

**实现候选，尚未通过运行时验收。** 基于个人仓库
`master@eb00de8d41df7e4bb1ea89b62882efed63945f90`。
这是放在仓库内的外置 Cordis 插件，通过原生 Web workspace 与独立分析预设接入，
不是第二个应用入口。不改核心循环、默认 Profile、生成 Remote、根锁文件或正式个人包登记。

## 做了什么

选择普通会话 → 选择已配置模型与诊断/反证视角 → 指定包含两端的事件范围 →
确认发送历史文本 → 新会话完成只读复盘 → 展开原始证据或返回源会话。
报告区分观察、原因假设、下一步实验；不会自动改变代码、Memory、Skill、Issue 或原会话。

首版使用固定受限预设中的 DSH Agent，可选 provider/model；**不是任意 Agent 选择器**，
也没有外部 Codex/Claude CLI 执行适配器。未加入自动会话结束触发或全量知识沉淀。

## 显式安装，先隔离验证

本环境没有执行安装、真实 Loader 启动、Windows 或浏览器验收。先完成
[验证清单](VALIDATION.md)，不要直接用于不可替代的 Home。

从已构建的目标 checkout，通过现有 CLI 管理目标 Web Profile 的插件：

```text
dsh plugin --profile <现有WebProfile名称> add "file:/绝对路径/checkout/downstream/plugins/session-review"
```

仓库开发入口可用 `pnpm dsh` 转发同一组参数。必须使用绝对路径，避免相对路径在
Profile 目录中解析。包标记为 private，不发布 npm。

在目标 Profile 的 `cordis.patch.yml` 追加 UI Host 标记：

```yaml
- insert:
    - id: personal-session-review
      name: '@changanhua/dsh-session-review'
```

再把本插件的 `presets` 绝对路径加入 `agent-presets` 的可信 roots。
先读取 `dsh --profile <名称> --dump-config`：修改 roots 时要保留原 default、
已有 roots 及 derived-root 开关，因为 patch 会替换整份 config，而不是合并一个成员。
本实现不自动覆写你的 Profile。预设从当前基线的 `web-host` realm 消费
`sessionController`；其他 realm 的部署需要重新核对组合。

重启 Host 并刷新 Web，从“更多 → 会话复盘”进入。证据摘要核验需要 Web Crypto，
使用 localhost 或 HTTPS。加载插件、查看目录、选择会话、读取历史、刷新结果均不触发分析。

分析会话存在期间保持安装路径和预设可用。停用前先停止活动分析，再移除 UI row/预设 root；
不会删除既有 Session 或证据。移除预设会阻止其会话正常恢复。复制插件不等于备份会话。

## 实现分工

| 文件 | 职责 |
| --- | --- |
| `client.mjs` | 原生工作区、模型选择、发送确认、证据展开与会话导航 |
| `controller.mjs` | 复用既有 Session RPC；显式恢复同一次提交 |
| `policy.mjs` | 预设内工具拒绝、来源检查、输入冻结和单次请求路由 |
| `contract.mjs` | 严格参数、日志投影、整体字节上限、摘要及引用核验 |
| `presets/` | 完整 persona，关闭 runtime context；不装载工具插件 |
| `tests/` | 无依赖契约测试，Host/Remote 为显式测试替身 |

只由 Session 保存长期结果：首条入模消息携带来源身份、范围、证据、指令和摘要，
普通 assistant/turn 事件保存结果。源会话使用公开 inspect 读取，不为复盘唤醒或写入源 Agent。
ID 前缀只帮助发现关联，真正关联必须通过已记录快照核验。不新建 Review 数据库、Queue、
调度器或 Remote。

客户端先保存绑定 Host 的小型提交记录，才创建分析会话。双击共享在途操作。
响应不明确时先查看原始分析会话，再显式恢复同一 Session/RPC ID 和完全相同的请求；
幂等由原 Host 负责。已准入提交只读取，不自动再次发送。不承诺 Host 崩溃后的供应商账单
exactly-once。清除本地记录不等于取消或删除远端任务。

只允许首个 turn/step；`tools.guard` 拒绝分析 Agent 的工具执行，不仅是提示词提醒。
路由只作用于该请求，不改变全局默认模型；发送前固定人工标题，以避开自动标题模型路径。
原生聊天输入框仍可能显示，后续普通消息会被策略拒绝。工具护栏不是针对可信同进程插件的
操作系统沙箱。

## 限制与费用边界

输出是历史投影，不是完整日志。保留直接用户文本、助手可见文本、工具参数/结果、边界及
已有 usage；省略 system prompt、request header、注入背景、推理、原始流、provider replay、
附件块和工具私有 meta。省略会显示，也意味着不能声称根因分析掌握了全部上下文。
正文和工具参数仍可能包含秘密，**没有 DLP 或语义脱敏保证**，发送前需明确确认。
不借用 `/feedback` 分享入口。

来源必须是相同规范化 cwd 的普通会话；拒绝子代理来源和跨 worktree。
面向可信单操作者 Host，不是新增多租户权限系统。公开 inspect 可能先装载整段历史；
入模字节上限不代表源文件 IO 或内存峰值同样有界。

首版限制：300 个源事件、128 KiB 完整改写输入、4,096 请求输出 Token、180 秒协作取消。
这是暂定产品边界，不是实测最优值或货币预算授权。超限拒绝并显示边界，需缩小范围；
不静默截断。固定 persona、请求封装、适配器内部重试等不由此充当统一费用账本。
没有额外逻辑重试环，但底层 adapter 的内部重试仍由原实现管理。

模型输出须为规定 JSON，引用必须对应现存证据。格式无效、取消/失败、缺少快照、
窗口不完整或摘要不符时，不显示为合格结构化报告；可打开原始分析会话排查。
摘要能检测导出内容变化，不是签名，也不证明观点真实。假设不自动升级为 verified。

没有额外整理模型调用；每次显式复盘形成独立请求前缀，不改原会话前缀。
首版 UI 为中文；结果手动刷新，实时内容沿用原生聊天。全文检索、图形范围选择、
跨标签页提交协调和外部 Agent 执行暂缓。完整端到端可用性仍待验证。
