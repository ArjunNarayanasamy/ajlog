---
title: "building fast APIs that scale without falling apart under load"
date: 2026-05-18
draft: false
tags: ["backend", "performance"]
description: "what actually moves the needle when you need your API to be fast"
---

Speed in APIs is almost never about the language or the framework. It's about the decisions you make before you write a single line of code.

## the 90/10 rule

Ninety percent of API latency problems trace back to three things: N+1 queries, missing indexes, and synchronous calls to things that should be async. Fix those and you've fixed most of it.

The remaining ten percent is where people spend most of their time — micro-optimizing things that don't matter yet.

## what actually helps

**Batching.** If you're making a database call inside a loop, you've already lost. Fetch everything you need in one query, then work with it in memory.

**Indexes.** Run `EXPLAIN ANALYZE` on every query that touches more than a few hundred rows. If you see a sequential scan on a large table, add the index. This is free latency.

**Connection pooling.** Opening a new database connection per request is expensive. Use a pool. pgBouncer, HikariCP, whatever fits your stack — just use one.

**Caching at the right layer.** Not everything needs Redis. A lot of things can be cached in-process with a short TTL. The simpler the cache, the less that can go wrong.

## async where it belongs

Any operation that doesn't need to complete before you respond to the user should be async. Sending emails, writing audit logs, triggering webhooks — none of these belong in the critical path.

Push them to a queue. Your p99 latency will thank you.

## measure before you optimize

The biggest time sink in API optimization is optimizing the wrong thing. Profile first. Find the actual bottleneck. Then fix it.

A flamegraph tells you more in five seconds than an hour of reading code.
