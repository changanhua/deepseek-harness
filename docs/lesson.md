# Lesson

English | [中文](lesson.zh.md)

Easy-to-miss environment facts that caused a real, costly misdiagnosis here. Read this before diagnosing any "command does not run" or "process should not be touched" report; the pattern is: **verify environment facts before blaming an artifact, a policy, or assuming a process is not your own runtime.**

## An npm CLI name is rarely a shim-resolution problem

A Windows + npm + PowerShell install puts several same-named artifacts under one PATH entry — `arkcli`, `arkcli.cmd`, `arkcli.ps1`. `Get-Command arkcli` reports `arkcli.ps1` (ExternalScript) first, which looks like a smoking gun for "PowerShell picked the ExecutionPolicy-bound `.ps1`". That premise is **false** on this deployment: the `.ps1` shim dispatches to `node`, and bare `arkcli --version`, `claude --version`, and `pnpm --version` all run successfully (exit 0).

The command-resolution rewrite idea ("resolve `claude` to the `.cmd` artifact") was rejected because it solves a non-problem while re-adding a fragile command-rewriting seam (the executor would have to parse PowerShell syntax — quotes, pipelines, `;`, variables — to find the leading token). An actual npm CLI failure was misattributed here twice: once as a stale-login report (`refresh_token is invalid`), once as a shim truth that was never tested.

**Rule:** when a bare npm CLI name "does not run", first gather the structured environment facts — the actual exit output for the bare name and for the `.cmd`/`.ps1` variants, and the login/credential state — before assuming a resolution or policy problem. Do not edit the user's `$PROFILE` and do not relax ExecutionPolicy to "fix" it; the former pollutes the host and breaks everywhere else (CI, Docker, another Windows user, remote Linux), and the latter solves a different question (whether `.ps1` may run) than the one asked (which artifact to choose).

## A process you are about to affect may be your own runtime

When a report names a process id or port that "should not be touched", verify against the current host before acting: the DSH host process and its web UI port are one such protected set. Terminating the process editing this very workspace by mistake is exactly the failure this lesson prevents.

The missing piece behind both items is a structured runtime-awareness layer — how an agent knows its own runtime and which artifact a command resolves to — proposed separately in [future-work-candidate.md](future-work-candidate.md).
