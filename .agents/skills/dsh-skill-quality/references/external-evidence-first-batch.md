# 首批 DSH Skill 外部证据审查

日期：2026-09-29。对象：`dsh-change-verification`、`dsh-code-review`、`dsh-feature-delivery`、`dsh-reuse`。这是一份外部证据迁移审查，不是这些本地 Skill 的实测成绩。

## 可直接利用的公开结果

- [SWE-Skills-Bench](https://arxiv.org/html/2603.15401v1) 在固定仓库和确定性验收下评测 49 个软件工程 Skill、约 565 个任务。39/49 的通过率增益为零，平均提升 1.2 个百分点，同时平均 token 增加 10.5%；三个 Skill 出现最高 10 个百分点的负增益，作者将部分失败归因于版本约定和目标项目冲突。专门程序知识有少数明显收益，最高 30 个百分点。
- [SkillsBench 1.1](https://www.skillsbench.ai/blogs/skillsbench-1-1) 的公开汇总显示：2–3 个 Skill 的增益为 19.0 个百分点，4 个以上降为 10.1；中等长度 Skill 增益 21.5，综合型 Skill 只有 0.7。该结果跨领域聚合，不能直接预测 DSH，但足以反对默认加载长链条。
- [Counterfactual Trace Auditing](https://arxiv.org/html/2605.11946v2) 在 49 个软件工程任务上发现，通过率平均只变化 0.3 个百分点，却识别出 522 个行为影响，包括有益的步骤补全和边界提醒，也包括重复探索、表面照抄、概念外溢及无关文件。它支持检查执行记录中的具体副作用，不能作为本地因果证明。
- [Tessl code-review](https://tessl.io/registry/tessl/code-review/evals) 公布 19 个场景、1.10× 聚合效果，但当前公开页不展示场景级数据。它支持“审查可通过分工明确的关注面获得增益”的弱结论，不能证明 DSH 审查规则有效。
- [Tessl systematic-debugging](https://tessl.io/registry/skills/github/secondsky/claude-skills/systematic-debugging/evals) 的一个可见版本使用 Claude Sonnet 4.6 测了三个场景。大多数根因与修复指标在无 Skill 时已是 100%，明确的新增差异主要是检查近期改动。它说明应保留能补足具体遗漏的条款，不能用完整流程本身证明收益。

## 本批结论与已执行修改

| DSH Skill | 外部证据可支持的判断 | 已执行修改 | 证据边界 |
| --- | --- | --- | --- |
| `dsh-feature-delivery` | 默认串联多个 Skill、强制记录学习运行和大量交付产物存在明显冗余风险 | 不再默认启动 mode learning；Charter、reuse、Issue DAG 按未决问题选择；收据仅用于真实多阶段交接；任何代理委派都要求用户明确授权 | 没有公开基准直接评测 DSH 交付 Skill，当前结论是基于聚合结果与本次已发生的过度流程问题 |
| `dsh-change-verification` | 验证 Skill 只有在补足基线遗漏时才有价值；综合型默认上下文容易制造流程负担 | 删除对另一个通用验证 Skill 的默认依赖；把罕见的自托管四身份协议移到按需参考；保留 DSH 的源码、生成物、装配、运行和行为分层 | 公开结果未测试 Cordis／Profile 分层，本地专属价值仍未实测 |
| `dsh-code-review` | 外部审查 Skill 有弱正面聚合信号，但缺少公开明细；关注面需要按改动选择 | 明确只处理真实 PR；只加载受影响契约；文案和测试可靠性专门 Skill 改为按相关性读取；避免为了清单覆盖制造问题 | 不能把 Tessl 的 1.10× 转移为本 Skill 的成绩 |
| `dsh-reuse` | 专门程序知识可能有效，泛化长流程经常无增益；项目版本冲突会造成负收益 | 保留本地能力、装配和生命周期证据；机械修改直接跳过；社区搜索仅在本地缺口明确时进行；非目标只能记录用户已确认内容 | 没有可直接对应“复用架构决策”的公开任务集，结论仍是风险约束而非效果证明 |

## 当前判定

- `dsh-feature-delivery`：缩小适用范围并删减强制流程；原版净收益没有外部支持。
- `dsh-change-verification`：保留 DSH 专属分层，降低默认负担；效果证据不足。
- `dsh-code-review`：保留 PR 专用定位和实证缺陷要求；效果证据不足。
- `dsh-reuse`：保留本地优先、生命周期与装配辨别；效果证据不足。

公开证据没有替这些本地 Skill 生成分数。它实际支持的是删掉未经证明的通用流程、避免多 Skill 链条、保护当前项目契约，并优先保留 DSH 独有的程序知识。
