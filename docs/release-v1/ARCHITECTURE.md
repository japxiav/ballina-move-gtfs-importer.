> Authoritative13October2026 product-mission checkpoint: unpublished code `06b72b428fa623e7daf4d244b4851683506b78d0`; published preview `3a96758b87d33908635f03d2e833cd5742609997`, journey-api version4, main `f38826625e08fe6bcd92073df45685fa36bbf7cf`. See [PROGRESS](PROGRESS.md) and [current evidence](evidence/product-mission-20261013/validation.json). Existing sections below are historical phase evidence, not current production/source pointers. Regional NO-GO remains. Do not execute historical publication/rollback instructions without checking current source, available provider rollback and specific authorization.

# Architecture and trust boundaries

```mermaid
flowchart LR
 NTA[NTA static GTFS] --> Import[Versioned atomic importer]
 Import --> DB[Supabase versioned GTFS]
 RT[NTA realtime collector] --> DB
 DB --> J[journey-api / isolated scheduled solver]
 DB --> T[transport-api / public live channels]
 J --> B[Render Python same-origin BFF]
 T --> B
 Rail[Irish Rail reported positions XML] --> B
 B --> Browser[English React browser]
 Tiles[Attributed OSM tiles] --> Browser
 W[Private walking provider / NOT active publicly] -.-> A12[Experimental routing engine / PR26]
 DB -.-> A12
```

Browser has no API management/service key, private JWT or provider adapter. Only server holds publishable transport key. Management bindings target their respective API hosts; not copied to browser/GitHub. The publishable key is not a private consumer credential. Same-origin/CORS restrictions do not stop direct nonbrowser abuse. Global BFF60/min and Edge30/min are preserved emergency quotas, not consumer fairness.

The public solver and A12 are different implementations. Public schedules use supplied GTFS times, calendar exceptions and same-stop connection buffers; no walking or realtime reconciliation. A12 has private provider geometry/budgets but no validated physical access or target-host release proof. Do not replace the public tree with an old A12 branch or toggle walkingIncluded without a new validated contract.

Live bus GPS ages use observation timestamps; Irish Rail reports have unknown precision/observation time. Source retrieval time is never an ETA. Gateway limits clients/workers/bytes/time, refuses upstream redirects and exposes only sanitized DTOs. Free Render can idle. Existing immutable update pipeline has no auto-deploy; dry local tests do not establish a rollback rehearsal.
