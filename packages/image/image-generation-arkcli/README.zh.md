# @changanhua/dsh-image-generation-arkcli

[English](README.md) | 中文

通过 ArkCLI 实现 `ctx.imageGeneration` 的宿主 provider。准入阶段解析当前 Agent Plan profile、规范图片模型与受支持参数。生成阶段只消费这些持久化事实，调用 `arkcli +gen`，完整解码结果，并删除私有临时目录。

## 配置

`executable` 与 `argvPrefix` 选择 ArkCLI launcher。输出、图片字节/像素、宽高比、进程宽限期与静默等待字段限制宿主资源使用，非法配置会明确失败。

## 模型体验

间接通过图片生成 Queue handler 及其面向模型的准入工具产生影响。

#### KV Cache 影响

不直接失效；模型可见 schema 与结果由所属工具持有。

## 已知限制与延后工作

- 当前 profile 必须是包含兼容图片模型的 Agent Plan profile。
- 单次生成必须恰好产生一个 PNG 或 JPEG 文件。
- 重试分类只报告 provider 证据，不授权重试。
