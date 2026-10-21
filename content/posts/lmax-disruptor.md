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

The paper measures how much this costs with a simple experiment: increment a 64-bit counter 500 million times, on a 2.4GHz Intel Westmere EP.

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

The Disruptor paper states the requirement: independent variables that are written concurrently must not share a cache line.[^disruptor-paper] It doesn't say how. The usual technique, which Martin Thompson describes on his blog and the Disruptor's source code uses, is **padding**: surround each hot variable with enough unused space that nothing else can share its cache line.

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

If you read [the Disruptor's source](https://github.com/LMAX-Exchange/disruptor/blob/c871ca49826a6be7ada6957f6fbafcfecf7b1f87/src/main/java/com/lmax/disruptor/Sequence.java#L7), you'll see that every `Sequence` is padded this way, so the producer's sequence and each consumer's sequence never share a cache line.

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

The Disruptor's [`Sequence.set()` uses a release write](https://github.com/LMAX-Exchange/disruptor/blob/c871ca49826a6be7ada6957f6fbafcfecf7b1f87/src/main/java/com/lmax/disruptor/Sequence.java#L102). Publishing an event costs one cheap barrier, not a lock, not a CAS, and never a trip into the kernel.

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
The Disruptor is made of a handful of small parts. Each one has a single job, and each one applies an idea from the previous section.

{{< diagram name="disruptor-overview" caption="The producer side (left) claims slots and writes events. The consumer side (right) waits for slots to be ready, reads them, and hands them to your code. The two sides never talk directly: they only watch each other's sequences." >}}

In short:

- The **Ring Buffer** holds the events.
- A **Sequence** is a counter that tracks how far someone has got.
- The **Sequencer** hands out slots to producers and publishes them.
- A **Sequence Barrier** tells a consumer which slots are ready to read.
- A **Wait Strategy** decides what a consumer does while it waits.
- An **Event Processor** is the consumer's thread, and it calls your **Event Handler**.

### Ring Buffer

The [ring buffer](https://github.com/LMAX-Exchange/disruptor/blob/c871ca49826a6be7ada6957f6fbafcfecf7b1f87/src/main/java/com/lmax/disruptor/RingBuffer.java) is the conveyor belt from the start of this post: a fixed-size array whose end wraps around to its beginning.

Two numbers matter here, and it's easy to mix them up:

- **The size of the ring buffer** is how many slots it has. It's small, fixed, and chosen when you create the Disruptor. A few thousand slots is typical.
- **The sequence** is a counter of every event that has *ever* passed through the buffer. It starts at 0 and keeps going up for as long as the program runs.

The sequence is turned into a slot number with `sequence & (size - 1)`. With a buffer of 16 slots:[^buffer-size]

| Sequence | Slot (`sequence & 15`) |
|---:|---:|
| 0 | 0 |
| 15 | 15 |
| 16 | 0 (second lap) |
| 37 | 5 |
| 1,000,005 | 5 |

So the same 16 slots get reused lap after lap, and can carry billions of events. Only the sequence keeps growing.

[^buffer-size]: The 16 slots used in this post's examples and diagram are only to keep them readable. Real buffers are much bigger, and the size must always be a power of two. LMAX's are huge: Martin Fowler's [The LMAX Architecture](https://martinfowler.com/articles/lmax.html) describes "20 million slots for input buffer and 4 million slots for each of the output buffers". Those are round figures; the nearest powers of two are 2²⁴ (about 16.7 million) and 2²² (about 4.2 million). General-purpose uses are far smaller, often between 1,024 and 65,536 slots.

{{< diagram name="ring-buffer" caption="LMAX's input ring buffer, shrunk to 16 slots. One producer, the receiver, writes events; four consumers read the same ring, each at its own position. A slot can only be reused once the slowest consumer, the business logic processor, has read it." >}}

A few design choices make it fast:

- **Every event is created up front.** When you build a ring buffer, you give it an *event factory*, and it fills every slot with an event object straight away. After that, producers never allocate. They take an existing event and overwrite its fields. That's how the Disruptor avoids the garbage problem from [Every Message Creates Garbage](#every-message-creates-garbage).
- **The size must be a power of two.** That way, finding the slot for a sequence is a single bitwise AND, `sequence & (size - 1)`, instead of the slower `%`.
- **Sequences never wrap, only slots do.** A sequence is a 64-bit `long` that only ever goes up, and it's large enough that it will never overflow in practice. Even at a billion events per second, that would take around 292 years. So the Disruptor never has to handle a sequence wrapping back round, which keeps every comparison between sequences a simple "is this number bigger than that one?".[^sequence-overflow]
- **It doesn't track who is where.** A queue keeps its own head and tail. The ring buffer is just storage. Producer and consumer positions live in separate Sequences, each on its own cache line, so there's no shared head, tail or size to fight over.
- **Even the array is padded.** The ring buffer allocates 32 extra slots at each end of its array (`BUFFER_PAD`) and never uses them, so the first and last slots can't share a cache line with some unrelated object.

[^sequence-overflow]: The largest value a Java `long` can hold is 2⁶³ − 1 = 9,223,372,036,854,775,807, or about 9.2 quintillion. Adding 1 to it *overflows*: the value wraps around to a large negative number, and a check like "has the consumer passed sequence 14?" would give the wrong answer. The sequence goes up by 1 per event, so at a billion events per second, reaching that limit takes about 9.2 billion seconds. With around 31.5 million seconds in a year, that's roughly 292 years. At LMAX's real rate of about 6 million orders per second, it's nearer 48,000 years.

### Sequence

A [Sequence](https://github.com/LMAX-Exchange/disruptor/blob/c871ca49826a6be7ada6957f6fbafcfecf7b1f87/src/main/java/com/lmax/disruptor/Sequence.java) is the padded `long` we saw in [False Sharing](#false-sharing), with the release write from [Memory Barriers](#memory-barriers).

Every participant owns one:

- The producer side has the **cursor**: the highest sequence that has been published. (With several producers, it's the highest one *claimed*. More on that below.)
- Each consumer has its own sequence: the highest sequence it has finished processing.

Each Sequence has exactly one writer, following the [Single Writer Principle](#the-single-writer-principle). Everyone else only reads it. This is the whole coordination mechanism: no thread ever tells another thread anything. They just watch each other's Sequences.

### Sequencer

The **Sequencer** is the producer's side of the coordination. It does two jobs:

1. **Claim** a slot for the producer to write into (`next()`).
2. **Publish** that slot once the event is written, so consumers can see it (`publish()`).

Before it hands out a slot, the Sequencer has to make sure the producer won't lap the slowest consumer and overwrite an event nobody has read yet. To do this, it watches the consumers' Sequences, which it calls **gating sequences**. If the buffer is full, the producer waits.

This is where the buffer size and the sequence meet. The producer's sequence can be at most *one buffer size* ahead of the slowest consumer's. In the [ring buffer diagram](#ring-buffer), the slowest consumer, the business logic processor, is at 31. With 16 slots, the receiver can claim up to 47 (31 + 16), but not 48, because 48 would land in slot 0 (`48 & 15`), which still holds 32, an event the business logic processor hasn't read yet.

There are two Sequencers, depending on how many threads publish.

**[`SingleProducerSequencer`](https://github.com/LMAX-Exchange/disruptor/blob/c871ca49826a6be7ada6957f6fbafcfecf7b1f87/src/main/java/com/lmax/disruptor/SingleProducerSequencer.java)**, for one producer thread. Because only one thread ever claims slots, claiming is just adding to a plain `long` field. Publishing is a single release write to the cursor. There's no CAS and no atomic operation at all.

It also has a small mechanical sympathy trick. Checking the consumers' Sequences means reading cache lines that other cores keep writing to, which is expensive. So the Sequencer remembers the slowest consumer's position from last time (`cachedValue`). As long as there's room before that position, it doesn't look at the consumers' Sequences at all.

**[`MultiProducerSequencer`](https://github.com/LMAX-Exchange/disruptor/blob/c871ca49826a6be7ada6957f6fbafcfecf7b1f87/src/main/java/com/lmax/disruptor/MultiProducerSequencer.java)**, for several producer threads. Now producers have to agree on who gets which slot, so claiming uses one atomic operation on the cursor (`getAndAdd`).

That creates a new problem. Producer A might claim slot 10 and producer B slot 11, but B could finish writing first. The cursor already says 11, so it can't be used to mean "published" any more. Instead, the Sequencer keeps an extra array, `availableBuffer`, with one flag per slot. Each producer marks its own slot as available when it's done, and consumers check those flags to find the highest *contiguous* published sequence.

So a single producer is noticeably cheaper. If your design allows it, use one.

### Sequence Barrier

The [Sequence Barrier](https://github.com/LMAX-Exchange/disruptor/blob/c871ca49826a6be7ada6957f6fbafcfecf7b1f87/src/main/java/com/lmax/disruptor/ProcessingSequenceBarrier.java) is the consumer's side of the coordination. A consumer asks it one question: *"I want sequence N. What's the highest sequence I can safely read?"* That's its `waitFor()` method.

To answer, the barrier watches two things:

- **The producer's cursor**, so the consumer never reads a slot before it's published.
- **The Sequences of any consumers this one depends on.** If the unmarshaller must run after the journaler, the unmarshaller's barrier also watches the journaler's Sequence. This is how the Disruptor builds pipelines without extra queues, and we'll come back to it in [Dependency Graphs](#dependency-graphs).

The answer isn't always N. If the consumer asks for 10 and the producer has already published up to 42, the barrier returns 42. The consumer can then process all 33 events in one go, without coordinating again for each one.

This **batching** is one of the Disruptor's most important properties, and it's easy to miss. When a consumer falls behind, each call to the barrier returns a bigger batch, so the cost of coordination is spread over more events. A queue does the opposite: the busier it gets, the more contention every operation faces.

### Wait Strategies

When a consumer asks for a sequence that isn't published yet, it has to wait. **How** it waits is a trade-off between latency and CPU use, and the Disruptor makes it a choice:

| Strategy | Latency | CPU use | Good for |
|---|---|---|---|
| `BusySpinWaitStrategy` | Lowest | A full core, always | Threads pinned to their own cores |
| `YieldingWaitStrategy` | Very low | High | Low latency, with spare cores |
| `SleepingWaitStrategy` | Higher | Low | Background work, such as logging |
| `BlockingWaitStrategy` | Highest | Lowest | When CPU matters more than latency |

The strategies further up the table keep the consumer running and checking. They react in nanoseconds, but they never give the core back. The ones further down hand the core back to the operating system, which costs microseconds to wake up from.

Two things worth knowing:

- **`BlockingWaitStrategy` really does use a lock**, and the producer has to signal waiting consumers when it publishes. This is why the definition at the start of this post says lock-free on the *hot path*. Pick a blocking strategy and you've brought a lock back in.
- **Busy-spinning only makes sense on a dedicated core.** If the spinning thread shares a core with other work, it just steals time from it. I cover how to give a thread its own core in {{< post-link path="posts/cpu-affinity" text="CPU Affinity - Pinning Threads to Cores" >}}.

The library has a few more variants, such as timeout and phased backoff strategies, but they're all combinations of the same trade-off.

### Event Processors and Event Handlers

An **Event Handler** is your code. It's an interface with one main method:

```java
void onEvent(T event, long sequence, boolean endOfBatch)
```

An **Event Processor** is the loop that runs it. The usual one, [`BatchEventProcessor`](https://github.com/LMAX-Exchange/disruptor/blob/c871ca49826a6be7ada6957f6fbafcfecf7b1f87/src/main/java/com/lmax/disruptor/BatchEventProcessor.java), owns a thread and a Sequence, and repeats three steps:

1. Ask the barrier which sequences are available.
2. Call `onEvent()` for each event in that batch.
3. Update its own Sequence to the end of the batch.

Notice that step 3 happens once per *batch*, not once per event. The consumer only writes to its Sequence, and makes that cache line visible to other cores, once for the whole batch.

The **`endOfBatch`** flag tells your handler when it's looking at the last event in the batch. That matters for anything that's cheaper to do in bulk. LMAX's journaler is the classic example: instead of writing every event to disk one at a time, it can collect the batch and flush once when `endOfBatch` is `true`.

### Putting It Together

| Component | What it does | Idea it applies |
|---|---|---|
| Ring Buffer | Stores events in a pre-allocated array | Sequential access, no garbage |
| Sequence | Tracks progress as a padded counter | No false sharing, single writer |
| Sequencer | Claims and publishes slots | Single writer, release writes |
| Sequence Barrier | Tells a consumer what's ready | Batching, no locks |
| Wait Strategy | Decides how a consumer waits | Latency versus CPU, your choice |
| Event Processor | Runs your handler on its own thread | One Sequence write per batch |

## Publishing an Event
Publishing is a **two-phase** operation. A producer doesn't hand the Disruptor a new event. It claims a slot, writes into the event object that's already there, and only then makes it visible:

```java
long sequence = ringBuffer.next();          // 1. claim
try {
    OrderEvent event = ringBuffer.get(sequence);
    event.set(price, quantity);             // 2. write in place
} finally {
    ringBuffer.publish(sequence);           // 3. publish
}
```

This is the pattern from the Disruptor's own documentation. Each step has a reason:

- **Claim first**, because the producer needs to know *which* slot is safe to write to: one the slowest consumer has already read.
- **Write in place**, because every slot already holds a pre-allocated event. Allocating a new one would bring back the garbage problem.
- **Publish last**, because consumers must never see a half-written event. Publishing is what tells them the slot is ready.

Here are the same three steps on the ring buffer from earlier, with a single producer (the receiver) publishing sequence 38:

{{< diagram name="publishing-steps" caption="Claiming slot 6 doesn't make it visible. The event is written while the cursor still says 37, and only the publish, a single release write, moves the cursor to 38." >}}

The `finally` block matters. If a producer claims a slot and then throws an exception before publishing it, the cursor never moves past that sequence, and every consumer waits on it forever. Always publish what you claim.

### Publishing in Batches

If a producer has several events ready at once, it doesn't need to repeat the three steps for each one. It can claim a whole range of slots in one go:

```java
int n = 4;
long hi = ringBuffer.next(n);               // claim 4 slots at once
long lo = hi - (n - 1);
try {
    for (long sequence = lo; sequence <= hi; sequence++) {
        ringBuffer.get(sequence).set(...);  // write each event
    }
} finally {
    ringBuffer.publish(lo, hi);             // publish them all together
}
```

`next(n)` returns the *highest* sequence it claimed, so the batch runs from `hi - (n - 1)` to `hi`.

This is cheaper because the coordination happens once per batch, not once per event:

- **One claim** checks for room for all `n` slots at once.
- **One publish** makes them all visible. With a single producer, [`publish(lo, hi)`](https://github.com/LMAX-Exchange/disruptor/blob/c871ca49826a6be7ada6957f6fbafcfecf7b1f87/src/main/java/com/lmax/disruptor/SingleProducerSequencer.java) simply calls `publish(hi)`: a single release write to the cursor, however many events are in the batch.

It's the producer's version of the batching we saw in the [Sequence Barrier](#sequence-barrier). Consumers catch up by reading many events per coordination, and producers can publish many events per coordination.

## Consuming Events
On the consumer side, you don't write a loop or manage a thread. You write an **Event Handler**, and an [Event Processor](#event-processors-and-event-handlers) calls it for every event, in order. Here's a simple journaler:

```java
public class JournalHandler implements EventHandler<OrderEvent> {
    @Override
    public void onEvent(OrderEvent event, long sequence, boolean endOfBatch) throws Throwable {
        journal.append(event);
        if (endOfBatch) {
            journal.flush();    // one disk flush per batch, not per event
        }
    }
}
```

The Disruptor's documentation is firm about that `endOfBatch` check: implementations should always do their work when `endOfBatch` is `true`, because the time until the next event is unpredictable. If the journaler waited for, say, 100 events before flushing, the last few events of a quiet period could sit unflushed indefinitely.

### Each Consumer Gets Its Own Batch

What a consumer gets each time round its loop depends on what its barrier is watching. Here's the ring buffer from earlier again, with the same four consumers:[^positions-not-addresses]

{{< diagram name="consuming-batches" caption="Both consumers ask for their next sequence, but get different batches. The business logic processor has to stay behind the three consumers it depends on, while the unmarshaller only has to stay behind the receiver." >}}

The **business logic processor** has finished 31, so it asks its barrier for 32. Its barrier watches the cursor *and* the three consumers it depends on, and it returns the lowest of them: 33, held back by the replicator. So the business logic processor handles 32 and 33 as one batch, with `endOfBatch` set on 33, and then sets its own Sequence to 33.

The **unmarshaller** has no dependencies, so its barrier only watches the cursor. It asks for 36, gets 37, and handles a batch of two.

Neither consumer waited for the other, and neither took a lock. Each one read a few Sequences and got on with its work.

[^positions-not-addresses]: It might look as if the consumers at 33, 34 and 35 are crowded onto the same cache line. They aren't. Those numbers are the *values* held in three separate Sequences, and each Sequence is [padded](#false-sharing) onto its own cache line, so when the journaler moves from 34 to 35, it writes only to its own line. The events themselves are mostly *read* by consumers, and any number of cores can hold copies of a line that nobody is writing. The one line that really does move between cores is an event the producer has just written and a consumer then reads. That's true sharing, and it can't be avoided: it's how the message gets from one thread to the other.

### Don't Hold On to Events

The `event` passed to `onEvent()` isn't yours to keep. It's the object that lives in that slot, and once every consumer has moved past it, the producer will claim the slot on its next lap and overwrite it.

So if a handler needs the data later, for example to keep an order in an order book, it should **copy the fields it needs** during `onEvent()`, never store a reference to the event itself. A stored reference would quietly change under you, one lap later, into a completely different event.

## Dependency Graphs
Consumers don't have to be independent. Some can run in parallel while others wait for them to finish. LMAX's input stage is the classic example: the journaler, replicator and unmarshaller can run in any order, but all of them must be done before the business logic processor touches a message.[^lmax-architecture]

{{< diagram name="dependency-graph" caption="The same four stages, wired two ways. With queues, every arrow between stages needs its own queue. With the Disruptor, there's one ring buffer, and each dependency is just one consumer watching another's Sequence." >}}

Built from queues, this takes six of them, each with the locks, contention and garbage from [Why Queues Are Slow](#why-queues-are-slow), and the business logic processor has to match up the same message from three different queues. With the Disruptor, the receiver writes each event **once**, and it never moves. The parallel stages read the same slots, and the business logic processor's dependency on them is just its [Sequence Barrier](#sequence-barrier) watching their three Sequences. In Fowler's words, the "network of queues is really a single data structure - a ring buffer."[^consumers-write]

[^consumers-write]: Consumers can even write to events. LMAX's unmarshaller stores the decoded message back into the event for the business logic processor to use. Fowler's rule is that "each writable field can only have one parallel consumer that's allowed to write to it": the [Single Writer Principle](#the-single-writer-principle), applied to fields.

## Code Example
I've put a small, runnable example on GitHub: [lmax_disruptor](https://github.com/ArjunNarayanasamy/lmax_disruptor). It recreates LMAX's input stage from this post. A receiver publishes orders, the journaler, replicator and unmarshaller handle them in parallel, and the business logic processor runs after all three. It uses the same 16-slot ring as the diagrams, so the sequence and slot numbers in its output line up with them.

It needs Java 17 and Maven, and runs with one command:

```
mvn -q compile exec:java
```

### The Wiring

The whole setup fits in a few lines ([App.java](https://github.com/ArjunNarayanasamy/lmax_disruptor/blob/817d78475da2c61b5326e32f65828d188a30b4c5/src/main/java/dev/ajlog/disruptor/App.java#L120-L140), trimmed slightly here):

```java
Disruptor<OrderEvent> disruptor = new Disruptor<>(
    OrderEvent::new,                // pre-allocates every event up front
    16,                             // ring size: a power of two
    DaemonThreadFactory.INSTANCE,
    ProducerType.SINGLE,            // one producer, so claiming needs no CAS
    waitStrategy);                  // blocking by default, or --wait=busy etc.

disruptor.handleEventsWith(journal, replication, unmarshal)
         .then(businessLogic);

RingBuffer<OrderEvent> ringBuffer = disruptor.start();
```

Almost every argument is a decision from an earlier section: the event factory from [Ring Buffer](#ring-buffer), the single producer from [Sequencer](#sequencer), the [wait strategy](#wait-strategies), and the [dependency graph](#dependency-graphs) in a single line.

### What the Output Shows

Every handler logs what it does, so the output shows the ideas from this post as they happen. The excerpts below are from real runs, with lines removed only where `...` appears.

**Events are reused, lap after lap.** Sequences 5, 21 and 37 all map to slot 5, and all three use the same event object:

```
slot 5 reuse : [seq 5 -> obj=@73b83403, seq 21 -> obj=@73b83403, seq 37 -> obj=@73b83403] ... all 3 uses were the same object: true
```

**Consumers batch.** The journaler reached the end of a batch of 7 and flushed once for all of them, and the business logic processor picked up 7 events in one go:

```
[journaler] JOURNAL   seq=7   slot=7  endOfBatch=true
[journaler] JOURNAL   flush: 7 event(s) written in one flush
...
[business] BUSINESS  onBatchStart batchSize=7 queueDepth=7
```

Over the whole run, 40 events went to the journal in 20 flushes.

**A full ring makes the producer wait.** With `--slow-consumer`, the business logic processor sleeps 50 ms per event, and the ring soon fills up:

```
[business] BUSINESS  onBatchStart batchSize=15 queueDepth=15
...
[receiver] RECEIVER  remainingCapacity=0 -> ring full, producer must wait for business logic to free a slot
...
[receiver] RECEIVER  waited 946.8 ms for a free slot
[receiver] RECEIVER  remainingCapacity=14
```

Notice that the producer waited around 950 ms, not 50 ms. The business logic processor took a batch of 15 events, and an event processor only moves its Sequence forward at the *end* of a batch. So no slot was freed until all 15 events were done, about 15 × 50 ms later, and then 14 slots became free at once. Batching makes consumers efficient, but it also means a slow consumer frees space in large, late steps.

**The dependency graph holds.** The business logic handler throws if an event reaches it before the other three have finished with it. Across 80 runs of 10,000 events, 20 for each wait strategy, that never happened once.

The [README](https://github.com/ArjunNarayanasamy/lmax_disruptor#matching-the-output-to-the-post) has the full list of what to look for, longer output, and the other flags, including `--gotcha`, which shows a [held reference to an event](#dont-hold-on-to-events) turning into a different order one lap later.

## Performance
The Disruptor paper[^disruptor-paper] compares it against `ArrayBlockingQueue` across five shapes of consumer graph:

- **Unicast** (1P–1C): one producer, one consumer.
- **Pipeline** (1P–3C): three consumers in a chain.
- **Sequencer** (3P–1C): three producers, one consumer.
- **Multicast** (1P–3C): three consumers, each seeing every event, in parallel.
- **Diamond** (1P–3C): two consumers in parallel, then a third after both. It's the shape of LMAX's [input stage](#dependency-graphs), with two parallel stages instead of three.

### Throughput

The paper's most recent results, run on an AMD EPYC 9374F with OpenJDK 11, include Disruptor 4, the version used in the [code example](#code-example):

| Test | ArrayBlockingQueue (ops/s) | Disruptor 4 (ops/s) | Speed-up |
|---|---:|---:|---:|
| Unicast: 1P–1C | 20,895,148 | 160,359,204 | ~7.7× |
| Pipeline: 1P–3C | 5,216,647 | 101,317,122 | ~19× |
| Sequencer: 3P–1C | 18,791,340 | 29,726,516 | ~1.6× |
| Multicast: 1P–3C | 2,355,379 | 70,018,204 | ~30× |
| Diamond: 1P–3C | 3,433,665 | 63,123,343 | ~18× |

The original 2011 results, on much older Intel hardware and Java 6, show the same pattern. For example, unicast ran at about 26 million ops/s against 5.3 million for the queue.

The interesting part isn't the size of the numbers. It's **where** the gains are:

- **The biggest gains are in multicast, pipeline and diamond**, 18–30×. These are the shapes where a queue-based design needs several queues, and the Disruptor still needs only one ring buffer.
- **The smallest gain is with three producers**, only about 1.6×. On the same machine, the older Disruptor 3 was actually *slower* than `ArrayBlockingQueue` in this test (16.0 million ops/s against 18.8 million). Several producers have to agree on who claims each slot, and that's exactly the cost the [Single Writer Principle](#the-single-writer-principle) avoids.

### Latency

Throughput is only half the story. For a trading system, what matters just as much is how *consistent* the latency is. The paper measured latency through a three-stage pipeline:

| | ArrayBlockingQueue | Disruptor |
|---|---:|---:|
| Mean | 32,757 ns | 52 ns |
| 99% under | 2,097,152 ns | 128 ns |
| 99.99% under | 4,194,304 ns | 8,192 ns |

The mean is around 600× better, but look at the 99th percentile. One message in a hundred took more than **2 milliseconds** through the queues, against **128 nanoseconds** through the Disruptor. That's the "far more predictable" from the start of this post. A system built on queues is fast *on average* and occasionally very slow, and in a trading system, the occasional very slow message is the one that costs money.

### A Word of Caution

These are the authors' own benchmarks. The latency figures come from 2011 hardware and JVMs, without pinning threads to cores, and `ArrayBlockingQueue` is a lock-based baseline, not the fastest queue available today. Lock-free queues, such as those in the JCTools library, are a much tougher comparison. Treat these numbers as a picture of *why* the design is fast, not as a promise for your workload, and measure your own.

## When to Use It (and When Not To)
The Disruptor solves a specific problem very well: passing data between threads, inside one process, as fast and as predictably as possible. Outside that problem, it's often more machinery than you need.

### A Good Fit

- **Very fast handoff between threads,** where both latency and *consistent* latency matter. Trading engines, market data feeds and order gateways are the classic cases.
- **Several stages working on the same events.** Journaling, replicating and processing the same message is where the [benchmarks](#throughput) show the biggest gains, because every stage reads one ring buffer instead of its own queue.
- **A single writer at the core.** It suits designs like LMAX's, where one thread owns the business logic and everything else feeds it or reads from it.
- **Bursty traffic.** [Batching](#sequence-barrier) lets consumers catch up after a spike, instead of slowing down under it.

Log4j 2's async loggers are a good everyday example: application threads hand log events to a background thread through a Disruptor, so logging doesn't slow down the code that logs.

### Not a Good Fit

- **Between processes or machines.** The Disruptor only works inside one JVM. Across processes or a network, you need a messaging system, such as Kafka, or Aeron (also from Martin Thompson) for low latency.
- **Low message rates.** At thousands of messages per second rather than millions, a plain `BlockingQueue` is simpler and more than fast enough.
- **Work queues.** If each task should go to just *one* of several workers, the Disruptor is the wrong shape: every handler sees every event. Version 4 removed its worker pool, so you'd have to split the work yourself, for example by having each handler take only the sequences where `sequence % n` matches its number.
- **Many producers and little else.** With three producers and one consumer, the gain over a queue was [only about 1.6×](#throughput).
- **Handlers that block on slow I/O.** A consumer that stalls holds up every consumer behind it in the graph and, once the ring fills, the producer too. The [`--slow-consumer` run](#what-the-output-shows) shows this happening.
- **No spare cores.** The lowest-latency [wait strategies](#wait-strategies) keep a core busy all the time. On a shared machine, or in a container with a CPU limit, that core isn't really yours.

### A Quick Checklist

The Disruptor is worth considering if you can answer yes to most of these:

1. Is the data passed between threads in the **same process**?
2. Are you handling **hundreds of thousands to millions** of events per second?
3. Do **latency spikes** actually cost you something?
4. Do **several stages** need to see every event?
5. Can you arrange for a **single producer**, or close to it?

If not, start with a queue. You can always switch later, once you've measured that the queue is the bottleneck.

## Trade-offs
The Disruptor's speed isn't free. These are the costs you accept when you use it.

**Memory is paid up front.** Every slot and every event is allocated at startup, and the ring can never grow. You have to size it for your worst burst, roughly *peak arrival rate × longest consumer pause*, and pay for that memory all the time.

**Low latency burns CPU.** The fastest [wait strategies](#wait-strategies) keep a core at 100% even when nothing is happening, and every handler gets its own thread. Four busy-spinning consumers means four cores that do nothing else.

**The slowest consumer sets the pace.** Stages aren't isolated. One slow consumer holds back everything after it and, once the ring fills, the producer too. Batching makes this worse in one way: slots are freed only at the end of a batch, so a slow consumer releases space in large, late steps. That's why the producer in the [code example](#what-the-output-shows) waited around 950 ms, not 50 ms.

**A full ring means waiting or losing data.** A bounded buffer can't absorb everything, so you decide what happens when it's full. `next()` blocks the producer, which pushes back on whoever is sending. `tryNext()` and `tryPublishEvent()` fail immediately instead, so you can reject or drop the event. In a trading system, rejecting an order quickly is usually better than accepting it late.

**Reused events need discipline.** Never keep a reference to an event, clear every field each time you reuse one, and keep to one writer per field. Get any of these wrong and nothing throws. You just quietly read the wrong data.

**Exceptions need a plan.** By default, an exception in a handler is logged and re-thrown, which stops that consumer. Its Sequence stops moving, so the stages after it stop too and, once the ring fills, so does the producer. Set your own exception handler, as the code example does, and decide what a failure should mean.

**There are more moving parts.** Sequences, barriers, wait strategies and gating are a lot more to understand than `put()` and `take()`. With no locks to inspect and work spread over several threads, it's also harder to debug.

**Mechanical sympathy is tied to the hardware.** The padding assumes 64-byte cache lines, while Apple's M-series chips use 128. The field-ordering trick relies on how HotSpot lays out objects. The design is tuned for today's CPUs and JVMs, and its advantages can shift as they change.

| You get | You pay |
|---|---|
| No garbage per message | Memory allocated up front, at a fixed size |
| Nanosecond wake-ups | Cores kept busy all the time |
| Batching under load | Slots freed late, in big steps |
| Bounded memory | Choosing between waiting and losing data |
| No locks, no copying | Discipline about reused, mutable events |

## Wrapping Up
A queue is the obvious way to pass data between threads, and it turns out to be slow for reasons that have little to do with the idea of a queue. Locks need the kernel, shared head and tail fields fight over cache lines, and every message leaves garbage behind.

The Disruptor keeps the idea and rebuilds it around the hardware. A pre-allocated ring buffer replaces linked nodes. Padded sequences, each with a single writer, replace locks. Barriers let consumers wait on each other without any queues in between, so every stage of a pipeline reads one shared buffer. None of these ideas is complicated on its own. The speed comes from applying all of them together.

Even if you never use the Disruptor itself, the way of thinking behind it is worth keeping: find out what the hardware is actually doing, and design so that it doesn't have to fight you.

{{< source-disclaimer >}}

## References

1. Martin Thompson, Dave Farley, Michael Barker, Patricia Gee & Andrew Stewart, [LMAX Disruptor: High performance alternative to bounded queues for exchanging data between concurrent threads](https://lmax-exchange.github.io/disruptor/disruptor.html), 2011
2. Martin Fowler, [The LMAX Architecture](https://martinfowler.com/articles/lmax.html), 2011
3. [LMAX Disruptor User Guide](https://lmax-exchange.github.io/disruptor/user-guide/index.html)
4. [LMAX Disruptor on GitHub](https://github.com/LMAX-Exchange/disruptor)
5. Martin Thompson, [False Sharing](https://mechanical-sympathy.blogspot.com/2011/07/false-sharing.html), Mechanical Sympathy, 2011
6. Martin Thompson, [Mechanical Sympathy](https://mechanical-sympathy.blogspot.com/) (blog)
7. Martin Thompson, [Single Writer Principle](https://mechanical-sympathy.blogspot.com/2011/09/single-writer-principle.html), Mechanical Sympathy, 2011

### Talks

If you'd like to dig deeper, these talks are a good next step:

- Trisha Gee & Mike Barker, [Understanding the Disruptor, a Beginner's Guide to Hardcore Concurrency](https://www.youtube.com/watch?v=DCdGlxBbKU4&t=1032s), JAX Conference. Both are co-authors of the Disruptor paper.
- [Concurrent Programming with the Disruptor](https://www.youtube.com/watch?v=o_nXgoTxBsQ&list=PLbrWUv-2WQG3kxOoJPnIqXqLZcrj1-mj1), Linux Conference
