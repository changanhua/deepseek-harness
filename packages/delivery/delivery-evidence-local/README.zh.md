---
description: "为 Personal Delivery 提供本地不可变、content-addressed evidence 发布与完整性校验字节读取。"
kind: "package-reference"
---

# @changanhua/dsh-delivery-evidence-local

[English](README.md) | 中文

## 概述

`dsh-delivery-evidence-local` 让 runner 与 verifier 把有界代码交付 evidence 发布为不可变本地字节。它根据 kind、media type、provenance、byte length 与 SHA-256 派生稳定 evidence id；提供方重建后，相同 envelope 仍会收敛到同一个 reference。`save()` 只在原子发布后返回，`resolve()` 与 `read()` 会拒绝被更改的 metadata、length、digest 与 link-shaped storage path。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [继续探索](#further-exploration)
- [Model Experience](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

当 Personal Delivery evidence 必须保留在单个宿主，且 Queue record 应只保留 reference 而不是 byte payload 时，挂载此提供方。

### 何时选择

当有界 log、Git metadata、patch、checkpoint metadata、verification output、screenshot 与 Resume Capsule 存放在私有本地文件系统时，选择此提供方。把 writer 交给 runner 或 verifier 前，先通过 `ctx.deliveryEvidence.bind()` 绑定 provenance；调用方无法通过绑定后的 writer 替换该 provenance。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `root` | 必填 | 包含 content-addressed byte object 与不可变 reference 的私有目录。 |
| `maxBytes` | `64 MiB` | 正数完整 payload 发布上限；配置不得超过 P0 的 `64 MiB` ceiling。 |

生成的[配置目录](../../../docs/config-catalog.zh.md#changanhuadsh-delivery-evidence-local)是完整字段参考。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

提供方会在异步工作前复制调用方字节与 provenance。它把每个 object 或 reference 写入私有 exclusive temporary file 并同步文件。POSIX 发布使用不覆盖 hard link 与 parent-directory sync；Windows 使用不替换的 write-through namespace move。并发 observer 在返回既有 object 或 reference 前会重复 file 与 namespace durability barrier。Byte object 使用其 SHA-256 URI，reference id 则寻址完整 semantic envelope。读取会重新证明物理 root 与每一级 ancestor、拒绝 link-shaped path、在分配前执行配置的 object 上限与 `64 KiB` metadata 上限，并通过有界 open handle 验证 file identity、精确 length 与 SHA-256。每个返回的 byte array 和 metadata object 都与存储状态分离。

</details>

-----

<a id="further-exploration"></a>
## 继续探索

- [Delivery evidence Service Definition](../delivery-evidence/README.zh.md) — 发布、绑定、resolve 与 read 约定。
- [Personal Delivery 子系统](../../../docs/subsystems/delivery.zh.md) — 包拓扑与 authority ownership。
- [Personal Delivery Protocol V1](../../../docs/specs/2026-08-29-delivery-protocol-v1.md) — evidence kind、digest 与 provenance 语义。

-----

<a id="model-experience"></a>
## Model Experience

### 无直接模型上下文

#### 模型看到什么

模型不会直接看到任何内容。`ctx.deliveryEvidence` 会把 evidence bytes 保留为宿主 artifact，除非另一个调用方明确选择并渲染它们。

#### Token effect

直接 token 为零。

#### KV Cache effect

无；此包从不组装模型输入。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **没有自动 retention 或 garbage collection** — 在 operator 管理配置 root 前，reference 可能比 Packet 与 Attempt 存活更久。
- **需要本地文件系统发布 primitive** — 无法创建私有 exclusive file 与 hard link 的文件系统会让发布以 `write-failed` 失败。

<a id="dev-note"></a>
### 开发说明

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
