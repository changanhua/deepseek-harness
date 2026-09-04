# @changanhua/dsh-image-generation

[English](README.md) | 中文

`ctx.imageGeneration` 的共享 Service Definition。Provider 注册稳定 id；Consumer 先调用 `resolve()` 持久化 provider 事实，再用 resolved spec 与提示词调用 `generate()`。

## 扩展点

`registerProvider()` 将 provider 注册绑定到贡献它的 Cordis fiber。只有注册了唯一 provider 时才能自动选择；否则调用方必须显式选择 provider。

## 模型体验

间接通过拥有模型工具与结果渲染的图片生成 Consumer 产生影响。

#### KV Cache 影响

不直接失效；所有模型可见 schema 与结果均由 Consumer 持有。

## 已知限制与延后工作

- 服务协调 provider，但不持久化请求或生成的字节。
- Provider 选择没有优先级或回退链。
