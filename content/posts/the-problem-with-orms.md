---
title: "the problem with ORMs"
date: 2026-05-09
draft: false
tags: ["databases", "backend"]
description: "they solve the easy problems and obscure the hard ones"
---

ORMs are useful until they aren't. The transition from useful to harmful is gradual and hard to notice until you're in trouble.

## what they get right

For simple CRUD — creating a user, fetching a list, updating a field — ORMs are genuinely good. They handle the boilerplate, they keep your model and schema in sync, and they protect you from basic SQL injection mistakes.

If your app is mostly CRUD, an ORM is probably the right call. Stop reading here.

## where it breaks down

The problems start when your queries get interesting.

ORMs are optimized for the common case. Anything outside the common case — aggregations, window functions, complex joins, partial indexes, CTEs — requires you to either fight the ORM or drop into raw SQL anyway.

Worse, ORMs make it easy to accidentally write terrible SQL. The N+1 query problem exists specifically because it's easy to write a loop that looks innocent in ORM code and generates hundreds of database calls at runtime.

## the abstraction leaks

The abstraction of "objects that save themselves to a database" is appealing but wrong. The database has its own semantics — transactions, constraints, locking, consistency guarantees — that don't map cleanly onto objects.

When things go wrong, you need to understand what SQL is being generated. Which means you need to understand SQL. Which means the abstraction only gets you so far.

## what I do instead

Write SQL. Use a query builder for composition if you need it. Keep your database logic in one place. Understand what's going into the wire.

It's more code. It's also more honest.
