---
description: Stage all changes, commit with a generated message, and push (branch-safe on main)
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git branch:*), Bash(git log:*), Bash(git rev-parse:*)
---

Commit the working tree and sync it to the remote.

Steps:
1. Run `git status --short` and `git diff --staged` + `git diff` to see what changed. If the tree is clean, say so and stop.
2. Determine the current branch (`git rev-parse --abbrev-ref HEAD`).
3. Stage the changes (`git add -A`, unless the user named specific paths in $ARGUMENTS).
4. Commit with a concise, descriptive message summarizing the actual changes (imperative mood, one-line subject, optional body). If $ARGUMENTS contains a message, use it. End the message with:

   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
5. Push:
   - If on a non-default branch: `git push` (set upstream with `-u origin <branch>` if needed) — no extra confirmation.
   - If on the default branch (`main`): pushing bypasses PR review, so **ask the user to confirm before pushing**. Only push to main after they say yes.
6. Report the commit hash and the push result (or that the push is awaiting confirmation / was skipped).

Do not skip hooks or use --force. Never amend an existing commit unless the user asks.
