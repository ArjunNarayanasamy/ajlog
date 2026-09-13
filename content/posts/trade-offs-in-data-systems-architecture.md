---
title: "Data Systems - Architecture and Tradeoffs "
date: 2026-09-13T10:00:00+00:00
draft: false
tags: []
description: ""
---

{{< source-disclaimer >}}

If the main challenge while developing an application is parallelizing a very large computation, then it is "compute-intensive". If we worry more about things like storing and processing large volumes of data, managing changes to that data, and ensuring consistency in the face of failures and concurrency, then it is "data-intensive".

Such applications are built from a few standard building blocks:

* store data so that they, or another application, can find it later → **databases**
* remember the result of an expensive operation, to speed up reads → **caches**
* let users search data by keyword or filter it in various ways → **search indexes**
* handle a stream of events as they happen, reacting to them in near real-time → **stream processing**
* periodically crunch through a large volume of accumulated data → **batch processing**

## Operational vs Analytical Systems

* **Operational systems** are the backend services and data infrastructure where data is *created*. They typically look up a small number of records by a key (a *point query*), inserting, updating, or deleting records as a result of a user's actions — this is the **OLTP** (*Online Transaction Processing*) pattern.
* **Analytical systems** serve the needs of business analysts and data scientists. They hold a *read-only* copy of the data from operational systems, optimized for **BI** (*business intelligence*) — helping management decide what to do next. An analytical query scans over a huge number of records to compute aggregate statistics, rather than looking up a single one — this is the **OLAP** (*Online Analytical Processing*) pattern.

The two are usually kept separate, and for good reason — their query patterns, performance needs, and failure tolerances are fundamentally different.

## Data Warehousing

Initially, OLTP databases were used for both transaction processing and analytical queries — SQL turned out to be flexible enough for both. But by the *1990s*, a trend emerged: companies stopped running analytics directly on OLTP systems and moved it to a separate database system instead, called a **data warehouse**.

A large enterprise may have dozens, even hundreds, of OLTP systems — inventory, POS, admin, CRM — each operating separately. For an analyst, this creates real friction:

* the data of interest is spread across multiple operational systems, making a single query difficult
* schemas and data layouts differ between systems
* analytical queries can be expensive, and running them directly against operational systems risks hurting their performance

A **data warehouse**, by contrast, is a separate database that analysts can query freely, holding a *read-only* copy of data pulled from the various OLTP systems. Data is extracted from operational systems, transformed into an analytics-friendly schema, cleaned up, and loaded into the warehouse — a process known as **ETL** (*Extract, Transform, Load*).

## Data Lake

A **data warehouse** uses a relational data model, queried with SQL — well suited to an analyst's queries, but less suited to the kind of transformations a *data scientist* needs. Training an ML model, for instance, means turning rows and columns into a *vector* or *matrix* of numerical values called **features** — and the same friction shows up in **NLP** (*Natural Language Processing*) or extracting structured information from photos via *computer vision*.

To meet this need, organizations turned to the **data lake**: a centralized repository for data pulled from operational systems via ETL, stored as simple files without imposing any particular file format or data model. It holds data in its *raw* form, and is also cheaper to run than relational storage.

![Data Lake](/images/datalake.png)
*Diagram via Martin Fowler's [Data Lake](https://martinfowler.com/bliki/DataLake.html)*

## References

1. Martin Kleppmann, *Designing Data-Intensive Applications*
2. Martin Fowler, [Data Lake](https://martinfowler.com/bliki/DataLake.html)
3. Matt Bornstein, Jennifer Li & Martin Casado, [Emerging Architectures for Modern Data Infrastructure](https://a16z.com/emerging-architectures-for-modern-data-infrastructure/)
