# Self-hosting verifier protocol

Use this protocol only when a mutable DSH runtime under test also coordinates or judges its own change. Ordinary Codex editing, repository tests, and Skill changes do not trigger it.

Record four identities: the controller DSH Profile/home/process, the executor authority, the subject checkout/build/Profile/home/ports, and the known-good verifier. The controller and mutable subject must not share a worktree, module-resolution path, build output, or live Skill registry. They may share a machine only with separate homes, ports, data, and process identity.

Freeze the verifier plan outside the subject worktree before the subject starts. Record digests for its assertions, commands, checker, fixtures, expected artifacts, and allowed environment inputs. The mutable subject must not rewrite them while it is being judged.

Subject unit tests, subject-written reports, `git diff`, and subject workspace artifacts are candidate evidence. A protocol result checked independently, browser-visible state, or an external Provider record can establish world evidence when the frozen plan defines the expected result and the verifier reads it without subject-controlled parsing.

If a distinct verifier or pre-start frozen plan is required by the claim but unavailable, report that acceptance layer as `not run`. Lower source and composition evidence may still stand.
