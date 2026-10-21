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
A queue looks like the simplest possible data structure: a producer puts things in one end, a consumer takes them out of the other. The cost isn't in the idea. It's in what has to happen to make that safe when two threads touch it at the same time.

The Disruptor paper[^disruptor-paper] breaks this down into a few problems.

[^disruptor-paper]: Martin Thompson et al., [LMAX Disruptor: High performance alternative to bounded queues for exchanging data between concurrent threads](https://lmax-exchange.github.io/disruptor/disruptor.html) (2011). Sections 2 and 3 cover the cost of locks and the problems with queues in detail.

### Locks Are Expensive

Most queues protect their state with a lock. Java's `ArrayBlockingQueue`, for example, uses a single lock for both `put` and `take`, so the producer and consumer are always competing for it.

When a lock is contended, the losing thread can't just wait cheaply. The operating system has to step in, suspend it, and wake it up later. That means a trip into the kernel, a context switch, and very often a cold cache when the thread resumes.

The paper measures how much this costs with a simple experiment: increment a 64-bit counter 500 million times.

| Method                        | Time (ms) | vs. single thread |
|-------------------------------|----------:|------------------:|
| Single thread                 |       300 |                1× |
| Single thread with lock       |    10,000 |              ~33× |
| Two threads with lock         |   224,000 |          **~750×** |
| Single thread with CAS        |     5,700 |              ~19× |
| Two threads with CAS          |    30,000 |             ~100× |
| Single thread, volatile write |     4,700 |              ~16× |

Even an uncontended lock is expensive, and contention makes it dramatically worse. Lock-free compare-and-swap (CAS) is cheaper, but it isn't free once two threads are fighting over the same value.

### Queues Are Almost Always Full or Empty

Producers and consumers rarely run at exactly the same speed. So in practice, a queue spends nearly all its time in one of two states:

- **Empty**: the consumer is faster, and keeps waiting for the producer.
- **Full**: the producer is faster, and keeps waiting for the consumer.

Either way, the two threads are constantly running into each other at the same end of the queue, which is exactly where the lock contention above hurts most.

### Head, Tail and Size Are Shared

Every queue tracks a **head** (where the consumer reads), a **tail** (where the producer writes) and usually a **size**. The producer updates the tail, the consumer updates the head, and both of them touch the size.

These fields are small, so they usually end up next to each other in memory. As we'll see in [Mechanical Sympathy](#mechanical-sympathy), the CPU doesn't move individual variables between cores. It moves whole blocks of memory. So even when the producer and consumer write to *different* fields, they can still end up fighting over the same block, slowing each other down.

### Every Message Creates Garbage

Linked queues such as `LinkedBlockingQueue` allocate a new node object for every message. At millions of messages per second, that's millions of short-lived objects for the garbage collector to clean up, and every GC pause shows up directly as latency.

Those nodes are also scattered across the heap, so walking from one to the next means jumping around in memory instead of reading it in order.

### Adding It Up

A pipeline like LMAX's has a queue between every stage. Each one adds a lock, some contention, a few cache misses and some garbage. None of these costs is huge on its own, but they add up on every message, at every stage.

To see *why* things like shared fields and memory layout matter so much, we need to look at how the hardware actually works.

## Mechanical Sympathy
Mechanical sympathy is about writing software that works with the way the hardware actually behaves, not against it.

The term comes from racing driver Jackie Stewart, who said you don't need to be an engineer to be a great driver, but you do need a feel for how the car works. Martin Thompson (one of the Disruptor's authors) borrowed it for software[^mechanical-sympathy]: you'll write much faster code once you understand how the CPU, memory and caches behave underneath your language.

[^mechanical-sympathy]: Martin Thompson's blog, [Mechanical Sympathy](https://mechanical-sympathy.blogspot.com/), is where much of this thinking is written up — including posts on false sharing and other hardware-level performance topics behind the Disruptor's design. Well worth reading alongside this post.

You don't need to know everything about the hardware to follow the Disruptor. A handful of facts explain almost every design decision in it, and they're the same facts that make queues slow.

### CPU Caches and Cache Lines

A modern CPU can do a simple operation in well under a nanosecond, but fetching data from main memory takes around 80. If the CPU had to wait for memory every time, it would spend most of its time doing nothing. So it keeps copies of recently used memory in small, fast **caches** close to each core.

{{< diagram name="cpu-cache-hierarchy" caption="Approximate figures for a modern x86 CPU. Each step away from the core is slower, and main memory is roughly 80× slower than L1." >}}

The above numbers assume a single CPU socket.[^numa]

[^numa]: On multi-socket servers, each socket has its own memory (a NUMA node); reaching the other socket's memory or caches costs noticeably more, which is why low-latency deployments pin related threads to cores on the same socket. I go into how and why in {{< post-link path="posts/cpu-affinity" text="CPU Affinity - Pinning Threads to Cores" >}}.

Two things about caches matter more than anything else.

**Memory moves in cache lines.** The CPU never fetches a single variable. It fetches the whole 64-byte block around it, called a **cache line**.[^line-size] Read one `long` from an array, and the next seven come along for free.

[^line-size]: 64 bytes is the norm on x86 and most ARM server chips. Apple's M-series chips use 128-byte lines.

**Predictable access is fast.** The CPU watches how you read memory. If you're walking through it in order, a **prefetcher** starts loading the next cache lines before you ask for them. If you're jumping around, it can't guess, and every jump risks a full trip to main memory.

{{< diagram name="memory-locality" caption="An array is read one cache line at a time, and the prefetcher stays ahead. A linked list's nodes can be anywhere on the heap, so every hop may be a separate trip to memory." >}}

This is why a linked queue is slow even before any locking: every node is its own allocation, somewhere on the heap. The Disruptor's ring buffer is the opposite. It's a plain array, allocated once up front, and read in order.

### How Cores Share Data

Each core has its own L1 and L2 caches. That raises a problem: what happens when two cores both have a copy of the same cache line, and one of them writes to it?

The CPU handles this with a **cache coherence protocol** (on x86, a variant of MESI). The details are complicated, but the rule that matters is simple:

> Before a core can write to a cache line, every other core's copy of that line is thrown away.

The next time another core reads that line, it misses its cache and has to fetch the new version, from L3 or from the core that wrote it. That costs tens of nanoseconds instead of one.

So when two cores keep writing to the same cache line, the line bounces back and forth between them, and neither gets the benefit of its cache. This is what *contention* actually looks like at the hardware level, and it happens with or without locks. It's why two threads doing CAS in the [earlier table](#locks-are-expensive) were about 5× slower than one.

### False Sharing

Contention is expected when two threads write the *same* variable. **False sharing** is when they write *different* variables that happen to sit in the same cache line. Neither thread touches the other's data, but the hardware only sees cache lines, so the line bounces between cores anyway.

This is exactly what happens to a queue's head and tail. The producer only writes the tail and the consumer only writes the head, but they're declared next to each other, so they almost always end up in the same cache line.

{{< diagram name="false-sharing" caption="Left: head and tail share one cache line, so every write by one core invalidates the other core's copy. Right: with padding, each lives on its own line and the cores stop interfering." >}}

The fix is **padding**: surround each hot variable with enough unused space that nothing else can share its cache line.

```java
class PaddedCounter {
    long p1, p2, p3, p4, p5, p6, p7;        // 56 bytes before
    volatile long value;
    long p9, p10, p11, p12, p13, p14, p15;  // 56 bytes after
}
```

It looks wasteful, and it is: 120 bytes to store 8. But memory is cheap, and a cache line bouncing between cores millions of times a second is not.[^false-sharing]

[^false-sharing]: Martin Thompson's post [False Sharing](https://mechanical-sympathy.blogspot.com/2011/07/false-sharing.html) measures the effect directly, running the same code with and without padding.

One catch: the JVM is free to rearrange fields within a class, so it could move the padding away from `value`. The Disruptor gets around this by putting the padding in separate parent and child classes, since HotSpot lays out a parent's fields before its child's. Java also has a `@Contended` annotation that pads a field for you, but outside the JDK it only takes effect with the `-XX:-RestrictContended` flag.

Every `Sequence` in the Disruptor is padded this way, so the producer's sequence and each consumer's sequence never share a cache line.

### Memory Barriers

Caches aren't the only surprise. To go faster, both the compiler and the CPU are allowed to **reorder** reads and writes, as long as the result looks the same *to the thread doing them*. Other threads get no such promise.

That's a problem for something like the Disruptor. To publish an event, a producer does two things:

1. Write the event into a slot in the ring buffer.
2. Update the sequence to say the slot is ready.

If those two writes are reordered, a consumer could see the new sequence, read the slot, and get the *old* event.

A **memory barrier** (or fence) prevents this. It tells the compiler and the CPU that operations on one side of it can't be moved to the other side.

{{< diagram name="memory-barrier" caption="The producer's release barrier makes the event visible before the sequence. The consumer's acquire barrier makes sure it only reads the event after it has seen the sequence." >}}

In Java, you get barriers through `volatile` fields and `VarHandle` methods, and they come in different strengths:

- A **volatile write** is the strongest. Nothing can be reordered across it in either direction. That's the ~16× row in the [earlier table](#locks-are-expensive).
- A **release write** (`setRelease`, or the older `lazySet`) only guarantees that earlier writes become visible first. That's exactly what publishing needs, and it's much cheaper. On x86 it compiles down to a plain store.

The Disruptor's `Sequence.set()` uses a release write. Publishing an event costs one cheap barrier, not a lock, not a CAS, and never a trip into the kernel.

### The Single Writer Principle

All of this points to one idea, which Martin Thompson calls the **Single Writer Principle**:[^single-writer]

> If only one thread ever writes to a piece of data, it needs no lock and no CAS.

Contention comes from *multiple writers*. Any number of threads can read a value cheaply, as long as only one thread changes it. All the readers need is a barrier, so they see the writes in the right order.

[^single-writer]: Martin Thompson, [Single Writer Principle](https://mechanical-sympathy.blogspot.com/2011/09/single-writer-principle.html), Mechanical Sympathy, 2011.

The Disruptor is built around this:

- Each consumer's sequence is written only by that consumer.
- With a single producer, the producer's sequence is written only by that producer.
- Each slot in the ring buffer is written only by the producer that claimed it.

The only place that needs an atomic operation is when *several* producers have to agree on who gets the next slot, and even then it's one operation per claim, on one variable. Compare that with a queue, where the size field is written by both the producer and the consumer on every single operation.

### Putting It Together

| Hardware fact | Why queues suffer | What the Disruptor does |
|---|---|---|
| Memory moves in 64-byte cache lines | Head and tail share a line (false sharing) | Pads every sequence onto its own line |
| Reading memory in order is fast | Linked nodes are scattered across the heap | Uses one pre-allocated array |
| Writing a line invalidates other cores' copies | Producer and consumer both write the size field | Gives every variable a single writer |
| Contended locks need the kernel | A contended lock is ~750× slower | Uses no locks on the hot path |
| CPUs and compilers reorder memory operations | Queues rely on locks to keep order | Publishes with one release write |

With these in mind, the Disruptor's components start to look less like clever tricks and more like the obvious way to build it.

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
7. Martin Thompson, [Single Writer Principle](https://mechanical-sympathy.blogspot.com/2011/09/single-writer-principle.html), Mechanical Sympathy, 2011
