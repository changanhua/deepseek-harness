# Community capability intake

Community discovery produces candidates, never automatic dependencies.

## Inspect without executing

Read the repository, exact manifest or `SKILL.md`, referenced scripts, license, release history, and dependency files. Do not run install hooks, scripts, provider calls, authentication, or update commands during an analysis-only audit.

Record:

- repository URL and fixed commit or released version;
- license and attribution obligations;
- last meaningful maintenance evidence;
- scripts, binaries, install hooks, network access, credentials, and filesystem writes;
- prompts or instructions that modify the project, user configuration, or the candidate itself;
- required model/provider and assumptions that may drift;
- input/output form, structured validation, batch behavior, cancellation, and failure reporting;
- overlap with existing DSH Services, Skills, Tools, and Providers;
- the smallest safe adoption form.

## Adoption forms

- **Reference only** — use the repository as design evidence; ship none of it.
- **Direct dependency** — appropriate for a maintained library whose runtime behavior and transitive footprint meet DSH policy.
- **Pinned Skill** — copy or package a reviewed instruction bundle with provenance; retain only required resources.
- **Vendor/Fork** — own a constrained copy when upstream behavior, scripts, or update policy do not fit.
- **Reject** — record the concrete mismatch only when it prevents a tempting future adoption.

## Skill-specific review

Treat Skill instructions as executable policy for an Agent. Reject or remove instructions that:

- auto-install or auto-update dependencies;
- send repository content or credentials to an undeclared recipient;
- mutate their own `SKILL.md`, lessons, or configuration during ordinary use;
- require interactive questions in unattended batch execution;
- execute provider scripts when only domain guidance is needed;
- claim model compatibility without an adapter or eval;
- return prose where a typed consumer requires strict JSON.

For a local pinned Skill, record upstream URL, commit, license, removed behavior, local additions, evaluation cases, and how updates are reviewed. Never track an upstream default branch at runtime.

## Evaluation

Test the candidate against representative successful, ambiguous, and failure cases. Verify the output the intended DSH consumer will parse, not only that the model's prose looks plausible. For provider-backed behavior, separate instruction quality from live API success and cost.
