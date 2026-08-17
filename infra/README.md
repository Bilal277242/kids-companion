# infra/

Infrastructure, migrations, and operational scripts. **No application code imports from here.**

```
infra/
├── docker/       local Compose stack and deployment images
├── migrations/   versioned, forward-only SQL
└── scripts/      CI and operational scripts
```

## docker/

_Phase 1._ Local Postgres and Redis, plus the production API image: non-root, minimal base, no build tooling in the runtime layer, pinned digests, scanned in CI ([SECURITY.md §7](../SECURITY.md)).

## migrations/

_Phase 1._ Forward-only and immutable once merged. Full rules in [DATABASE_CONVENTIONS.md §7](../docs/DATABASE_CONVENTIONS.md) — the ones that bite hardest:

- **Never edit a merged migration.** Someone has already run it.
- **Expand/contract for anything breaking.** A mobile app on a version from last year is still talking to the new database.
- **`create index concurrently`** on hot tables. A lock on `turns` is a product outage.
- Every migration enables RLS on any table holding parent or child data, and annotates personal-data columns with their classification.

## scripts/

| Script                 | Purpose                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `check-no-secrets.mjs` | Scan tracked files for committed credentials. A safety net, not a security control.                       |
| `check-env.mjs`        | Compare `.env` against `.env.example`. The authoritative check is the boot-time schema in `@kids/config`. |
