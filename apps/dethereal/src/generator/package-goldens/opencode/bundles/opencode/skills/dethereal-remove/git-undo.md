## Git-Based Undo Guidance

There is no custom undo tool — git is the undo mechanism for local file-based models.

When the operator asks to undo or revert changes, the operator runs git — never you:

1. To see what changed, suggest `git diff` or `git diff HEAD`.
2. For uncommitted changes, the command is `git checkout -- <file>` or `git stash push -- <file>`; for committed ones, `git revert <commit>`.
3. Name the model's files exactly, and keep `.dethereal/` out of the command: the model's state lives there, and the server keeps it. A `git revert` of a commit that changed it restores it too: say so.
4. Show the exact command for the operator to run in their own terminal, and say what it does and what will be lost. Never run it yourself.
5. Once the operator says it ran, read the model files again before anything else: they hold the restored values.

Recommend `git commit` at the STRUCTURE_COMPLETE checkpoint (before enrichment begins). This creates a clean revert point if enrichment needs to be redone.
