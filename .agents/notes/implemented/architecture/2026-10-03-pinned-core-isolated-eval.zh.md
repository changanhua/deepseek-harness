# Agent Note: 使用 Host 锁定可信核心的隔离 Eval

Status: implemented

[English](2026-10-03-pinned-core-isolated-eval.md) | 中文

## Problem

Agent 对工具、技能或执行成功的描述不能证明实际运行内容。不同进程 id 和目录也不能阻止同账户代码读取 Grader 私有材料或修改执行证据。评估需要认证观测和操作系统强制隔离，同时避免重复 Plan 准入、Queue、Git 租约、Budget 或 Agent loop。

## Decision

可信计算基础包括 Host、其锁定的 Harness 核心及已批准插件，以及 Windows。Agent 文本、技能指令和仓库任务代码均不可信。Host 选择并摘要每个角色的完整物理核心产物，复制到角色独立的只读镜像，在复用前和执行后验证。任务仓库是数据，不隐式作为核心实现加载。该边界允许采用核心注册表观测，但不认证任意恶意 Harness 改动。

每个 Subject 或 Grader 通过既有 `dsh` Profile launcher，在无网络能力的全新 AppContainer 下运行。核心 Job 只允许一个进程。已批准工具把任务代码交给 Host 持有的 Job，使用不同 AppContainer SID、明确工作区 ACL 和有界输出。进程和线程 ACL 拒绝该任务身份访问核心内存和句柄。角色私有 home、Session 和 Grader 状态绝不共享；Host 只向 Grader 授予结果副本的只读权限。核心路径适配器转换真实 Windows 卷映射，不编造文件系统身份。

每次执行的密钥通过私有继承句柄进入可信核心；Agent 接收输入前清空载体。绑定方向的签名和单调序列认证请求及响应帧。Agent 指令无法访问密钥，也不能在该进程内执行代码。Host 只通过此通道接受注册表快照，独立观测镜像、配置、进程和租约身份，并在现有 Budget guard 预留资源或发出请求前校验实际最终模型派发事实。批准的期望值仅用于比较，绝不作为观测的兜底值。

执行 owner 消费原始 Plan resolution 和 admission，匹配真实活动 Queue Attempt，并使用其 RepoWorkspace 租约。Subject 和 Grader 共享 cell 的仓库来源，但拥有独立执行身份和可写世界。Manifest 引用指向带有内容摘要的保留材料。每次模型派发保留现有 Budget owner 的 request、attempt、decision 和 usage 回执。尚无模型身份就被拒绝的执行只有证据，不编造 Manifest。

取消先请求 Agent 停止和 Session 刷新，再进入有限的强制停止期限。Host 在清理前等待协议、broker 和整个 Job 完成。证据交接要求精确摘要确认；缺少确认、usage 未知或进程静止不确定时保留托管责任，并进入 Queue unknown Attention。确认静止后关闭原生资源；被引用文件保留到交接完成。清理捕获目录身份，只解除目录联接而不跟随。Windows Session write-through 从已有祖先目录解析，避免受限角色必须探测卷根。

## Alternatives considered

**信任 Agent JSON 或期望能力列表。** 拒绝，因为二者都可能描述从未执行的组合。锁定核心读取真实 scope 注册表，Host 保留差异，不替换成期望值。

**让任务代码在核心内执行或继承核心身份。** 拒绝，因为它将获得核心的签名内存和私有状态。同一个无限制账户下的进程边界不够；不同 AppContainer 身份与 Job、进程 ACL 才落实边界。

**认证任意修改后的 Harness 实现。** 此信任模型不提供该能力。它需要另外受信任的执行及观测 runtime，以及独立 verifier。锁定批准核心是明确限制，不能证明恶意核心代码安全。

**创建 Eval 调度器、预算账本或持久证据库。** 拒绝，因为这些 owner 已存在，或属于下游 run 控制及保留工作。本库负责单次执行和交接，不负责 GateDecision 或自动续跑。

## Consequences

[包契约](../../../../packages/eval/eval-isolated/README.zh.md) 要求 Windows x64、明确核心镜像、同卷工作区和已批准的任务桥接插件。可写世界有采样增长限制及正常/强制取消，但没有文件系统配额，也不能保证单个采样间隔内的超量上界。能力缺失或 OS 隔离失败直接拒绝，没有进程内兜底。核心升级需要重新批准和锁定。无密钥组合测试证明执行机制，不证明当前 Provider 质量或独立自开发认证。

必要证据包括真实 Profile 启动、跨角色 canary 读写拒绝、任务对核心进程及线程的访问拒绝、核心子进程创建禁止、认证重放和篡改拒绝、实际能力不匹配、Budget 拒绝时零 HTTP、正常 Session 刷新、完整 Job 静止和交接失败后保留。构建产物测试必须消费打包的 worker/preloader，而非 TypeScript emit 文件。[Producer 与 Budget 决策](2026-10-02-trusted-eval-producers-and-resource-budgets.zh.md) 仍有效，因为准入、账本和租约归属未变；本记录补充执行信任边界。
