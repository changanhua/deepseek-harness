# Agent Note: 浏览器现场操作生命周期

Status: implemented

[English](2026-09-12-browser-field-operation-lifecycle.md) | 中文

## 问题

浏览器工具暴露了独立读写，却缺少一次现场任务完整生命周期的持久权威。模型无法在不重放的前提下查询不确定请求，已规划的多个动作每步都要支付一次模型往返，页面结果面板也没有跨 Browser provider 和动态 Cordis Plugin 的共享所有权与清理契约，进程内任务状态还无法在 Host 重启后恢复。因此，仅仅存在工具不能保证恢复、页面定位、任务验收和撤收能组成可用流程。

## 决策

Browser service 负责显式请求身份、执行器能力声明、精确页面身份、动作传输和页面工作区 action。请求拥有调用方生成的 ID 与调用者作用域内的保留状态，读取该状态时不重放请求，也不暴露权限指纹。write 跨过扩展边界之前，BrowserTask 会记录带无 action 恢复定位符的 `dispatch-intent`，并 flush 所属 Session。Host 丢失请求内存后，只能用该定位符查询扩展 journal；缺失、身份不匹配、离线或过期记录均保持 `unknown`，绝不会导致再次执行 action。在线执行器在经认证握手中声明协议版本、已实现 action 种类、进程内请求恢复和可选的重启 journal 查询。

页面工作区从 `page_map` 开始。Host 将每个有界、精确文档区域转换为不透明、短时有效的 `regionRef`；模型工具、Session evidence 和动态 package 都不会收到其 CSS selector。`region_render` 接受由标题、摘要、条目、事实、链接和页脚文本组成的有界高层展示。provider 解析引用，把展示编译为页面运行时的纯数据 block，并仅在引用指向可占用且未受保护的区域时允许 replace 模式。链接仅接受 HTTP(S)，扩展以文本节点渲染内容。新地图、授权 epoch、文档、URL、Session、安装或过期都会让旧引用失效。

`@changanhua/dsh-browser-task` 拥有 Session 持久的现场任务 projection 和 Browser service 的公共操作生命周期。因此，普通工具、prepared commit、直接 Provider 调用和动态 Cordis 调用共享一个精确 Agent 与 Session owner、action 预算、evidence 历史、attempt 生命周期、恢复策略和资源责任。调用方本地校验会在其取得所有权或预留任务预算之前完成。prepared commit 与直接 Provider 执行采用精确 request id 生命周期：并发重复会加入原始工作或其保留的终态结果；相同 request id 搭配不同 action 则是冲突。provider 会在发送 write 前记录无 action 的 `dispatch-intent` 与恢复定位符；已发送或 unknown 的请求之后只按这个精确身份查询状态，绝不会再次执行。

确定性失败保留排除 request 与 mount id 的语义指纹。任务会在第一次失败后阻断未变化的 action，只有实质不同的目标，或之后的页面地图 evidence 证明失败前置条件已经改变，才恢复执行。已发送的 unknown write 只能 reconcile；内部 fold 不变量会让任务以内部 blocker 暂停，而不会变成模型可以重试的浏览器错误。prepared 记录会跨过期保留 in-flight 或终态归宿，因此过期不会在与 commit 竞争时产生第二次发送。直接操作的保留同样会保存 in-flight 与 unknown-sent 工作，而不会为了容量将其驱逐。

projection 还会分离不可变 evidence 与目标绑定、action receipt、页面资源 lease、capability 快照、规范 Subagent/Job/Cordis 身份和验收检查。委派输出只以有界摘要进入，绝不会单独算作验收。区域展示条款要求精确的 observed render 回执与之后命中其文本的新页面观察，随后完成还要等待该区域有回执支持的清理归宿。其他条款也必须拥有 checker 支持的当前 evidence，不能留下 blocker 或未解决 write，预算始终有界。V1 拒绝 retained 资源；显式转交给 Session/用户属于延期能力。tool-browser loop 是该 projection 的无状态 continuation 与 checker facade；它绝不成为第二套任务权威。

动态 Cordis runner 会在定义时捕获精确 live Agent，并在该 initiator scope 内执行每项 Browser 调用和清理。Plugin 版本不能重置任务预算或恢复历史。本地 mount 与 render 校验会在 runner 记录资源所有权之前完成。Agent scope teardown 会在该 Agent 仍存活时执行，因此停止、更新、启动失败、undefine 和 owner disposal 都使用同一资源结算路径。更强的 `forgetCollected` finalizer 在此前普通 release 已结算时仍是独立的清理意图，不能被较弱的清理静默满足。若 owner BrowserTask 已经终态，只有 runner 先前为该精确 owner 登记过的 cleanup 才转交给 runner cleanup ledger。runner 随后按原始请求身份 reconcile，不会重新打开终态任务；任意 Plugin 工作都不能走这条脱离 owner 的路径。facade 暴露 `harness.browser.pageMap`、`render` 和 `restore`；它不会创建第二套页面协议，也不接受调用方提供的 Session 身份。

## 考虑过的替代方案

**只增加面向模型的工具。** 这会让 schema 可见，但动态 Cordis Plugin 仍无法拥有并撤收同样的区域资源，而持久页内适配使用的正是这条运行路径。

**向模型暴露唯一 selector 和底层 block。** 唯一性可以阻止含糊 DOM write，但仍让概率调用方计算地址并实现渲染协议。不透明引用和高层展示保留同样的页面运行时能力，同时从模型可见输入中删除这两类错误。

**把停止或超时当作清理成功。** 请求可能已经跨过扩展边界，但其回执后续丢失。因此，待处理清理会在不确定 outcome 后保留，并在后续清理被观察前阻止不安全的重新绑定。

**把页面区域状态持久化为产品数据。** 区域属于一个活文档和扩展运行时。持久存储会比它所识别的对象活得更久，也仍然无法在浏览器或 Host 丢失后恢复已替换的文档。因此，本决策保持资源的进程内属性，并显式声明这一限制。

**让每个工具或动态 package 自行实现恢复。** 这会让直接 Provider 调用、prepared commit 和生成工具在预算、派发耐久性、unknown 效果与清理方面产生分歧。公共 Browser 生命周期把策略留在 BrowserTask，同时让调用方自由选择或创造另一种安全方法。

## 结果

现场 agent 拥有一套持久的恢复、页面工作区和验收生命周期，而不是彼此无关的辅助调用。它可以在获得新 evidence 后选择其他已映射区域、展示策略或临时 Plugin 实现，却不能编造权限、执行事实或成功 evidence。更少的模型往返不会绕过本地校验、准备、授权、页面陈旧检查、上传来源、预算或派发持久化。动态 Plugin 拆卸会在恢复未解决时返回待清理身份；终态任务既不会让已经登记的 cleanup 遗留，也不会把脱离 owner 的执行权限授予其他 Plugin action。

页面地图、不透明引用和区域状态仍有界保留在内存中。Host 重启可以恢复扩展保留的 receipt，却不能复活旧 region reference；它必须重新映射 live 页面。journal 过期、扩展存储丢失或执行器不可用都会让 write 保持 unknown。文档替换会清理页面侧挂载，而 Host 与扩展同时丢失可能让所有 owner 都无法证明恢复，此时需要 owner 可见的 reconcile，不能声称重试安全。

## 验证

聚焦的 provider、页面运行时、工具、runner 和 browser-task 测试覆盖请求恢复、证据绑定的替换、容量预留、陈旧目标的资源处置、Session 回放、由 checker 支持的完成和 runner 清理。master 提交 `533338f8b6` 上的真实 Session `session-76cd8e9e-b3ff-4831-8c9d-675d18630f3e` 使用 `deepseek-official/deepseek-flash`（目录名称 `DeepSeek-V41-Flash`）在获授权的知乎页面渲染并验证 mount 范围的标记，清理精确资源，并让 BrowserTask `browser-task-a3aabe2d-8ce9-4e7c-92dc-32ec5e749f28` 以 completed 且无 blocker 的状态结束。独立 JSONL 验证记录了 seq 62 的渲染 receipt、seq 77 的展示检查、seq 98 的清理 receipt、seq 123 的清理后检查和 seq 125 的终态，且不存在 unknown 写动作或遗留资源。

### 2026-09-16 现场验收记录

聚焦可靠性测试覆盖所有权前的本地校验、精确 ID 的仅状态恢复、更强 finalizer、终态任务的清理转交、prepared 与直接调用的 exactly-once 行为、发送前派发持久化、确定性失败的 evidence 恢复，以及 Dynamic Cordis 的共享责任。两站点的真实模型运行、独立审查与五层 evidence 仅会在冻结 Session 和 controller 产物存在后记录在此；本记录不把聚焦测试当作现场验收。
