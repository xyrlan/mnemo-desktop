The JSON of mnemo's install-review spec (`docs/superpowers/specs/2026-09-24-install-review-design.md`
in xyrlan/mnemo, section *Interface*), written by hand before the CLI existed (#180). The
examples in the spec are copied as they stand; the rest follow the same shapes.

- `dry-run.json`: `mnemo backfill --project P --dry-run --json`
- `dry-run-none.json`: the same with no session to read
- `progress.jsonl`: `mnemo backfill --project P --yes --extract --progress-json`
- `listing.json`: `mnemo inbox --origin backfill --project P --json`
- `promote-failed.json`: `mnemo inbox --promote --keys-stdin --json`, one key failed
- `drop.json`: `mnemo inbox --drop --keys-stdin --json`
