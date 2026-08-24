# @deepseek-ai/dsh-runtime-facts-host

[English](README.md) | 中文

[`@deepseek-ai/dsh-runtime-facts`](../runtime-facts/README.zh.md) 的宿主进程 Service Provider。它拥有 V1 宿主清单，在进程和启动环境为权威来源时取得快照，并把可热加载的执行环境与 Web 服务器值委托给各自所属服务。

## 事实清单

| 键 | 新鲜度 | 暴露方式 | 来源 |
|---|---|---|---|
| `host.arch` | static | baseline | `process.arch` |
| `host.os` | static | baseline | `process.platform` |
| `runtime.execution-world` | dynamic | baseline | `ctx.subprocess.executionWorld` |
| `host.pid` | static | inspect | `process.pid` |
| `host.proxy.configured` | static | inspect | 启动环境 |
| `host.proxy.scheme` | static | inspect | 清理后的代理 URL |
| `host.proxy.host` | static | inspect | 清理后的代理 URL |
| `host.proxy.port` | static | inspect | 清理后的代理 URL |
| `host.proxy.source` | static | inspect | 固定 `env` 类别 |
| `web.server-url` | dynamic | inspect | 当前 `ctx.webServer` 绑定 |

所有事实都同步求值。缺少 subprocess 或 Web 服务器服务时，其委托事实为 unavailable，不会根据平台、包标识、配置或端口状态猜测。

## 代理清理

提供方读取一个不可变启动环境快照，优先级为 `HTTPS_PROXY` → `HTTP_PROXY` → `ALL_PROXY` → 它们的小写形式。有效 URL 只产生 `configured`、小写 `scheme`、`host`、可选数值 `port` 与 `source: env`。用户名、密码、路径、查询、片段、变量名及原始 URL 都会丢弃。输入缺失或格式错误时产生 `host.proxy.configured: false`，其他代理事实保持 unavailable。

提供方没有 Cordis 插件配置。先加载 `dsh-runtime-facts`；subprocess 与 Host Web 服务器服务保持可选，并可独立热加载。

## 模型体验

### 宿主基线事实

#### 模型看到的内容

模型通过 runtime-facts 快照看到 `host.arch` 与 `host.os`；挂载 subprocess 提供方时还会看到 `runtime.execution-world`。PID、代理元数据和 Web URL 仅供 inspect，不进入自动上下文。

##### 典型片段

```markdown
Host runtime facts:
- host.arch: x64
- host.os: win32
- runtime.execution-world: local
```

#### Token 影响

有条件产生，且最多包含三行 baseline。static 宿主行在插件生命周期内不变；execution-world 行随 subprocess 服务出现、变化或消失。

#### KV Cache 影响

这些行不变时前缀稳定。subprocess 提供方变化会替换活动运行时上下文快照，并可能从变化的上下文 token 起使复用失效。

## 已知限制与暂缓事项

- **宿主事实有意保持狭窄**：这里不推断 GPU、容器、浏览器、网络可达性、工作区、沙箱模式或命令解析。
- **存在代理不等于可连接**：清理后的启动配置不能证明代理可达，也不能证明某个客户端使用了它。
- **Web URL 只描述已绑定的 Host 服务器**：它不声称浏览器可达、路由状态或转发后的公共来源。
