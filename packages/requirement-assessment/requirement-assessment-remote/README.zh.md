# 需求评估 Remote

[English](README.md) | 中文

可信 Host 的 `requirementAssessment` namespace 提供 `list({workspaceId})`、`get({workspaceId,id})`、`review({workspaceId,requestId,subject,text?,evidence?,supersedes?})`。subject 支持手工 `{kind:'manual',id,title}`、Plan `{kind:'plan',id}`、Focus `{kind:'focus',id,planId}`。手工必须提供 text；证据只接收 source 和 excerpt。actor 来自部署 `operatorId`，在操作边界通过 Workspace Registry 核验所选 workspace。

响应为 `{assessment,drift}`，list 返回数组；Typert 自动包装客户端结果。drift 为 `fresh`、`stale`、`unknown` 或 `unavailable`。手工输入没有外部当前 revision，返回 unknown。缺失或不可读 Planning subject 不会显示 fresh。实时状态读取不会重建历史输入、修改 Planning 或自动重新评估。

## 不变量策略

不发布 invariant companion（No invariant companion is published）：本 adapter 没有自己的持久投影或第二真相源。

## Model Experience

### No direct model context

#### What the model sees

`ctx.requirementAssessmentRemote`: 本 adapter 不注册工具或 prompt。有界评估请求由 review service 拥有。

#### Token effect

读取不消耗模型 token，仅明确 review 请求调用 evaluator。

#### KV Cache effect

无直接影响，模型输入由 review runner 拥有。

## Known Limitations and Deferred Work

- 本地 Host operator 身份沿用 Planning Remote 信任模型，并非多租户认证层
- list 通过一份授权 Planning snapshot 比较全部评估，不抓取 opaque 资源
