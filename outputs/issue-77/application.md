# Issue 77 补丁应用说明

目标分支：dot/domain-runtime-plane。基线必须为 f961840fa51191dd4e70570df948fde94a830fd5。不要把本补丁应用到 master、Planning 或 Side-effect Safety 分支。建议在独立干净 worktree 操作；若目标分支已有其他提交，停止直接应用，先确认差异，不强制覆盖。

1. 下载完整 issue-77-domain-runtime-phase-a.patch。
2. 在基线对应的干净工作目录检查 `git rev-parse HEAD`。
3. 执行 `git apply --check <补丁绝对路径>`。
4. 执行 `git apply --index <补丁绝对路径>`。
5. 执行 `git diff --cached --check` 和 `git write-tree`；tree 必须与本次交付消息/外部交付说明给出的 SHA 相同。
6. 阅读本目录 verification-report.md，按需重跑已列出的针对性验证。
7. 使用你自己的正常 Git 身份提交，再用非强制 push 推送到目标分支。

补丁包含源码、测试、recorded-session fixture、双语文档、实施计划与验收报告。未生成实施 commit 或 PR，不合并 master；未运行真实 FC 登录/写入。请保留报告的真实缺口：输入来源尚不认证为真实 Browser receipt，没有 live quote/native chemistry；全仓基线检查未全绿。
