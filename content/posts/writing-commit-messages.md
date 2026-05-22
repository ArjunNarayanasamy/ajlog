---
title: "on writing good commit messages"
date: 2026-04-29
draft: false
tags: ["git", "craft"]
description: "a commit message is a letter to your future self"
---

The commit message is the only artifact from the development process that stays permanently attached to the code. Pull requests close. Slack threads scroll away. Comments go stale. The commit stays.

## the format

Subject line: 50 characters, imperative mood, no period. `Fix session timeout bug` not `Fixed session timeout bug` and not `This commit fixes the session timeout bug that was causing users to be logged out`.

Body: Explain why, not what. The diff shows what. The message should explain why this change was necessary, what alternatives were considered, and what you'd want to know six months from now looking at this line in git blame.

## the bad ones

`fix` — fixes what?
`wip` — not a commit message
`asdfgh` — I've seen this more than once
`update stuff` — what stuff, why

These are non-messages. They exist because someone treated the commit message as a formality.

## the good ones

```
Remove synchronous email sending from signup flow

Email delivery was adding 2-4 seconds to the signup response time.
Moved to async queue processing. Users now get a success response
immediately and the welcome email is sent within ~30 seconds.

Fixes #412
```

Everything you need. What changed, why it changed, what the tradeoff was, what issue it resolves.

## why it matters

In six months, someone will git blame a line of code, read your commit message, and either understand immediately or spend an hour reconstructing context. That someone is often you.

Write for them.
