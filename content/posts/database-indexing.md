---
title: "database indexing, actually"
date: 2026-05-03
draft: false
tags: ["databases", "performance"]
description: "what indexes do, when to add them, and what people get wrong"
---

Indexes are the single highest-leverage performance optimization available to most applications. They're also widely misunderstood.

## what an index actually is

An index is a separate data structure — usually a B-tree — that maintains a sorted copy of one or more columns alongside pointers to the actual rows. When you query with a WHERE clause on an indexed column, the database walks the B-tree instead of scanning every row.

A sequential scan on a million-row table reads a million rows. An index lookup reads maybe twenty. That's the difference.

## when to add one

Add an index when:
- You're filtering, sorting, or joining on a column in a hot query path
- `EXPLAIN ANALYZE` shows a sequential scan on a table with more rows than you're comfortable with
- A query is visibly slow and the column isn't indexed

Don't add an index on every column. Indexes have write overhead — every INSERT, UPDATE, DELETE has to update every index on that table. Too many indexes hurts write performance.

## composite indexes and column order

A composite index on `(a, b)` can serve queries that filter on `a` alone, or on both `a` and `b`. It cannot efficiently serve queries that filter on `b` alone.

The leftmost prefix rule. Put your most selective, most commonly filtered column first.

## partial indexes

Partial indexes index only the rows that match a condition. `CREATE INDEX ON orders (user_id) WHERE status = 'pending'` gives you a small, fast index for the common case of looking up pending orders.

Most people don't know partial indexes exist. They're one of the more underused features in Postgres.

## the only way to know

Run `EXPLAIN ANALYZE`. Read the output. Look for sequential scans on large tables, high row estimates, and large differences between estimated and actual rows. That's where your indexes go.
