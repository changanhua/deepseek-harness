# Post-mortem 0005: Merged Web runtime used stale artifacts and retried failed preset recovery

English | [中文](0005-web-merge-runtime-regressions.zh.md)

Status: resolved

## Executive summary

After validated branches were merged into local `master`, Web still showed 288 architecture packages even though the merged catalog contained 308. Existing sessions also failed to resume because the copied `field-cordis` preset used retired `persona.text` instead of required `persona.prefix`. Rollback emitted command-catalog changes, and the browser retried every notification, producing `ERR_INSUFFICIENT_RESOURCES` and the unhelpful `Failed to fetch`. The incident escaped because Git state, generated client artifacts, Profile configuration, and a real send-and-reload flow were verified separately. The guardrails are artifact rebuild and restart evidence, Profile schema checks, coalesced failed-directory refreshes, and a complete browser conversation check.

## Summary

The merged `master` source generated 308 architecture catalog entries. The running Web client served an older dynamic bundle containing 288 entries until the architecture package was rebuilt and the Host restarted.

The personal `field-cordis` preset was copied from an older composition and retained `config.text`. The current `dsh-persona` schema requires `config.prefix`, so restoring any session using that preset failed during Agent setup. The Gateway returned the useful cause as an internal error, while the browser reduced transport failures to `Failed to fetch`.

During rollback, command registrations changed. The client command directory started a new `commands/list` request for each `commands/change`, including while a prior pull was still failing. The resulting request storm exhausted browser resources and hid the original preset error.

## Impact

Users could see an apparently unmerged architecture catalog, fail to resume sessions using the field preset, and be unable to send ordinary prompts. The original v0 session artifact remained unchanged; a current v3 successor was published after the migration fix. No evidence showed data loss or an authorization bypass.

## Timeline

- Validated browser and memory integration branches entered local `master`.
- Web started from the source checkout but consumed an old architecture client bundle; the sidebar showed 288 instead of 308.
- History loading exposed a v0 migration validator gap for the downstream `rpcDigest` field; the raw source log stayed unchanged and migrated successfully after the validator accepted that field.
- Session resume exposed the stale `field-cordis` `persona.text` configuration.
- Rollback notifications triggered repeated command-directory pulls and browser `ERR_INSUFFICIENT_RESOURCES`.
- The preset field was corrected, command refreshes were coalesced, the architecture client was rebuilt, and the Host was restarted.
- A new session sent two prompts, received both expected replies, and retained the conversation after reload.

## Root cause

The merge workflow treated a Git ref as if it selected the bytes already served by Web. It lacked a source-to-bundle identity check and did not require a restart after source or Profile changes. Profile schema changes had no migration or preflight over existing personal preset copies. The command directory treated a non-vetoing change event as an unconditional retry request, so a deterministic setup failure became an unbounded client loop. Session-format evolution also added a writer field without updating the frozen v0 reader vocabulary.

## Guardrails added

- The v0 session validator accepts the emitted non-empty `rpcDigest` field and has a regression case for `agent/inbox/spliced` user messages.
- `CommandDirectory` coalesces invalidations during an active pull, performs at most one follow-up after success, and leaves failed entries failed until an explicit retry path.
- The `field-cordis` personal preset was backed up before changing `text` to `prefix`.
- The architecture client was rebuilt and the Host restarted before counting catalog entries; the served page showed 308.
- Browser acceptance covers resume, new-session creation, prompt submission, model response, reload, and a second prompt.
- The command-directory behavior and its failure-loop rationale are recorded in the [plugin command registration Agent Note](../../.agents/notes/implemented/feature/2026-07-19-plugin-command-registration.md).

## Lessons

- A merged branch is not a running build; record checkout, artifact, Profile, process, and port as one subject identity.
- A changed config schema needs an upgrade check over persisted and copied compositions before sessions try to restore them.
- Failure notifications must not become automatic infinite retries.
- HTTP 200, history loading, or a visible page is insufficient for a Web claim; send, receive, reload, and continue the same conversation.
