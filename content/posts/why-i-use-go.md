---
title: "why I use Go"
date: 2026-05-15
draft: false
tags: ["go", "languages"]
description: "not because it's the best language, but because it gets out of the way"
---

Go is not the most expressive language. It's not the fastest. The error handling is verbose and generics arrived late. There are things about it that should annoy me.

But I keep reaching for it.

## the pitch nobody makes

Most Go pitches focus on goroutines and performance. That's real but it's not why I stay. I stay because of **reading**.

Go code is boring in the best way. When I come back to a Go codebase after six months, I can read it. There's rarely a clever abstraction I need to unpack, no magic happening behind the scenes, no framework-specific patterns I need to remember.

The code says what it does. That's rarer than it sounds.

## the stdlib

The standard library is genuinely good. HTTP server, JSON, testing, crypto, database interfaces — it's all there, it's stable, and it works the way you'd expect.

In most other ecosystems, picking a library is a decision. In Go, the default answer is often "use the stdlib" and that answer is usually correct.

## compilation speed

Fast builds are underrated. The feedback loop of write → compile → run being under two seconds changes how you work. You stay in flow instead of watching a progress bar.

## the tradeoffs

Go makes you write more code for less. That's the deal. No implicit conversions, no operator overloading, no macros. You write the loop, you write the error check, you write the thing.

Some find this tedious. I find it honest.
