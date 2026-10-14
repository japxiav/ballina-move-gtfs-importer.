This is a read-only snapshot of the **public application schema**, captured on
14 October 2026. It contains no application rows, vault values, credentials or
cron jobs. Do not apply it to the live database: it is a fresh-schema baseline,
not an incremental migration or a production rollback procedure.

The baseline preserves 23 tables, 23 functions and 3 sequences, including column
types/defaults/identity, constraints, indexes, RLS, owners and ACLs. Sequence
numbers are exported as strings to avoid precision loss in management JSON.
`manifest.json` records hashes/names of the 36 migration-ledger entries observed
in this capture. The audit PDF reports 39; its count has not been reconciled with
this current read-only query. Historical statements and seed data are not exported.

`scripts/test_departures_rpc_contract.py --full-schema` restores this baseline in
a pinned, RAM-only PostgreSQL container with no network or exposed ports. It
compares the restored structural catalog, owners and full ACLs, verifies all RPC
definitions, verifies anon/authenticated denial for tables and RPCs, and runs ten synthetic departures
through the real RPC and gateway against the checked browser fixture.

This proves public application DDL recovery, not a complete Supabase project
disaster recovery. A new Supabase project must supply its platform roles,
extensions (including vault/cron/net), Edge functions, secure bindings, collector
configuration and GTFS import. Those dependencies and their data are deliberately
not invented or copied. Functions that depend on vault/cron are preserved but are
not invoked in this isolated PostgreSQL test. Physical recovery of the hosted
project and collector operation remains a separate release gate.

The faithful capture found inherited `SELECT/USAGE/UPDATE` grants to `anon` and
`authenticated` on all three sequences. RLS does not protect sequences. No
public HTTP exploit was demonstrated. A separate proposed revocation is in
`docs/applied_migrations/PROPOSED_restrict_sequence_grants_20261014.sql`; the
offline restore test applies it after catalog equality, verifies denial and
preserves service_role privileges. It has **not** been applied to production.
