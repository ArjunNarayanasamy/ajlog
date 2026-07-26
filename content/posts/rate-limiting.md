---
title: "rate limiting, the basics"
date: 2026-07-26
draft: false
tags: ["systems-design", "backend"]
description: "what to key on, where to enforce it, and the algorithms behind it"
---

Rate limiting sounds simple until you have to actually build one. The concept is one sentence — <span class="accent-em">stop a client from making too many requests</span> — but the decisions underneath it stack up fast.

## what basis do you limit on

Every rate limiter needs a key to count against. The usual candidates:

- **user** — tied to an authenticated account. Fair, but useless against anonymous abuse.
- **IP** — works pre-auth, but NATs and shared IPs punish innocent users, and it's trivial to rotate.
- **unique ID / API key** — the standard for public APIs. One key, one bucket, no ambiguity.

Most real systems layer more than one of these rather than picking a single basis.

## client side vs server side

Client-side limiting (backing off before you send a request) helps UX but enforces nothing — anyone can skip your client and hit the API directly. The enforcement has to live on the server. Client-side throttling is a courtesy; server-side is the actual control.

## middleware, and the API gateway

Rate limiting doesn't have to live inside your application code — it's a natural fit for middleware sitting in front of it. In cloud/microservices setups this is usually the API gateway, which is already doing a pile of cross-cutting things: authentication, SSL termination, IP whitelisting, serving static content, and rate limiting. Putting the limiter there means individual services don't each reinvent it.

## algorithms

- **token bucket** — the canonical algorithm. Bucket fills with tokens at a fixed rate, each request consumes one, request is rejected if the bucket's empty. Allows bursts up to the bucket size.
- **leaky bucket** — the inverse sibling of token bucket. Requests queue up and leak out at a fixed rate, smoothing bursts instead of allowing them.
- **fixed window** — count requests in a fixed time window (e.g. per minute). Simple, but bursts at window boundaries can let through 2x the intended rate.
- **sliding window log** — keep a timestamped log of every request and count how many fall in the trailing window. Accurate, but memory-heavy at scale.
- **sliding window counter** — approximates the sliding window log using weighted counts from the current and previous fixed windows. Good accuracy-to-cost tradeoff, which is why it shows up in most production systems.

Lyft open-sourced their rate limiter, built as an Envoy filter: [github.com/envoyproxy/ratelimit](https://github.com/envoyproxy/ratelimit). Worth a read to see token bucket applied for real.

## distributed rate limiting is the hard version

All of the above gets harder the moment your limiter has to run across multiple nodes instead of one process:

- **race conditions** — two nodes read the same counter, both decide there's room, both allow the request. Now you've let through more than the limit.
- **synchronization** — a shared, consistent view of the counter usually means a shared store (Redis, etc.), which adds latency and a new point of failure to every request.

This is where the algorithm choice starts to matter less than the infrastructure around it.

## rate limiting vs throttling

The two get used interchangeably, but they're not quite the same. Rate limiting is the policy — the rule that caps requests over a window. Throttling is the mechanism's response — delaying, queuing, or slowing down requests instead of outright rejecting them. A rate limiter can throttle instead of reject, but not all throttling is rate-limit-driven.

---

This is a starter — next up is an actual POC with code for a couple of these algorithms.

**further reading**
- [ByteByteGo: Design a Rate Limiter](https://bytebytego.com/courses/system-design-interview/design-a-rate-limiter)
- [AWS: API Gateway request throttling](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-request-throttling.html)
- [Cloudflare: Counting things, a lot of different things](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/)
