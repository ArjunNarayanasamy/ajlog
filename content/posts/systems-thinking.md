---
title: "systems thinking for engineers"
date: 2026-04-15
draft: false
tags: ["engineering", "thinking"]
description: "how to reason about things that interact"
---

Most of what makes software engineering hard isn't the code. It's the systems — the networks of components, teams, and incentives that interact in ways that are hard to predict.

## feedback loops

A system's behavior is determined by its feedback loops. A positive feedback loop amplifies change — a service that gets slower under load, which causes retries, which increases load, which makes it slower. A negative feedback loop damps change — a rate limiter that kicks in as traffic increases.

Understanding which loops are in your system tells you how it will behave under stress.

## emergent behavior

A system can behave in ways that none of its components would suggest. The components are fine. The interaction is the problem.

This is why you can't fully test a distributed system by testing its parts. You have to observe the whole thing under conditions that look like production.

## local optima

Individual components optimizing locally can produce global suboptima. A team that optimizes for shipping speed creates technical debt the whole system pays. A service that retries aggressively to improve its own success rate can DDoS its dependencies.

You can't fix this with better individual behavior. You have to change the incentives or the interfaces.

## stocks and flows

Donella Meadows's framing: stocks are things that accumulate (data, debt, trust, team knowledge). Flows are rates of change (feature velocity, churn, onboarding). You manage a system by managing the flows into and out of the stocks.

Most technical interventions focus on flows. The highest-leverage interventions often target the stocks.

## the system is the team

Conway's Law is a systems insight: your software architecture mirrors your communication structure. If you want to change the architecture, change the team structure. The code will follow.
