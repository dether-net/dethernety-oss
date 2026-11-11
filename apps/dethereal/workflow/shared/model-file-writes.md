**Model-file writes, one message per answer.** Everything one operator answer changes in `structure.json`, `dataflows.json`, `data-items.json`, `.dethereal/discovery.json` and the attribute files (in the enrich skill, as Writing and validating says) goes in one message: every edit to every one of those files, as parallel calls; one edit per element is fine. A read those edits need goes in the message before. Validate in the message after, once every edit has succeeded. Never spread one answer's edits over two messages; only a failed edit is redone, after reading its file again. A whole-file write replaces a file's edits only when it is shorter.
{{#harness codex}}
With `apply_patch`, that message is one call: one patch, a section per file, a hunk per change.
{{/harness}}
