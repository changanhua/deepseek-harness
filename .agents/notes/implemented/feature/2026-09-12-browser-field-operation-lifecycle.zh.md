# Agent Note: 浏览器现场操作生命周期

Status: implemented

[English](2026-09-12-browser-field-operation-lifecycle.md) | 中文

## 问题

浏览器工具暴露了独立读写，却缺少一次现场任务完整生命周期的持久权威。模型无法在不重放的前提下查询不确定请求，已规划的多个动作每步都要支付一次模型往返，页面结果面板也没有跨 Browser provider 和动态 Cordis Plugin 的共享所有权与清理契约，进程内任务状态还无法在 Host 重启后恢复。因此，仅仅存在工具不能保证恢复、页面定位、任务验收和撤收能组成可用流程。

## 决策

Browser service 负责显式请求身份、执行器能力声明、精确页面身份、动作传输和页面工作区 action。请求拥有调用方生成的 ID 与调用者作用域内的保留状态，读取该状态时不重放请求，也不暴露权限指纹。在线执行器在经认证握手中声明协议版本、已实现 action 种类和请求恢复。有界动作序列会独立准备并提交每个动作，保留上传路径策略，在结果到达时逐项记录，并在首个非 `observed` 结果处停止。页面工作区从 `page_map` 开始，其短时精确文档证据携带唯一 selector 和可占用/保护提示，然后进入扩展自有的 `region_render` 挂载，并可由 `region_clear` 恢复。

区域内容是有界的纯数据联合，并以文本节点渲染；链接仅接受 HTTP(S)。页面运行时拒绝含糊 selector，并把每个挂载绑定到 Session、安装、grant epoch 和页面身份。Replace 模式会移开所选区域的子节点，而不是销毁它们，Host 仅接受已映射、可占用且未受保护的区域。Host 在派发前预留共享区域容量，动态 Cordis runner 则拥有一次激活创建的所有区域，并在停止、更新、启动失败和 undefine 时尝试恢复。结果不确定的渲染或清理会留在待处理清理集合中，而不会被当作页面无效果的证明。`document_replaced` 记录消失资源；`target_url_stale` 不会。

`@changanhua/dsh-browser-task` 拥有 Session 持久的现场任务 projection。它分离不可变 evidence 与目标绑定、action attempt 与 receipt、页面资源 lease、capability 快照、委派事实和验收检查。其完成规则不接受单独的 observed action、委派 run 或渲染面板：每个条款都需要 checker 支持的当前 evidence，不能存在 blocker 或未解决 write，预算仍须可用，并且每个资源都要凭匹配回执已释放或确证消失。V1 拒绝 retained 资源；显式转交给 Session/用户属于延期能力。tool-browser loop 是该 projection 的无状态 continuation 与 checker facade；它绝不成为第二套任务权威。

五个模型工具为 `browser_request_status`、`browser_action_sequence`、`browser_page_map`、`browser_region_render` 和 `browser_region_clear`。动态 Plugin facade 通过 `harness.browser.pageMap`、`render` 和 `restore` 暴露同一页面工作区流程；它不会创建第二套页面协议。

## 考虑过的替代方案

**只增加面向模型的工具。** 这会让 schema 可见，但动态 Cordis Plugin 仍无法拥有并撤收同样的区域资源，而持久页内适配使用的正是这条运行路径。

**让一个区域 selector 命中所有匹配项。** 这会让短 selector 更方便，但会把单个目标侧边栏变成重复或破坏性挂载。`page_map` 返回唯一 selector，渲染则拒绝含糊性。

**把停止或超时当作清理成功。** 请求可能已经跨过扩展边界，但其回执后续丢失。因此，待处理清理会在不确定 outcome 后保留，并在后续清理被观察前阻止不安全的重新绑定。

**把页面区域状态持久化为产品数据。** 区域属于一个活文档和扩展运行时。持久存储会比它所识别的对象活得更久，也仍然无法在浏览器或 Host 丢失后恢复已替换的文档。因此，本决策保持资源的进程内属性，并显式声明这一限制。

## 结果

现场 agent 拥有一套持久的恢复、页面工作区和验收生命周期，而不是彼此无关的辅助调用。更少的模型往返不会绕过准备、授权、页面陈旧检查、上传来源或派发前计划的 receipt。动态 Plugin 拆卸会在恢复未解决时返回待清理身份。页面地图和区域状态仍有界保留在内存中：文档替换会清理页面侧挂载，而 Host 和扩展同时重启可能让所有 owner 都无法证明恢复，此时必须重新观察，而不能声称重试安全。执行器能力或目标变化会阻断普通 write，直到 Session projection 记录恢复决定。

## 验证

聚焦的 provider、页面运行时、工具、runner 和 browser-task 测试覆盖请求恢复、证据绑定的替换、容量预留、陈旧目标的资源处置、Session 回放、由 checker 支持的完成和 runner 清理。由 DeepSeek-v4.1-flash 驱动的代表性真实现场任务仍是明确的验收缺口；包和 fixture 检查不宣称模型行为已经通过。
