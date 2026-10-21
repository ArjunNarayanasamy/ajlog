---
title: "LMAX Disruptor - High Performance Inter-Thread Messaging Library"
date: 2026-10-19T10:00:00+00:00
draft: false
tags: ["concurrency", "performance", "systems-design"]
description: ""
---

## What is the Disruptor?
In short: **The Disruptor is a lock-free, bounded ring buffer for passing events between threads, built with mechanical sympathy in mind.** 

Most concurrent systems need to hand work from one thread to another, and the usual tool for that is a *queue*. Queues are simple and correct, but they're slow. Locks, contention and cache misses all add up.

The Disruptor is LMAX's answer to that problem. It's a library for exchanging data between threads that replaces the queue with a **ring buffer** and a few carefully placed **sequence counters**. That gives it three properties a typical queue doesn't have:

- **No locks on the hot path.** Producers and consumers coordinate through sequence numbers, not mutexes.
- **No allocation per message.** Every slot in the ring buffer is created up front and reused.
- **Cache-friendly layout.** The data structures are arranged to keep the CPU's caches happy.

LMAX built it to run a financial exchange that handles millions of orders per second on a single thread. It has since been used well beyond finance, in projects like Log4j 2's async loggers.

Picture a circular conveyor belt with numbered slots. Producers place items into the next free slot, and each consumer walks around the belt behind them, reading slots in order. Nobody waits on a lock. Everyone just keeps track of *which slot number they're on*.

## Background: The LMAX Architecture
To understand why the Disruptor exists, it helps to look at the system it was built for.[^lmax-architecture]

[^lmax-architecture]: Martin Fowler's article [The LMAX Architecture](https://martinfowler.com/articles/lmax.html) (2011) is the best overview of the system as a whole: the Business Logic Processor, event sourcing, and where the Disruptor fits. This section is a condensed version of it.

**LMAX** is a retail financial exchange. Trading platforms live and die by latency: a price that's a few milliseconds stale is a price someone else has already acted on. LMAX needed very high throughput *and* consistently low latency.

### One Thread for All Business Logic

LMAX's most surprising design decision is that all of the business logic runs on a **single thread**, entirely in memory. There's no database in the hot path and no locking, because there's nothing to lock against. This component is called the **Business Logic Processor**, and it handles around **6 million orders per second**.

Running on one thread removes a whole class of problems. There are no race conditions and no deadlocks, and the code reads like ordinary sequential code.

### Surviving a Crash

If all the state lives in memory, what happens when the machine dies? LMAX uses **event sourcing**: every input event is written to a journal and replicated to another machine *before* the Business Logic Processor handles it. The current state can always be rebuilt by replaying those events, starting from the latest snapshot.

### The Real Bottleneck

With the business logic this fast, the slow part becomes everything *around* it. Before an event reaches the Business Logic Processor, it has to be:

- **Received** from the network
- **Journaled** to durable storage
- **Replicated** to a backup node
- **Unmarshalled** into an object the business logic can use

On the way out, results have to be **marshalled** and **published** back to the network. Each of these stages runs on its own thread, so data is constantly moving from one thread to another.

### Where the Disruptor Fits

LMAX first connected these stages with queues, and found that the queues themselves accounted for a large share of the total latency. The Disruptor was built to replace them: one Disruptor on the **input** side, feeding the Business Logic Processor, and one on the **output** side, carrying results back out.

On the input side, the journaler, replicator and unmarshaller don't run one after another. They all read the *same* ring buffer **in parallel**, and the Business Logic Processor only handles an event once all three are done with it. We'll come back to this in [Dependency Graphs](#dependency-graphs).

So what is it about queues that makes them so expensive?

## Why Queues Are Slow

## Mechanical Sympathy
Mechanical sympathy is about writing software that works with the way the hardware actually behaves, not against it.

The term comes from racing driver Jackie Stewart, who said you don't need to be an engineer to be a great driver, but you do need a feel for how the car works. Martin Thompson (one of the Disruptor's authors) borrowed it for software[^mechanical-sympathy]: you'll write much faster code once you understand how the CPU, memory and caches behave underneath your language.

[^mechanical-sympathy]: Martin Thompson's blog, [Mechanical Sympathy](https://mechanical-sympathy.blogspot.com/), is where much of this thinking is written up — including posts on false sharing and other hardware-level performance topics behind the Disruptor's design. Well worth reading alongside this post.

### CPU Caches and Cache Lines

{{< diagram name="cpu-cache-hierarchy" caption="Approximate figures for a modern x86 CPU. Each step away from the core is slower, and main memory is roughly 80× slower than L1." >}}

The above numbers assume a single CPU socket.[^numa]

[^numa]: On multi-socket servers, each socket has its own memory (a NUMA node); reaching the other socket's memory or caches costs noticeably more, which is why low-latency deployments pin related threads to cores on the same socket. I go into how and why in {{< post-link path="posts/cpu-affinity" text="CPU Affinity - Pinning Threads to Cores" >}}.

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
