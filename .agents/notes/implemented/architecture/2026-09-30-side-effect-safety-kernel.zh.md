# Agent Note: 持久副作用准入

Status: implemented

[English](2026-09-30-side-effect-safety-kernel.md) | 中文

## 问题

计划获批和传输请求成功都不能证明某个具体外部效果已获授权或已经完成。重启必须保留不确定性，不能重复结果未知的动作。

## 决策

[guard 包](../../../../packages/guard/side-effect-safety/README.zh.md) 合并一个 Host service 与一个 Storage Domain consumer。现有 guard 包保持不变。生命周期绑定的 adapter 拥有人类身份、领域范围和证据验证权威；只有其私有 sender 跨越 synthetic 执行边界。没有模型工具或 Remote mutator 导出该能力。

一个有界 global 文档让意图、业务租约、预算消耗和动作阶段在单一 Host writer 下原子提交。串行 CAS 防止该 writer 内部竞争。部署不得让存活的 Host 共享 JSON storage；需要保护共享根目录时，可选择既有 SQLite exclusive ownership。业务租约不替代存储 writer 排他。

SENT 在调用 sender 前记录可能执行。UNKNOWN 永远不能重新变成可执行。重启使进程能力和业务租约失效，保留所有已有 action identity，并要求只读证据对账。幂等重试返回当前账本事实，而冲突内容持久阻断新工作。预算累计尝试风险、不退款，一份审批不能资助多个 execution。

Dynamic Cordis 不拥有原始 Storage、Storage Domain 或 backend 能力。runner 拒绝已注册别名，防止反射返回原始服务对象，并使领域变更事件快照脱离权威对象。静态 Host 消费者保留存储访问；动态包保留业务服务 API 与 package 私有 harness state。这是显式能力边界，不表示 node:vm 能隔离恶意代码。

## 考虑过的替代方案

第二个通用 provider 包会增加未使用的替换边界：Storage Domain 已拥有存储媒介抽象。重写 BrowserTask journal 或迁移 Delivery 会改变通用准入切片以外的独立 owner。把 allowed-once 当作持久权威会混淆交互结果与有界业务授权。持久保存领域 payload 会使意外恢复重放成为可能，也会复制 adapter 拥有的数据。

## 后果

原子快照简化崩溃推理，但要求严格的保留记录数和字节限制。耗尽时停止工作，不驱逐未决动作。可信 Host adapter 仍拥有真实人类确认和读回真实性。synthetic Loader 和进程丢失测试证明内核行为，不证明任何生产浏览器集成或领域 adapter。保守预算可能比实际资源用量更早停止。终态写入失败会保持不确定，而不会宣称尚未提交的成功。
