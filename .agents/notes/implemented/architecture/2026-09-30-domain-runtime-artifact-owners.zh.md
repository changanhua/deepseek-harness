# Agent Note: Domain-owned immutable Reality and Plan artifacts

Status: implemented

[English](2026-09-30-domain-runtime-artifact-owners.md) | 中文

## 问题

现有 FC 浏览器 helper 可观察库存与计算候选，但下游消费方缺少耐久、精确的引用来保留观察内容及结果仍不完整的程度。把所有领域载荷放入 Planning 或中央工件存储，会把持久化所有权从验证数据的领域转移出去。

## 决策

domain-runtime 家族分离按 provider 路由的元数据与读取、FC 所有的 Reality/Plan 持久化以及类型化工具消费。通用注册表理解身份、边界与 provider 生命周期，不理解 FC 字段。FC 通过自己的 Storage Domain 保存不可变工件与幂等回执；发布失败不暴露新工件。

## 算法所有权与证据

已有扩展 JavaScript 保持算法源码所有权。内部类型化桥接与包级打包复用纯模块，不产生第二份算法副本或运行时 app 路径依赖。readiness 观察事实与现有 approval-preview/execution-dry-run 编排分离共享。native chemistry 仍是实时页面服务操作，离线 Phase A 不调用；缺失评估保持 provisional。

库存与组覆盖互相独立。明确完整的库存遍历不能证明筛选后的 main-read 包含每个挑战。因此组覆盖保持 partial/unknown；Plan 派生关系保留精确 Reality digest，不静默刷新来源。

## 考虑过的替代方案

**由 Browser 或 Planning 拥有。** Browser 拥有传输与页面权限，Planning 拥有 canonical 意图状态。两者都不应成为跨领域载荷所有者；新的窄家族明确了这些依赖。

**中央工件载荷数据库。** 它需要理解所有领域 schema 与保留策略，而当前唯一适配器是 FC。provider 路由保留有用的共同身份合同，不转移载荷所有权。

**复制算法或调用完整 readiness 流程。** 复制 solver 会漂移；完整流程会把批准与执行概念带入只读/规划能力。源码打包与提取纯 readiness 事实在保留复用的同时缩小可达行为范围。

## 结果与代价

消费方获得稳定引用、分离读取、重启后可读的 FC 工件与明确的不完整结果，不需要通用工作流语言。它们必须提供观察、处理容量失败，并把所有 Phase A 方案视为候选而非批准。本实现不引入实时报价采集、FC 写入、Planning 修改、Safety 执行或全组完整性声明。

构建必须把扩展算法保留在发布的 Host 工件内，并让公开声明不包含 app 路径。所有者[测试](../../../../packages/domain-runtime/fc-sbc-domain/tests)覆盖包边界与持久行为；[注册表测试](../../../../packages/domain-runtime/domain-runtime/tests)拥有无关 provider 与生命周期回归。刻意不执行完整实时 FC 行为。

已有观察与源引用是调用方声明，不是已认证的 Browser receipt。所有者验证并保留接纳的内容；未来可信采集通道与 Safety 权限边界仍是独立工作。
