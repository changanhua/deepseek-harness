---
description: "浏览器扩展授权与网页材料持久导入 Content。"
kind: "package-reference"
---

# @changanhua/dsh-content-browser

[English](README.md) | 中文

## 概要

把 Chromium 扩展连接到 DSH 服务，在已登录 Web 应用中批准内容导入，并把网页材料保存到既有内容库。这个 Host 桥拥有连接授权；Content 拥有保存条目与重试回执。

## 目录

- [使用本包](#use-this-package)
- [授权与恢复](#authority-and-recovery)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用本包

与 `webServer`、`connection`、`credentials` 和 `content` 一起挂载默认服务。Web Bundle 已包含本包。生成的 `./remote` 提供 `contentBrowser` 批准与撤销操作；加载的 [Chrome 扩展](../../../apps/chrome-extension/README.zh.md) 使用 `/api/content-browser/v1/info`、`/connect`、`/connect/<requestId>/token` 和 `/import`。

`requestTTL` 默认 300000 毫秒，`pendingLimit` 默认 32，`maxRequestBodyBytes` 默认 1048576。组合方可以收紧这些限制。待批准连接在内存中过期；已批准授权由凭据 Provider 持久保存，直到撤销或被同一安装的新授权替换。

`BrowserConnectRequest` 暴露请求及安装身份、扩展 ID、到期时间和批准状态。`BrowserGrantSummary` 暴露安装及扩展身份、创建时间和 `content:import` 权限。两个投影都不包含令牌材料。

<a id="authority-and-recovery"></a>

## 授权与恢复

扩展保留随机 verifier 并发送其 SHA-256 challenge。已登录用户显式批准请求；打开链接不会授权。令牌兑换证明持有原 verifier。Host 只在严格版本化、owner 私有的凭据记录中保存令牌哈希。Bearer 令牌仅通过兑换路由返回给匹配的扩展 Origin，并且只能导入内容。

Connection 提供已配置的 Host authority 检查；桥另行要求精确扩展 Origin 与操作凭据。普通 `/api` 的 Cookie 和跨站检查保持不变。无效记录会被拒绝。授权更新、撤销、请求中止和插件卸载会在 Content 提交之前使已进入通道的导入失效。响应丢失或授权撤销不删除已提交内容。

导入把 UUID 采集身份映射为 `web:<captureId>`，并使用相同 operation ID。完整的未验证网页来源与正文通过 `save-text` 一起提交。重试相同请求返回持久回执；同一身份下修改内容会冲突。撤销或请求到期后停止重新交付令牌。

<a id="model-experience"></a>

## 模型体验

无，因为本桥不注册模型工具或模型上下文，也不发起模型请求。

#### KV Cache 影响

无；连接和导入操作不进入模型上下文。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与后续工作

- 服务 URL 使用 HTTP(S) origin 根路径；当前 DSH 路由不支持部署路径前缀。远程部署需要另行配置可信 authority 和传输安全。
- 网站结构与提取由扩展负责。网页来源信息未经验证；Host 不访问来源 URL。
- 待批准握手不跨 Host 重启保存。既有授权与内容使用各自 Provider 的持久化；重启后的握手需要新请求。

<a id="dev-note"></a>

## 开发备注

无。
