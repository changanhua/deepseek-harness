# GitHub Actions security policy

This repository is a personal-development fork maintained by `changanhua`.

## Trust boundary

- Automatic code-executing workflows are intended for commits and pull requests authored by `changanhua` only.
- Contributions from other accounts must not execute repository code in privileged or secret-bearing jobs without explicit maintainer review and an intentionally separate workflow.
- Workflows should use least-privilege `GITHUB_TOKEN` permissions (`contents: read` by default).
- Do not use `pull_request_target` to check out or execute untrusted pull-request code.
- Do not expose production credentials, personal data, private infrastructure details, or private-agent configuration to public workflow logs or artifacts.
- Prefer explicit `if:` author/actor guards in addition to GitHub repository settings, so the trust boundary is reviewable in version control.

## Intended author guard

For pull-request jobs that execute repository code:

```yaml
if: github.event_name == 'pull_request' && github.event.pull_request.user.login == 'changanhua'
```

For dispatch/push jobs where appropriate:

```yaml
if: github.actor == 'changanhua'
```

This file documents policy; workflow files remain the enforcement point.
