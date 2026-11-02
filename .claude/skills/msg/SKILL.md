---
name: msg
description: Write a compact git commit message for the current changes. Use when the user runs /msg or asks for a commit message. Writes the message only; never commits unless explicitly asked.
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*)
---

# Commit message

Write a commit message for the current changes in this repository.

## Steps

1. Run `git status --short`, `git diff --staged` and `git diff`, and look at the untracked files.
2. Write **one** message that covers all the changes together: staged, unstaged and untracked. Never split it into several messages or suggest separate commits, unless the user asks.
3. Show the message in a code block.

## Rules

- Start with a past-tense verb: Added, Fixed, Implemented, Updated, Removed, Renamed, Moved, Refactored, Improved, …
- Subject line: one line, at most 72 characters, no trailing period.
- Keep it compact. Say what changed, not how. No file lists, no implementation details, no reasons unless they are essential.
- Add a body only when the change has several clearly separate parts: a blank line, then short bullets, each starting with a past-tense verb.
- Write in English.
- End every message with a blank line and the attribution trailer for the model in use, e.g. `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. If the session gives an attribution line, use that one.

## Committing

Never run `git commit` (or `git add`) unless the user explicitly asks to commit in the same request. By default, only show the message.

## Examples

```
Added FITS reader with BZERO/BSCALE support

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```
Implemented master frame creation

- Added median and mean combining
- Added flat normalisation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```
Fixed image orientation for TOP-DOWN row order

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```
