---
title: "what code review is actually for"
date: 2026-04-20
draft: false
tags: ["culture", "craft"]
description: "not catching bugs. something more important."
---

Code review is widely practiced and widely misunderstood. Most teams treat it as a bug-catching mechanism. That's the least important thing it does.

## what it's not for

Studies consistently show that code review is a poor mechanism for finding bugs. Testing catches bugs. Fuzzing catches bugs. Type systems catch bugs. Code review catches some bugs, incidentally.

If your primary goal for code review is preventing bugs from reaching production, you're optimizing the wrong thing.

## what it is for

**Knowledge transfer.** Review is how knowledge spreads across a team. The reviewer learns about the change. The author learns from the feedback. Both understand the codebase a little better than before.

**Raising the average.** A team with consistent code review has a shared standard. That standard compresses toward the better end of the team's range.

**Catching design problems.** A bug is local. A design problem propagates. Review is good at catching the latter — when a proposed interface is awkward, when an abstraction is premature, when the approach will cause pain in six months.

## reviewing well

Ask questions more than giving directives. "Why did you choose X over Y?" is more useful than "Change this to Y."

Separate must-fix from nice-to-have. Prefix nits with "nit:". Don't let bikeshedding block the review.

Review the design before the implementation. A well-reviewed PR where the approach is wrong is still wrong.

## approve fast

The worst thing a review process can do is slow things down without adding value. If you're not going to read it carefully, approve it. If you are, do it quickly.

Slow review is a tax on the team. Make it low friction.
