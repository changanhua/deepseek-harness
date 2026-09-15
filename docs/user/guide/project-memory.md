# Project memory

English | [中文](project-memory.zh.md)

Project memory keeps short, reusable facts and methods for one Workspace. An agent proposes a candidate with sources; a human reviews and accepts it. New sessions in the same Workspace can then search it. Acceptance permits reuse, while source checks, review deadlines, and conflicts determine whether it is currently usable.

## Enable the composition

Project memory is an explicit, private source bundle. It is absent from the default Web Profile and is not available as a public registry installation. Build the checkout and make `@changanhua/dsh-personal-memory` and its dependencies available to the selected development Profile's module resolver; the [bundle reference](../../../packages/bundle/personal-memory/README.md#composition) describes that source composition.

The Profile's `package.json` places the memory bundle after the base and Web bundles:

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

Start that configured Profile through `dsh --profile <profile-name>`, choose a Workspace in the Web UI, and enter `/memory list`. An empty list is a valid first result. An unknown command means the memory command plugin is not active in that composition; a chat reply alone does not establish enablement. Keep the same `DSH_HOME` when restarting to retain the Workspace registry and memory records.

## Propose and review a memory

Ask the agent to read a project source and propose one reusable claim, for example:

> Read the project validation rules in README.md and propose the validation command as project memory. Keep it pending for my review.

The proposal returns a memory id and a `/memory show` command. Open that command to inspect the exact statement, source locations, fingerprints, current source previews, and candidate revision. A candidate is excluded from ordinary recall until accepted.

Run `/memory accept <id>@<revision>` to accept exactly the version you reviewed, or `/memory reject <id>@<revision>` to reject it. The command records the human decision without starting a model turn. Text inside a source, a remembered statement, or an agent reply cannot perform that decision.

The default review interval is 30 days. To choose a future UTC deadline, use `/memory accept <id>@<revision> --review-after 2030-12-31T00:00:00Z`, replacing the example with the intended future date. Acceptance does not prove a claim true; review the statement against its sources before accepting it.

## Reuse, revise, and withdraw

Start another session in the same Workspace and ask for the relevant project method or prior decision. Usable results include the memory id, exact content revision, source identities, and check time. Worktrees and other registered project directories remain separate Workspaces; a guessed id does not grant access to another project's memory.

| Situation | Next action |
| --- | --- |
| Source changed | Ask the agent to read the current source and propose a revision to the same memory id, then review and accept the new candidate |
| Source unavailable | Restore access to the original source or propose a revision with an accessible source |
| Review deadline reached | Review the current source, then accept the exact current revision again with a future deadline |
| Conflicting claims on one topic | Inspect the claims and revise or withdraw the conflicting entry; ordinary recall withholds the conflicting group |
| Memory no longer wanted | Run `/memory retire <id>@<revision>` to withdraw the active revision |

Use `/memory show <id>@<revision>` to inspect historical content and `/memory list <page>` to navigate lists of 20 entries. A newer pending revision does not silently replace the active revision. Accepting it activates that exact version; rejecting it preserves the previous active version. Withdrawal stops ordinary recall while retaining history and prior Session logs.

## Recover an abandoned ownership lock

One local Host owns a memory root. A normal shutdown drains writes and releases its lock. A forced exit can leave `DSH_HOME/storages/project-memory-ownership/owner.lock`, and the next Host refuses to take it over automatically.

Inspect the recorded hostname, PID, token, and acquisition time. Verify that the recorded Host has exited and that no other Host is using that same data home; a PID alone is insufficient if it has been reused. After that verification, remove only that exact `owner.lock` and restart the configured Profile. Preserve the memory domain and source files. The default JSON backend stores the domain in `DSH_HOME/storages/project_memory.json`; a Profile can select another Storage Domain backend.

If startup reports invalid persisted data or a cleanup failure, preserve the files and the complete error. Repairing a malformed record requires restoring a known valid copy; deleting the database is not lock recovery.

## Limits

Each claim has at most 2,000 Unicode characters and five sources. The local defaults allow 500 records per Workspace, 50 content revisions and 200 mutation receipts per record, 1 MiB per source, and 16 KiB per complete result. Full stores reject additional writes rather than evict history. An oversized inspection asks for a narrower view instead of returning a partial claim.

Memory V1 uses lexical search and explicit topic conflicts. It does not scan all history in the background, accept candidates automatically, merge Workspaces, or synchronize an external knowledge base. Source checks describe observed bytes; they do not lock those files against subsequent edits.

The [subsystem reference](../../subsystems/project-memory.md) specifies identity, persistence, and concurrency semantics.
