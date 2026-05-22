---
title: "REST vs GraphQL"
date: 2026-05-02
draft: false
---

GraphQL solves real problems: over-fetching, under-fetching, and the need for multiple round-trips to assemble a view. If your clients have wildly different data needs, GraphQL is genuinely better.

For most APIs, REST is fine. The endpoints map to your resources, the verbs do what they say, caching works out of the box.

The thing that gets people in trouble: picking GraphQL because it seems more modern, then discovering that N+1 query problems don't go away — they just move from your client to your resolver layer.

Pick the thing that fits the problem. GraphQL is a good answer to a specific question. Make sure you're asking that question.
