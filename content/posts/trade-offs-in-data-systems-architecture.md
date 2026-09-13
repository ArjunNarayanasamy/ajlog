---
title: "Trade-offs in Data Systems Architecture"
date: 2026-09-13T10:00:00+00:00
draft: false
tags: []
description: ""
---

> These are my notes and commentary from reading *Designing Data-Intensive Applications* by Martin Kleppmann, not a substitute for it. I'd encourage you to read the book itself for the full treatment.

If the main challenge while developing an application is parallelizing a very large computation, then it is "compute-intensive". If we worry more about things like storing and processing large volumes of data, managing changes to that data, and ensuring consistency in the face of failures and concurrency, then it is "data-intensive".

Such applications are built from a few standard building blocks:

* store data so that they, or another application, can find it later → **databases**
* remember the result of an expensive operation, to speed up reads → **caches**
* let users search data by keyword or filter it in various ways → **search indexes**
* handle a stream of events as they happen, reacting to them in near real-time → **stream processing**
* periodically crunch through a large volume of accumulated data → **batch processing**