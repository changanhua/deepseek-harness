# Agent Note：经 settings seam 的搜索提供方凭证与仅 inspect 的提供方 fact

Status: implemented

[English](2026-08-23-web-search-provider-credentials-and-facts.md) | 中文

## 问题

Exa 与 Perplexity 搜索提供方在 `apply` 中一次性捕获 API 密钥（`config.apiKey ?? launchEnvironmentOf(ctx).get('EXA_API_KEY')?.value`），因此用户没有持久的 `settings.yaml` 界面来管理密钥引用、端点或检索默认值，已存储或轮换的密钥也不会在重启前到达运行中的进程。两个提供方都没有向 runtime awareness 暴露任何状态，因此在不发送真实搜索的情况下，模型无法检查提供方是否本地可用、其凭证是否已配置。

## 决策

两个提供方都采纳 `@deepseek-ai/dsh-web-search-deepseek` 已建立的模式。`Config` 新增 `apiKeyEnv`（`role('credential-ref')`，默认 `EXA_API_KEY`／`PERPLEXITY_API_KEY`），并把 `apiKey` 标记为 `role('secret')` 且 deprecated：非空字面量 `apiKey` 仍为向前兼容而优先，否则每次搜索都经可选的 `ctx.credentials` seam 解析该引用，该 seam 缺席时回退启动环境（R3-7 secret literal precedence）。密钥缺失时搜索以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败并给出可操作的错误消息，与 DeepSeek 提供方一致。

每个提供方注册 `web-search-exa`／`web-search-perplexity` settings namespace（`installSettingsSection`，与 web 包相同的规范 optional-settings 接线），其提供方按搜索投影解析后的 section（`() => resolveOptions(ctx, current())`），因此 user 层编辑在下次调用生效而无需重新注册，seam 的提供方选择也从不闪烁。

Runtime awareness 按 R3.1-B3 定义的 optional seam 接线：`ctx.inject(['runtimeFacts'], rctx => rctx.effect(() => …))` 注册两个由提供方包拥有的仅 inspect fact——`web-search.<id>.local-available`（sync/dynamic，`provider.available()`）与 `web-search.<id>.credential-configured`（async/dynamic，`credentials.describe(ref).configured`，环境回退）。`@deepseek-ai/dsh-runtime-facts` 是 optional peer dependency；没有该服务时提供方行为与此前完全一致，卸载插件会撤回 fact。`available()` 在存在解析器时即报告 true，即使当前尚未解析出值，因为凭证存在性是同步契约无法读取的异步事实；被选中的无密钥提供方改在搜索时失败。

## 验证

`packages/web/web-search-exa/tests/exa.settings.spec.ts` 与 `packages/web/web-search-perplexity/tests/perplexity.settings.spec.ts` 针对真实的 `SettingsProvider` 与 `LocalCredentialProvider` 实例钉住以下行为：user 层覆盖 composition entry 并在下次搜索生效；存储的密钥每次搜索解析、轮换在下次调用生效；非空字面量 `apiKey` 优先于存储凭证；未挂载 credentials 服务时由环境兜底；密钥缺失以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败；两个 fact 以 inspect exposure 注册并报告正确值（未存储时为 `false`）；dispose 插件会撤回 fact（HMR-safe）；没有 runtime-facts 服务时提供方保持完整工作。现有 `exa.spec.ts`／`perplexity.spec.ts` 套件在 thunk 构造函数与凭证错误语义下通过。

## 备选方案

**继续在 `apply` 中读取环境。** 拒绝：它把密钥冻结在注册时，没有为用户偏好平面留下 settings 界面，也无法在重启前拾取轮换。

**在提供方内部直接解析环境。** 拒绝：按操作的解析应归属 credentials seam，使已挂载的存储成为权威、环境保持兜底，与 DeepSeek 提供方和 `repository-facts.md §4.1` 一致。

**把 `runtimeFacts` 声明为硬注入。** 拒绝（R3.1-B3）：那会让 runtime awareness 成为 web 提供方的硬依赖，破坏先于该插件的 composition。可选的 `ctx.inject` 接线在卸载时撤回 fact，并在没有该服务时保持提供方完整可用。

## 影响

提供方状态 fact（`local-available`、`credential-configured`）由各提供方包拥有，V1 只用 `exposure: 'inspect'`——它们从不自动投影进上下文；`credential-configured` 是异步的，由 `runtime_inspect kind=facts` 作答。DeepSeek 提供方暂不注册 fact（V1 通过 Exa 与 Perplexity 落地 fact 契约）。`apiKey` 字面量仍受支持但已 deprecated，改荐 `apiKeyEnv`；配置界面只能得知命名引用是否已配置，永远不会得知密钥值。
