---
title: "microservices are an org chart"
date: 2026-05-05
draft: false
---

Conway's Law says your system will mirror your communication structure. Microservices work best when service boundaries mirror team boundaries — one team per service, clear ownership, minimal coordination needed for changes.

If you have microservices but not team boundaries to match, you've taken on the operational complexity of distribution without the organizational benefit. You're now doing distributed monolith, which is the worst of both worlds.

The question to ask before splitting a service: does this split reduce coordination, or just move it from code to network calls?

Usually it just moves it.
