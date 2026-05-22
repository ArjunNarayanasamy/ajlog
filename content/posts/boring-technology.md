---
title: "in defense of boring technology"
date: 2026-05-06
draft: false
tags: ["engineering", "culture"]
description: "the most important property of a technology is that your team knows how it fails"
---

Dan McKinley's "choose boring technology" essay is one of the most useful things written about software engineering in the last decade. The core idea: every technology you adopt has a cost, and that cost is largely paid in failure modes you don't understand yet.

## innovation tokens

McKinley's framing is that you have a limited number of "innovation tokens" — licenses to do something novel. Spend them on the things that are actually core to your product. For everything else, pick the boring option.

Postgres is boring. Redis is boring. Linux is boring. They're boring because they've been around long enough to collect all the edge cases, all the known failure modes, all the answers on Stack Overflow.

## the unknown unknowns

The problem with new technology isn't the documented behavior. It's the undocumented behavior — the things that happen at 3am when you're paging through logs trying to figure out why your service is down.

With boring technology, someone has already been at 3am. There's a blog post. There's a GitHub issue. There's a StackOverflow answer from 2014 that's exactly your problem.

With new technology, you're the first one there.

## boring and fast aren't opposites

The instinct to reach for something new often comes from a performance problem. But in most cases, the performance problem is in how you're using the boring technology, not in the technology itself.

Fix the query. Add the index. Tune the config. You'll be surprised how far boring takes you.
