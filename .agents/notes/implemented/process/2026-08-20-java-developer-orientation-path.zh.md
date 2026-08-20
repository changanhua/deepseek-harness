# Agent Note: Java developer orientation path

Status: implemented

[English](2026-08-20-java-developer-orientation-path.md) | 中文

## Problem

现有 Cordis 编号教程通过可运行实验讲解插件框架，而架构和子系统参考页假定读者已经能够理解 Agent、Session、事件和能力等词汇。Java 开发者可以通过一份简短的运行时地图更快理解项目，但如果把架构参考页改成第二套教程，就会重复事实并破坏文档归属。

## Decision

面向 Java 开发者的运行时地图位于[Java 开发者路径](../../../../docs/cordis-tutorial/java-developer-path.md)。它是一份非运行式的导览页，由 Cordis 教程索引放在编号实验之前。它只把 Java 类比作为入口，明确说明重要差异，沿着 Profile 到 SessionEvent 跟踪一个请求，并将详细契约链接到所属架构页、子系统页或包 README。

英文页和简体中文页保持为完整翻译配对，网站通过现有 Cordis 框架教程分组发布这两页。

## Alternatives considered

**把 `docs/architecture.md` 改成教程。** 这会把有顺序的架构地图和前置知识导学混在一起，并重复现有的 Cordis 可运行章节，因此架构页继续作为参考文档。

**新增可运行的第 8 章。** Java 路径没有新增可执行实验；把它作为编号实验会错误表达用途，并使章节索引的语义变得不稳定，因此它作为编号章节旁的导览页保留。

**只发布中文页或不把页面加入网站。** 当前文档要求双语配对，而且该页面面向外部贡献者作为入口，因此它保留英文对应页并加入明确的网站清单项。

## Consequences

教程现在有两条入口路径：Java 开发者可以先阅读运行时地图，偏好直接运行代码的读者则可以从第一个插件开始。导览页必须继续限定 Java 类比的适用范围，并通过链接而不是重复正文来承载包契约。新增其他贡献者受众时，需要同时维护源文档配对、配对记录、教程索引和网站清单。

## Verification

指定的翻译配对通过 `verify-translation-pairing`，仓库全部 Markdown 链接通过 `verify-md-links`，网站 fragment 检查通过，VitePress 文档构建完成。全量 `doc-sync` 和 `lint` 仍受当前脏工作树中的其他过期目录、文档预算、JSDoc、类型等价性、格式以及 UI/task-queue 问题影响。
