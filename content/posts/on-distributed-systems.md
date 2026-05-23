---
title: "on distributed systems and why everyone gets them wrong the first time"
date: 2026-05-12
draft: false
tags: ["distributed-systems", "architecture"]
description: "the hardest part isn't the tech, it's accepting what you can't have"
---

The CAP theorem isn't just a theorem. It's a reminder that some problems don't have solutions, only tradeoffs.

You can have consistency or availability during a partition. Not both. Every distributed system you build is an answer to the question: which one matters more here?

## the fallacies hold up

Peter Deutsch's eight fallacies of distributed computing were written in 1994. They're still true.

The network is not reliable. Latency is not zero. Bandwidth is not infinite. The network is not secure. Topology changes. There is more than one administrator. Transport cost is not zero. The network is not homogeneous.

If your system assumes any of these are false, you will be surprised in production. Not if — when.

## clocks are liars

Physical clocks on different machines drift. NTP helps but doesn't solve it. If you're using wall clock time to order events across machines, you're going to get it wrong.

Logical clocks — Lamport clocks, vector clocks — give you ordering without requiring synchronized time. Learn them. You'll need them eventually.

## idempotency is not optional

In a distributed system, any operation might execute more than once. Networks time out. Retries happen. Your operations need to be safe to run multiple times with the same result.

Design for idempotency from the start. It's nearly impossible to retrofit.

## start simpler

Most systems don't need to be distributed. A well-tuned Postgres instance on good hardware can handle a lot. Reach for distribution when you've hit the limits of a single machine, not before.

Complexity is a cost. Pay it only when you have to.
