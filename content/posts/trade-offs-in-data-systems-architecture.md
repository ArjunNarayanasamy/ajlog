---
title: "Data Systems - Architecture and Tradeoffs "
date: 2026-09-13T10:00:00+00:00
draft: false
tags: ["databases", "architecture", "systems-design", "distributed-systems"]
description: "The core trade-offs behind modern data architecture: OLTP vs OLAP, warehouses, lakes, lakehouses, cloud-native design, and when not to distribute."
---

If the main challenge while developing an application is parallelizing a very large computation, then it is "compute-intensive". If we worry more about things like storing and processing large volumes of data, managing changes to that data, and ensuring consistency in the face of failures and concurrency, then it is "data-intensive".

Such applications are built from a few standard building blocks:

* store data so that they, or another application, can find it later → **databases**
* remember the result of an expensive operation, to speed up reads → **caches**
* let users search data by keyword or filter it in various ways → **search indexes**
* handle a stream of events as they happen, reacting to them in near real-time → **stream processing**
* periodically crunch through a large volume of accumulated data → **batch processing**

None of these come for free. Every architectural choice in a data system — where data lives, how it's stored, who owns it, where it runs — is a **trade-off**. This post walks through the big ones.

## Operational vs Analytical Systems

* **Operational systems** are the backend services and data infrastructure where data is *created*. They typically look up a small number of records by a key (a *point query*), inserting, updating, or deleting records as a result of a user's actions — this is the **OLTP** (*Online Transaction Processing*) pattern.
* **Analytical systems** serve the needs of business analysts and data scientists. They hold a *read-only* copy of the data from operational systems, optimized for **BI** (*business intelligence*) — helping management decide what to do next. An analytical query scans over a huge number of records to compute aggregate statistics, rather than looking up a single one — this is the **OLAP** (*Online Analytical Processing*) pattern.

| | **Operational (OLTP)** | **Analytical (OLAP)** |
|---|---|---|
| Main read pattern | point queries, fetch records by key | aggregate over a large number of records |
| Main write pattern | create, update, delete individual records | bulk import (ETL) or event stream |
| Typical user | end user, via the application | internal analyst, for decision support |
| Data represents | *latest state* of the data | *history* of events over time |
| Dataset size | gigabytes to terabytes | terabytes to petabytes |

The two are usually kept separate, and for good reason — their query patterns, performance needs, and failure tolerances are fundamentally different.

## Data Warehousing

Initially, OLTP databases were used for both transaction processing and analytical queries — SQL turned out to be flexible enough for both. But by the *1990s*, a trend emerged: companies stopped running analytics directly on OLTP systems and moved it to a separate database system instead, called a **data warehouse**.

A large enterprise may have dozens, even hundreds, of OLTP systems — inventory, POS, admin, CRM — each operating separately. For an analyst, this creates real friction:

* the data of interest is spread across multiple operational systems, making a single query difficult
* schemas and data layouts differ between systems
* analytical queries can be expensive, and running them directly against operational systems risks hurting their performance

A **data warehouse**, by contrast, is a separate database that analysts can query freely, holding a *read-only* copy of data pulled from the various OLTP systems. Data is extracted from operational systems, transformed into an analytics-friendly schema, cleaned up, and loaded into the warehouse — a process known as **ETL** (*Extract, Transform, Load*).

Inside the warehouse, data is typically modelled as a **star schema**: a central *fact table* where each row is an event (a sale, a click), surrounded by *dimension tables* describing the who, what, where and when. Chaudhuri and Dayal's 1997 overview of data warehousing and OLAP is still a clear introduction to this world.

The cloud has since flipped the order of operations. Because cloud warehouses are cheap to scale, many teams now load raw data first and transform it *inside* the warehouse — **ELT** instead of ETL. The a16z piece on *emerging architectures for modern data infrastructure* maps out this "modern data stack" well.

## Why Analytics Stores Data in Columns

OLTP databases usually store data **row by row** — all the values of one record sit together, which is perfect for fetching a single customer or order. Analytical queries are different: they typically touch *a few columns across millions of rows*, like the sum of `price` grouped by `month`.

**Column-oriented storage** keeps each column separately, so a query reads only the columns it needs. Columns of similar values also compress very well, saving both disk space and I/O.

* **C-Store** (Stonebraker et al., 2005) made the case for a *read-optimized* column store built for warehouse workloads.
* Abadi, Madden and Hachem (2008) asked whether a row store could simply *emulate* a column store — and showed it can't come close. The gains come from execution techniques like operating directly on compressed data and *late materialization*, not just the on-disk layout.
* Google's **Dremel** (2010) brought columnar storage to *nested* data, running interactive aggregation queries over trillion-row tables in seconds. It later became the engine behind BigQuery.

**Trade-off:** columnar layouts make large scans fast but individual writes expensive — which is exactly why OLTP and OLAP end up in different systems.

## Data Lake

A **data warehouse** uses a relational data model, queried with SQL — well suited to an analyst's queries, but less suited to the kind of transformations a *data scientist* needs. Training an ML model, for instance, means turning rows and columns into a *vector* or *matrix* of numerical values called **features** — and the same friction shows up in **NLP** (*Natural Language Processing*) or extracting structured information from photos via *computer vision*.

To meet this need, organizations turned to the **data lake**: a centralized repository for data pulled from operational systems via ETL, stored as simple files without imposing any particular file format or data model. It holds data in its *raw* form, and is also cheaper to run than relational storage.

## Beyond the Lake: Lakehouse and Data Mesh

Data lakes solved for flexibility and cost, but brought new problems: no transactions, weak schema enforcement, and lakes that quietly turned into *data swamps*. Many organizations ended up running **both** a lake (for ML) and a warehouse (for BI), copying data between the two.

* **Delta Lake** (Armbrust et al., 2020) adds *ACID transactions* on top of cheap cloud object storage by keeping a transaction log alongside the data files.
* The **Lakehouse** paper (Armbrust et al., 2021) argues for a single system: *open file formats* on low-cost storage, with warehouse-style management — transactions, indexing, caching — layered on top, serving BI *and* ML from the same copy of the data.
* **Data mesh** (Zhamak Dehghani, 2019) tackles a different problem: the *organizational* bottleneck of one central data team. It proposes *domain-oriented ownership*, treating *data as a product*, a self-serve data platform, and federated governance.

**Trade-off:** a lakehouse gives up some of the maturity and tight integration of a dedicated warehouse in exchange for openness and a single copy of data. A data mesh gives up central consistency in exchange for team autonomy and scale.

## One Size Doesn't Fit All

In 2005, Stonebraker and Çetintemel argued that the era of one general-purpose relational database for every workload was over — specialized engines for warehousing, stream processing and other domains could beat it, often by an order of magnitude or more.

Two decades later, Stonebraker and Pavlo's *What Goes Around Comes Around… And Around…* (2024) adds a twist: new data models keep appearing, but the **relational model and SQL** keep absorbing their best ideas. Specialized *engines* won; the *interface* mostly stayed SQL.

At the other end of the spectrum, **HTAP** (*Hybrid Transactional/Analytical Processing*) systems try to serve both OLTP and OLAP from one system, removing the lag of ETL. Özcan, Tian and Tözün's 2017 survey covers this design space.

**Trade-off:** specialized systems win on performance but multiply the number of systems you must run and keep in sync. Unified systems simplify operations but must compromise somewhere.

## Systems of Record vs Derived Data

A useful way to reason about any data architecture is to split data into two kinds:

* **System of record** — the *source of truth*. Every fact is written here first, exactly once.
* **Derived data** — anything computed from it: caches, search indexes, materialized views, warehouse tables, ML features. If it's lost, it can be *rebuilt* from the source.

Jay Kreps' essay *The Log* (2013) argues that an append-only, ordered **log** of changes is the natural backbone connecting the two: every downstream system subscribes to the log and builds its own view. Martin Kleppmann's talk *Turning the Database Inside-Out* (2014) pushes this further — treating indexes, caches and materialized views as derived views over a stream of events, rather than features locked inside a single database.

**Trade-off:** derived data gives you specialized, fast read paths, at the cost of *eventual consistency* between the source and its copies.

## Cloud-Native Architecture

### Separating Storage and Compute

Traditional databases tie storage and compute to the same machines. Cloud-native systems pull them apart:

* **Snowflake** (Dageville et al., 2016) keeps data in cloud object storage and runs independent, elastic compute clusters — *virtual warehouses* — on top of it, so you can scale queries without moving data.
* **Amazon Aurora** (Verbitski et al., 2017) pushes the log down into a distributed storage layer — *the log is the database* — so the database sends only redo log records over the network.
* **Amazon Redshift** (Gupta et al., 2015) makes the case that for many customers, *simplicity* — a managed service that just works — matters more than raw features.

### Serverless

Serverless pushes the abstraction further: no servers to manage, and you pay only for what you use. The Berkeley view, *Cloud Programming Simplified* (2019), sees it as the next phase of cloud computing. Hellerstein et al.'s *Serverless Computing: One Step Forward, Two Steps Back* (2019) offers the counterpoint: today's functions are short-lived and must exchange data through slow storage, which makes them a poor fit for data-intensive work.

**Trade-off:** managed and serverless services give up control, predictability and sometimes cost in exchange for elasticity and far less operational burden.

## Distributed vs Single-Node

Distributed systems are often the default answer to scale — but they bring network failures, partial failures and coordination overhead with them.

McSherry, Isard and Murray's *Scalability! But at what COST?* (2015) asks a pointed question: how many cores does a distributed system need before it beats a well-written **single-threaded** implementation? For several published graph-processing systems, the answer was dozens to hundreds of cores — and some never did.

Meanwhile, single machines keep getting more powerful. Embedded analytical engines like **DuckDB** (Raasveldt and Mühleisen, 2019) run analytical queries *in-process*, on a laptop, over surprisingly large datasets.

**Trade-off:** distribute when you genuinely need fault tolerance, scale beyond one machine, or low latency across regions — not by default.

## Data Systems, Law and Society

Architecture decisions are not purely technical. Regulations like the **GDPR** give people rights over their personal data — including the right to have it *deleted*. That clashes with designs built on append-only logs, immutable data lakes and long-lived backups, where deleting one person's records is genuinely hard.

Shastri, Wasserman and Chidambaram's *The Seven Sins of Personal-Data Processing Systems under GDPR* (2019) catalogues how common system designs — like storing data indefinitely and reusing it for new purposes — run against these principles.

**Trade-off:** keeping everything is cheap and maximizes future options, but every byte of personal data you keep is also a *liability*.

## Wrapping Up

Every decision above is a trade-off, not a best practice:

* **OLTP vs OLAP** — fast point lookups vs fast large scans
* **Warehouse vs lake vs lakehouse** — structure and maturity vs flexibility and cost
* **Specialized vs unified** — performance vs operational simplicity
* **Source vs derived** — one truth vs many fast, eventually consistent views
* **Self-hosted vs managed** — control vs elasticity
* **Distributed vs single-node** — scale and fault tolerance vs simplicity
* **Keep vs delete** — future value vs present liability

There is no universally right architecture — only one that fits your data, your team and your constraints.

{{< source-disclaimer >}}

## References

1. Martin Kleppmann, *Designing Data-Intensive Applications*
2. Martin Fowler, [Data Lake](https://martinfowler.com/bliki/DataLake.html)
3. Matt Bornstein, Jennifer Li & Martin Casado, [Emerging Architectures for Modern Data Infrastructure](https://a16z.com/emerging-architectures-for-modern-data-infrastructure/)
4. Surajit Chaudhuri & Umeshwar Dayal, *An Overview of Data Warehousing and OLAP Technology*, SIGMOD Record, 1997
5. Mike Stonebraker et al., *C-Store: A Column-oriented DBMS*, VLDB 2005
6. Daniel J. Abadi, Samuel R. Madden & Nabil Hachem, *Column-Stores vs. Row-Stores: How Different Are They Really?*, SIGMOD 2008
7. Sergey Melnik et al., *Dremel: Interactive Analysis of Web-Scale Datasets*, VLDB 2010
8. Michael Armbrust et al., *Delta Lake: High-Performance ACID Table Storage over Cloud Object Stores*, VLDB 2020
9. Michael Armbrust, Ali Ghodsi, Reynold Xin & Matei Zaharia, *Lakehouse: A New Generation of Open Platforms that Unify Data Warehousing and Advanced Analytics*, CIDR 2021
10. Zhamak Dehghani, [How to Move Beyond a Monolithic Data Lake to a Distributed Data Mesh](https://martinfowler.com/articles/data-monolith-to-mesh.html), 2019
11. Michael Stonebraker & Uğur Çetintemel, *"One Size Fits All": An Idea Whose Time Has Come and Gone*, ICDE 2005
12. Michael Stonebraker & Andrew Pavlo, *What Goes Around Comes Around… And Around…*, SIGMOD Record, 2024
13. Fatma Özcan, Yuanyuan Tian & Pınar Tözün, *Hybrid Transactional/Analytical Processing: A Survey*, SIGMOD 2017
14. Jay Kreps, *The Log: What every software engineer should know about real-time data's unifying abstraction*, LinkedIn Engineering, 2013
15. Martin Kleppmann, [Turning the Database Inside-Out](https://martin.kleppmann.com/2015/03/04/turning-the-database-inside-out.html), Strange Loop 2014
16. Benoit Dageville et al., [The Snowflake Elastic Data Warehouse](https://www.cs.cmu.edu/~15721-f24/papers/Snowflake.pdf), SIGMOD 2016
17. Alexandre Verbitski et al., [Amazon Aurora: Design Considerations for High Throughput Cloud-Native Relational Databases](https://pages.cs.wisc.edu/~yxy/cs764-f20/papers/aurora-sigmod-17.pdf), SIGMOD 2017
18. Anurag Gupta et al., *Amazon Redshift and the Case for Simpler Data Warehouses*, SIGMOD 2015
19. Eric Jonas et al., *Cloud Programming Simplified: A Berkeley View on Serverless Computing*, 2019
20. Joseph M. Hellerstein et al., *Serverless Computing: One Step Forward, Two Steps Back*, CIDR 2019
21. Frank McSherry, Michael Isard & Derek G. Murray, [Scalability! But at what COST?](https://www.usenix.org/conference/hotos15/workshop-program/presentation/mcsherry), HotOS 2015
22. Mark Raasveldt & Hannes Mühleisen, *DuckDB: an Embeddable Analytical Database*, SIGMOD 2019
23. Supreeth Shastri, Melissa Wasserman & Vijay Chidambaram, *The Seven Sins of Personal-Data Processing Systems under GDPR*, HotCloud 2019
