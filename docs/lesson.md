# Lesson

English | [中文](lesson.zh.md)

Easy-to-miss environment facts that caused a real, costly misdiagnosis here. Read this before diagnosing any "command does not run" or "process should not be touched" report; the pattern is: **verify environment facts before blaming an artifact, a policy, or assuming a process is not your own runtime.**

## An npm CLI name is rarely a shim-resolution problem

A Windows + npm + PowerShell install puts several same-named artifacts under one PATH entry — `arkcli`, `arkcli.cmd`, `arkcli.ps1`. `Get-Command arkcli` reports `arkcli.ps1` (ExternalScript) first, which looks like a smoking gun for "PowerShell picked the ExecutionPolicy-bound `.ps1`". That premise is **false** on this deployment: the `.ps1` shim dispatches to `node`, and bare `arkcli --version`, `claude --version`, and `pnpm --version` all run successfully (exit 0).

The command-resolution rewrite idea ("resolve `claude` to the `.cmd` artifact") was rejected because it solves a non-problem while re-adding a fragile command-rewriting seam (the executor would have to parse PowerShell syntax — quotes, pipelines, `;`, variables — to find the leading token). An actual npm CLI failure was misattributed here twice: once as a stale-login report (`refresh_token is invalid`), once as a shim truth that was never tested.

**Rule:** when a bare npm CLI name "does not run", first gather the structured environment facts — the actual exit output for the bare name and for the `.cmd`/`.ps1` variants, and the login/credential state — before assuming a resolution or policy problem. Do not edit the user's `$PROFILE` and do not relax ExecutionPolicy to "fix" it; the former pollutes the host and breaks everywhere else (CI, Docker, another Windows user, remote Linux), and the latter solves a different question (whether `.ps1` may run) than the one asked (which artifact to choose).

## Extending a service or interface type silently unregisters structural consumers

Adding a required member to a Service Definition or interface type (here: a new `ApiProxy['skillManagement']` member) breaks every structural consumer at once, and a test double that `implements` that type is one of them: it compiles clean only until the compiler reaches the file `tsc` happens to revisit. `tsc -b` is incremental, so a green host stage that stops after its own three errors hides a client stage with far more, and a `@ts-expect-error` that a prior fix made unused turns into its own new error when the allowlist or contract grows. The concrete miss here was two client-side `FakeApiClient` stubs in separate packages, plus a `LocaleKeysOf<'taskQueue'>` reader whose common-key set is broader than the fake's dictionary, so a key like `ok` was invalid at the consumer even though the fake looked complete.

**Rule:** when a change grows or reshapes a structural type, enumerate its consumers in the same change — `implements X`, `: X`, `Partial<X[...]>`, and `@ts-expect-error` directives in affected files — because test doubles are implicit consumers the compiler reports only when it reaches them. Then push the full incremental chain to its end (the whole `tsc -b` aggregate, not one leaf) before treating the change as verified, and re-check the affected files for `@ts-expect-error` directives that became unused, since a directive that outlives its suppression is a new failure. Where an optional member is filled from a possibly-`undefined` variable under `exactOptionalPropertyTypes`, spread it conditionally or type the member `?: T | undefined`; and where a test fabricates a `TranslateNS`/`LocaleKeysOf` reader, cover the merged common-key set, not only the dictionary keys.

## A process you are about to affect may be your own runtime

When a report names a process id or port that "should not be touched", verify against the current host before acting: the DSH host process and its web UI port are one such protected set. Terminating the process editing this very workspace by mistake is exactly the failure this lesson prevents.

The missing piece behind both items is a structured runtime-awareness layer — how an agent knows its own runtime and which artifact a command resolves to — proposed separately in [future-work-candidate.md](future-work-candidate.md).
