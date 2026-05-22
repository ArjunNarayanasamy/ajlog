---
title: "caching strategies that actually work"
date: 2026-04-25
draft: false
tags: ["performance", "backend"]
description: "cache invalidation is hard. here's how to think about it."
---

There are only two hard problems in computer science: cache invalidation, naming things, and off-by-one errors. The joke has teeth.

## cache-aside

Read: check the cache. Miss? Read from DB, populate cache, return. Write: write to DB, invalidate (or update) cache.

This is the most common pattern and works well for most use cases. The downside is that every cache miss pays the DB cost plus the cache write cost.

## write-through

Every write goes to the cache and the DB together. Reads are always cache hits (once warmed). The downside: write latency increases, and you're caching things that might never be read.

Good for data that's read frequently after every write. Bad for write-heavy data.

## TTL-based expiry

Set a time-to-live and let the cache expire naturally. Simple, predictable, tolerates some staleness.

The question is always: what's the right TTL? Too short and you're hammering the DB. Too long and users see stale data.

For most product data, a TTL of 30-300 seconds is the right starting point. For reference data that rarely changes, longer. For anything financial or security-related, zero — don't cache it.

## cache stampede

When a cached item expires, many concurrent requests might all miss at the same time and all hit the DB simultaneously. This is a cache stampede and it can take down a DB that was happily handling normal load.

The fix: probabilistic early expiry (refresh before the item expires), or distributed locking (one request rebuilds, others wait).

## the rule

Cache at the layer closest to the computation, with the shortest TTL you can tolerate. Move up layers and lengthen TTLs only when you need to.

Start with in-process caching. Add Redis only when you have multiple instances that need shared state.
