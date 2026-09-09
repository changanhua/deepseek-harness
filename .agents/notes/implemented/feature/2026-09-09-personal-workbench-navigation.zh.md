# Agent Note: 个人工作台导航

Status: implemented

[English](2026-09-09-personal-workbench-navigation.md) | 中文

## Problem

以对话为中心的首页要求用户逐个重新打开会话，才能找到正在运行的工作、未读结果和待处理决定。工作台还需要可直接使用的输入组件，以替换外观像输入框的导航按钮。

## Decision

[Workspace UI](../../../../packages/client/ui-workspace/README.zh.md) 拥有基于现有 Session 列表、Workspace 成员关系和待交互来源的工作台投影。主要导航和主内容共享视图状态；领域状态仍由现有控制器持有。工作行打开已有对话。总览和项目页通过 `conversation.home` 接收原有 Conversation 输入组件，并通过正常的新会话流程准备可复用的空白 Session。可用工具卡片随模块注册表的注册生命周期变化。

[侧栏](../../../../packages/client/ui-sidebar/README.zh.md) 提供附加的主要导航席位。[布局](../../../../packages/client/ui-layout/README.zh.md) 在原有切换动作之外提供幂等模块激活。工作台显示时，隐藏的对话保留草稿和已挂载的详情。

## Alternatives considered

**为首页另建任务数据库。** 否决，因为重复的执行和审批状态可能与拥有操作的领域产生分歧。

**让社区工作台充当应用根界面。** 已接受的本地原型决定导航方式。社区分屏仍可作为设计参考，但其会话绑定和布局归属不能确立本应用的项目与执行语义。

**把所有结束的运行当作已接受结果。** 否决，因为未读完成提醒不能证明独立验证通过或人工接受。

## Consequences

工作台不增加后台模型调用、审批权限或执行调度器。它只能呈现现有控制器发布的事实；Queue 和 Delivery 保留各自的详情页面及修改规则。总览不提供独立文档存储，也不替换对话的结果和轨迹渲染器。

聚焦测试覆盖项目归属、归档和子代理筛选、待交互及未读状态、模块注册变化和导航重新挂载。浏览器验收通过正式 Web 组合使用录制的 Session。
