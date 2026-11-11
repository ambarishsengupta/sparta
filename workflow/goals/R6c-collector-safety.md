# Goal: the collector stays loopback-only and take-down-safe (no live crawl, no non-loopback connection, taken-down sources never collected)
Predicate: `bash workflow/gates/collector_tests.sh >/dev/null 2>&1`
Completed: 2026-11-12
Triggered by: release R6c (collector, collector storage, catalogue admin)
Status: holding
Last pass: 2026-11-12
On violation: do not ship; check the guard (`live_collection_disabled` before any socket), that COLLECTOR_LIVE is unset, that sources with allowed = false or takedown_at set are never selected, and that nothing scraped is committed.
Retire when: Release 1 replaces it with hosted collection controls (after owner decisions O1, O2, O6).
