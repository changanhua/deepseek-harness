# 项目记忆

[English](project-memory.md) | 中文

项目记忆为一个 Workspace 保存简短、可复用的事实和方法。Agent 提出带来源的候选，由人查看并接纳。同一 Workspace 的新会话随后可以检索它。接纳表示允许复用；来源检查、复核期限和冲突决定它当前是否可用。

## 启用组合

项目记忆是需要显式启用的私有源码 Bundle。默认 Web Profile 不包含它，也不能从公共注册表安装。先构建检出目录，让选定开发 Profile 的模块解析器能够找到 `@changanhua/dsh-personal-memory` 及其依赖；[Bundle 参考](../../../packages/bundle/personal-memory/README.zh.md#composition) 说明了该源码组合。

Profile 的 `package.json` 将记忆 Bundle 放在 base 和 Web Bundle 后面：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@changanhua/dsh-personal-memory"
      ]
    }
  }
}
```

通过 `dsh --profile <profile-name>` 启动配置好的 Profile，在 Web UI 选择 Workspace，再输入 `/memory list`。首次返回空列表是正常结果。命令不存在表示该组合中的记忆命令插件没有激活；只有聊天回复不能证明已启用。重启时保持相同的 `DSH_HOME`，才能保留 Workspace 注册表和记忆记录。

## 提出并复核记忆

让 Agent 读取项目来源并提出一条可复用命题，例如：

> 读取 README.md 中的项目验证规则，把验证命令作为项目记忆候选提出，等待我复核。

提案返回记忆编号和 `/memory show` 命令。打开该命令，检查确切命题、来源位置、指纹、当前来源预览和候选版本。候选在接纳之前不参与普通召回。

运行 `/memory accept <id>@<revision>` 接纳刚复核的确切版本，或运行 `/memory reject <id>@<revision>` 拒绝它。命令记录人工决策，不会启动模型回合。来源、记忆正文或 Agent 回复中的文本不能执行这项决策。

默认复核间隔是 30 天。需要指定未来的 UTC 截止时间时，使用 `/memory accept <id>@<revision> --review-after 2030-12-31T00:00:00Z`，将示例日期替换为预期的未来时间。接纳不能证明命题真实；接纳前需要对照来源复核正文。

## 复用、修订和撤回

在同一个 Workspace 新建会话，询问相关项目方法或历史决策。可用结果包含记忆编号、确切内容版本、来源身份和检查时间。Worktree 和其他已注册项目目录保持为独立 Workspace；猜到编号也不能读取其他项目的记忆。

| 情况 | 下一步 |
| --- | --- |
| 来源改变 | 让 Agent 读取最新来源，针对同一记忆编号提出修订，再查看并接纳新候选 |
| 来源不可读 | 恢复原来源的访问，或提出带可访问来源的修订 |
| 到达复核期限 | 复核当前来源，再接纳确切的当前版本，并设置未来期限 |
| 同主题命题冲突 | 查看命题，修订或撤回冲突项；普通召回会暂缓整个冲突组 |
| 不再需要这条记忆 | 运行 `/memory retire <id>@<revision>` 撤回生效版本 |

使用 `/memory show <id>@<revision>` 查看历史正文，使用 `/memory list <page>` 翻阅每页 20 条的列表。新的待确认版本不会悄悄替换生效版本。接纳后，那个确切版本生效；拒绝则保留原生效版本。撤回停止普通召回，同时保留历史和既有 Session 日志。

## 恢复遗留的所有权锁

一个本地 Host 独占一份记忆根目录。正常关闭会等待写入完成并释放锁。强制退出可能留下 `DSH_HOME/storages/project-memory-ownership/owner.lock`，下一个 Host 不会自动接管它。

查看记录的主机名、PID、token 和获取时间。确认记录中的 Host 已退出，并且没有其他 Host 使用同一个数据目录；PID 可能被复用，因此仅凭 PID 不足以判断。完成核验后，只删除那个确切的 `owner.lock`，再重启已配置的 Profile。保留记忆 domain 和来源文件。默认 JSON 后端把 domain 保存在 `DSH_HOME/storages/project_memory.json`；Profile 也可以选择其他 Storage Domain 后端。

如果启动报告持久数据无效或清理失败，应保留文件和完整错误。修复损坏记录需要恢复已知有效副本；删除数据库不属于锁恢复。

## 限制

每条命题最多有 2,000 个 Unicode 字符和五个来源。本地默认上限为每个 Workspace 500 条记录，每条记录 50 个内容版本和 200 个变更回执，单个来源 1 MiB，完整结果 16 KiB。达到容量后拒绝继续写入，不淘汰历史。查看结果过大时要求缩小范围，不返回不完整命题。

记忆 V1 使用词法检索和显式主题冲突判断。它不在后台扫描全部历史，不自动接纳候选，不合并 Workspace，也不同步外部知识库。来源检查描述观察到的字节，不会锁定文件来阻止后续编辑。

[子系统参考](../../subsystems/project-memory.zh.md) 定义身份、持久化和并发语义。
