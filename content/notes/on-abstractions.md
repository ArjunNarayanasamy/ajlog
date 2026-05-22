---
title: "on abstractions"
date: 2026-05-08
draft: false
---

An abstraction is worth having when it makes the common case simple without making the edge cases impossible.

The failure mode is abstractions that save ten lines in the easy path and cost you two hours when you need to do something they didn't anticipate.

Premature abstraction is harder to fix than duplication. Duplication is annoying but local. A bad abstraction is load-bearing — removing it means touching everything that depends on it.

Wait until you see the pattern three times before abstracting it. The third time, you'll actually know what you're abstracting.
