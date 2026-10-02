---
description: "通过可信 Host 投影展示可选的需求投资评估 UI。"
kind: "package-reference"
---

# @changanhua/dsh-client-ui-requirement-assessment

[English](README.md) | 中文

## Summary

可选客户端插件提供手工评估页面，以及 Planning subject slot 中的只读入口。Host 拥有评估持久化、模型调用和授权。

## Configuration

通过 [personal-planning](../../bundle/personal-planning/README.zh.md) 的可选 investment-review patch 装配。依赖 Planning 客户端、评估 Remote、locale、renderer 与导航 owner，不改变默认 profile。

## Behavior

从 Plan / Focus 入口创建评估，或在手工页面选择项目。只有显式点击才会启动 Quick Review。历史保留不可变评估及固定输入；刷新只读取当前 drift，不启动模型调用。重新评估产生关联的新评估。关闭面板或切换对象会取消在途请求并忽略迟到响应。

产品文案由 locale 拥有，模型输出与代码枚举原样显示。界面展示建议性质的 allocation 与 route，不显示总分或执行批准。

## Model Experience

### Explicit review requests

#### What the model sees

无直接模型上下文；只有 Host 的 `ctx.requirementAssessmentReview` runner 构造模型请求。

#### Token effect

读取或刷新评估不消耗模型 Token。显式评估使用 Host 配置的模型；取消后重试可能产生另一次调用。

#### KV Cache effect

不注册 prompt，不在后台自动调用模型。

## Known Limitations and Deferred Work

- Manual 对象没有可比较的实时 canonical revision，因此显示 unknown drift。不轮询或自动重跑。真实模型质量验收需要规格中的三个案例，不能用 UI fixture 测试替代。不发布 invariant companion：UI 不拥有独立的持久关系，其生命周期与投影行为通过组件及注册测试验证。
