---
title: "LMAX Disruptor - High Performance Inter-Thread Messaging Library"
date: 2026-10-19T10:00:00+00:00
draft: true
tags: ["concurrency", "performance", "systems-design"]
description: ""
---

## What is the Disruptor?

## Background: The LMAX Architecture

## Why Queues Are Slow

## Mechanical Sympathy
Mechanical sympathy is about writing software that works with the way the hardware actually behaves, not against it.

The term comes from racing driver Jackie Stewart, who said you don't need to be an engineer to be a great driver, but you do need a feel for how the car works. Martin Thompson (one of the Disruptor's authors) borrowed it for software[^mechanical-sympathy]: you'll write much faster code once you understand how the CPU, memory and caches behave underneath your language.

[^mechanical-sympathy]: Martin Thompson's blog, [Mechanical Sympathy](https://mechanical-sympathy.blogspot.com/), is where much of this thinking is written up — including posts on false sharing and other hardware-level performance topics behind the Disruptor's design. Well worth reading alongside this post.

### CPU Caches and Cache Lines

{{< diagram name="cpu-cache-hierarchy" caption="Approximate figures for a modern x86 CPU. Each step away from the core is slower, and main memory is roughly 80× slower than L1." >}}

The above numbers assume a single CPU socket.[^numa]

[^numa]: On multi-socket servers, each socket has its own memory (a NUMA node); reaching the other socket's memory or caches costs noticeably more, which is why low-latency deployments pin related threads to cores on the same socket. I go into how and why in [CPU Affinity - Pinning Threads to Cores]({{< relref "cpu-affinity" >}}).

### False Sharing

### Memory Barriers

## Core Components

### Ring Buffer

### Sequence

### Sequencer

### Sequence Barrier

### Wait Strategies

### Event Processors and Event Handlers

## Publishing an Event

## Consuming Events

## Dependency Graphs

## Code Example

## Performance

## When to Use It (and When Not To)

## Trade-offs

{{< source-disclaimer >}}

## References

1. Martin Thompson, Dave Farley, Michael Barker, Patricia Gee & Andrew Stewart, [LMAX Disruptor: High performance alternative to bounded queues for exchanging data between concurrent threads](https://lmax-exchange.github.io/disruptor/disruptor.html), 2011
2. Martin Fowler, [The LMAX Architecture](https://martinfowler.com/articles/lmax.html), 2011
3. [LMAX Disruptor User Guide](https://lmax-exchange.github.io/disruptor/user-guide/index.html)
4. [LMAX Disruptor on GitHub](https://github.com/LMAX-Exchange/disruptor)
5. Martin Thompson, [False Sharing](https://mechanical-sympathy.blogspot.com/2011/07/false-sharing.html), Mechanical Sympathy, 2011
6. Martin Thompson, [Mechanical Sympathy](https://mechanical-sympathy.blogspot.com/) (blog)
