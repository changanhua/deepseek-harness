# Agent Note: Mint wire ids without a secure context

Status: implemented

English | [中文](2026-08-20-web-insecure-origin-randomuuid.md)

## Problem

`crypto.randomUUID` 是浏览器仅在安全上下文（HTTPS 或回环主机）中暴露的 Web API。通过普通 HTTP 在局域网地址（`http://<lan-ip>:3080`）打开 dsh Web GUI 不属于安全上下文，因此该全局对象是 `undefined`，每次调用都会抛出 `crypto.randomUUID is not a function`。

有三个浏览器可达的调用点依赖它：

- GUI 的 RPC 载体通过 `AbstractApiClient.mintRpcId()` 为每次 unary 调用铸造 rpcId，所以第一次 `host.describe` 握手就让页面崩溃。
- 编辑器的 `browserDraftAttachment()` 在附加图片时命中同一个调用。
- `dsh-llm` 的 `createMessage`（消息 id 生成）直接调用它，而 connection 的浏览器 bundle 通过 INLINE_SAFE wire 层内联了 llm 的消息模块；fixture 客户端在浏览器侧调用 `createUserMessage`，因此这条路径也会执行并抛错。

既有的非安全上下文测试（connection 的 `client-apply.client.spec.ts`）只覆盖了通用 `rpc.call` 通道，而该通道早已使用基于 `getRandomValues` 的铸造；整个 GUI 实际使用的 `AbstractApiClient` unary 路径从未被覆盖，一直处于损坏状态。

## Decision

浏览器侧的网络关联 id 不再依赖 `crypto.randomUUID`。apiproxy 的 api 层（零 Node 依赖、浏览器安全）持有 `randomUuid()`：基于 `crypto.getRandomValues` 的 RFC 4122 v4，任意来源（origin）都会暴露它。`AbstractApiClient.mintRpcId()` 通过它铸造；connection 包的 `random-uuid.ts` 再导出这一唯一实现（其 `rpc.call` 与 fixture 铸造早已使用它）；ui-conversation 的 `browserDraftAttachment()` 从 apiproxy api 层导入同一个辅助函数生成图片草稿 id。connection client 入口没有新增任何值导出。

`dsh-llm` 是叶子包（apiproxy 依赖它，因此它不能导入 apiproxy 的实现）；`dsh-brand` 刻意保持纯类型；新建 util 包对一个 14 行纯函数不成比例——所以 llm 的 `createMessage` 以模块私有辅助函数携带自己的、基于 `getRandomValues` 的 `randomUuid`。两个叶子包各自内联同一个无状态函数，符合 INLINE_SAFE 的哲学：无共享运行时身份的 wire 辅助函数可以自由内联。

新增的 apiproxy 载体测试把 `globalThis.crypto` 替换为"非安全上下文形态"（只有 getRandomValues，没有 randomUUID），并让一次 unary `session.list` 走 `mintRpcId`，断言调用成功且铸造出的 id 是 UUID v4。

## Testing

`fetch-carrier.spec.ts` 承载非安全上下文的 unary 测试。connection、ui-conversation 与 llm 测试套件保持全绿，包括 llm 的 `message.spec.ts` 身份断言。Node ≥22 的 `globalThis.crypto` 总是提供 `crypto.getRandomValues`，因此 host 侧行为不变。重建后的浏览器 bundle（通过正在运行的 GUI 来源验证）包含 `randomUuid`，且没有可调用的 `crypto.randomUUID()`。

## Alternatives considered

**给 `crypto.randomUUID` 加能力检查再回退。** 拒绝：同一个铸造存在两条代码路径，且回退仍然需要 `getRandomValues` 实现——检查只是多一个分支，并没有新增实现。

**把铸造移入 connection 包并导出。** 拒绝：apiproxy 不能依赖 client 包；api 层才是既有的浏览器安全共享家园（`RpcId`、`transportError` 已经住在那里）。此外还发现，client bundle purity 门禁禁止兄弟 UI 插件导入 connection client 的值导出。

**把 UUID 生成器放到 `dsh-brand` 或新建 util 包，让 llm 与 apiproxy 共享单点实现。** 拒绝：`dsh-brand` 明确是纯类型（"no runtime code"）；新建 util 包（aggregate、manifest、tsconfig 引用）对一个 14 行纯函数不成比例。两个无法互相依赖的叶子包改为各自内联同一个无状态函数。

**把 `getRandomValues` 实现复制到每个调用点作为一次性本地代码。** 对 apiproxy/connection/ui-conversation 集群拒绝——它们通过 api 层共享一个实现；只有 llm（唯一够不到该层的包）携带自己的副本。

## Consequences

dsh Web GUI 可以在普通 HTTP 局域网来源上工作，无需 HTTPS 或回环主机。RPC id、草稿附件 id 与消息 id 仍是 v4 UUID，因此按形状匹配的消费方不受影响。`randomUuid` 成为 apiproxy api 层（本就是已公开的浏览器安全通道）的公共导出；其它公共表面没有拓宽，llm 的副本保持模块私有。14 行函数的两个内联副本是叶子包边界的可接受代价；未来的共享 util 包可以收敛它们。
