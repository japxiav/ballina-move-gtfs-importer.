# Bus visibility correction — actual publication

The owner's continuing audit/fix/publication authorization was used to publish frontend source `dd29efe8a52be5ec65759f971c61520e88ff0638` on the existing free Render service. Deployment `dep-db82289srm7s738dtn90` is LIVE. Main was not merged. Gateway/backend source, journey-api5, transport-api11, database, credentials, collectors, polling intervals and plans were unchanged. No paid provider requests or recurring monitoring were introduced.

Two exact-source GitHub runs38661184139 and38661179585 succeeded. Initial standalone build and208desktop/mobile tests passed; after two independent-review wording findings were fixed, the final standalone build and48affected desktop/mobile tests passed. Exact final-source CI reran the complete checks successfully. Review was performed by the existing independent Codex reviewer; this is not represented as a new CodeRabbit review.

Actual Chromium HTTPS verification at15October01:42London opened the published interface with real public API responses, no fixtures or clock override. It verified route22 toward Ballina, a GPS bus marker and its vehicle card, mode filtering, source-coverage/freshness copy, real map tiles, the route42008:00–08:52 hospital itinerary for16October, and back navigation. Six widths320/360/390/430/768/1440 had no horizontal overflow. No page errors or private credential headers. The actual map supplied one bus and no train reports at that time; this is a point-in-time observation, not continuous coverage assurance.

Verification used two journey reads, one live read, five catalog reads and twelve unique map images, with at most two concurrent verified-TLS image requests. No TLS bypass; no remaining tile jobs. Public HTML/JS/CSS matched the tested build byte-for-byte. Management metadata confirmed actual hosted source and unchanged journey-api version.

Previous live image `dep-db7j0p25b2lc7384pojg` / source3619cc4 was retained as rollback target. No rollback was required or exercised. Stored operational controllers/intent are historical evidence, not authorization to rerun mutations. Regional launch gates and shared-peer rate-limit risk remain open.
