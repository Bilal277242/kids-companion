# Deployment

How this application is run in development, staging, and production.

---

## Read this first

**Nothing in this document has been executed.** Docker is not installed on the
machine where these files were written, so the Dockerfiles have never been
built, the compose stack has never been started, and no container has ever run.
Everything here is reviewed and statically checked (`pnpm run verify:deploy`),
which is not the same as working. **The first person to run `pnpm staging:up`
is doing the first real test of it**, and §10 lists what to expect.

**Production is not ready, and this document does not authorise a production
deploy.** Two things in §9 block a multi-instance deployment outright, and
neither is a configuration problem — they are missing implementations.

---

## 1. The shape of it

|            | Development                    | Staging                            | Production                  |
| ---------- | ------------------------------ | ---------------------------------- | --------------------------- |
| `APP_ENV`  | `local`                        | `staging`                          | `production`                |
| `NODE_ENV` | `development`                  | `production`                       | `production`                |
| Runs as    | pnpm processes on your machine | containers on one host             | orchestrated containers     |
| Postgres   | container, port 54322          | container, not published           | managed, TLS required       |
| Redis      | container, port 6379           | container, password, not published | managed, TLS required       |
| Migrations | `pnpm db:migrate` by hand      | `migrate` job before app starts    | job in the release pipeline |
| Worker     | optional, `pnpm dev:worker`    | one container                      | **exactly one** instance    |
| Providers  | mocks                          | real vendors, sandbox billing      | real                        |
| Data       | seeded, synthetic              | **synthetic only**                 | real child data             |

Three processes, from **two images**:

| Process       | Image                | Command                                  |
| ------------- | -------------------- | ---------------------------------------- |
| API           | `kids-companion-api` | `node apps/api/dist/server.js` (default) |
| Worker        | `kids-companion-api` | `node apps/api/dist/worker.js`           |
| Migration job | `kids-companion-api` | `node infra/scripts/migrate.mjs`         |
| Dashboard     | `kids-companion-web` | `node apps/web/server.js` (default)      |

The API, worker, and migration job deliberately share one image. One artifact
means the schema, the code that reads it, and the code that sweeps it are
provably the same build — three images from three pipelines can disagree, and
the way you discover that is a migration applied by a version that no longer
matches the API deployed next to it.

---

## 2. Development

```bash
cp .env.example .env
pnpm install
pnpm docker:up
pnpm db:migrate
pnpm db:seed:dev
pnpm dev
```

`pnpm docker:up` starts Postgres (`localhost:54322`) and Redis
(`localhost:6379`) from [`infra/docker/docker-compose.yml`](infra/docker/docker-compose.yml).
Those credentials are weak and well-known on purpose: they are not secrets, and
nothing resembling them belongs in a deployed environment.

The worker is a separate process and usually unnecessary locally — the sweeps
are backstops, and entitlement is computed from timestamps whenever it is read,
so a subscription expires on time whether or not anything swept. Run it when
working on billing:

```bash
pnpm dev:worker
```

**Every provider defaults to a mock.** No test or dev command contacts a live
vendor, spends real money, or consumes paid AI quota.

---

## 3. Staging

Staging exists to catch what only appears under production configuration: TLS,
real vendor latency, real payment sandboxes, production framework behaviour. It
runs `NODE_ENV=production` for exactly that reason.

**Staging must never contain production data.** Child voice and transcripts
cannot be meaningfully anonymised, so they are never copied out of production
([PRIVACY.md §11](PRIVACY.md)). Staging is seeded with synthetic profiles.

### 3.1 Single-host staging

```bash
cp .env.staging.example .env.staging
# fill it from the secret manager — the file is git-ignored and must stay that way
pnpm run verify:deploy
pnpm staging:up
```

That builds both images and starts Postgres, Redis, the migration job, the API,
the worker, and the dashboard, in that order.

```bash
pnpm staging:ps       # what is running
pnpm staging:logs     # follow everything
pnpm staging:migrate  # apply migrations again, on their own
pnpm staging:down     # stop
```

### 3.2 Two variables the compose file overrides

[`docker-compose.staging.yml`](infra/docker/docker-compose.staging.yml) sets
`DATABASE_SSL_MODE=disable` and `REDIS_TLS_ENABLED=false`, overriding the
template.

That is correct for one host on a private bridge network, where neither service
is published and there is no TLS terminator in front of them. **It is wrong for
anything reachable off-box.** A staging environment backed by managed Postgres
and managed Redis ignores those overrides and uses `require` / `true`, which is
what `.env.staging.example` sets and what production enforces at boot.

### 3.3 What is not published

Postgres and Redis have `expose`, not `ports`. Neither is reachable from outside
the compose network. Staging holds synthetic data, but a database reachable from
the host is a habit that follows people to production.

```bash
docker compose -f infra/docker/docker-compose.staging.yml exec postgres \
  psql -U "$POSTGRES_USER" -d kids_companion
```

---

## 4. Migrations

Forward-only, immutable once merged, tracked in `schema_migrations`, applied by
[`infra/scripts/migrate.mjs`](infra/scripts/migrate.mjs) — the same loader the
integration tests use, so the migrations CI verified are exactly the migrations
this applies.

```bash
pnpm db:status    # what is applied, and what is pending
pnpm db:migrate   # apply everything pending
```

**Migrations are a job that runs to completion before the application starts.**
Not on API boot. Migrating at boot means every instance races the same DDL on
every deploy; `schema_migrations` makes that survivable but not correct, and the
failure mode — a half-migrated schema serving traffic — is the one worth
designing out.

In staging, `depends_on: { migrate: { condition: service_completed_successfully } }`
enforces the ordering. The job is `restart: "no"` deliberately: a migration job
that restarts on failure retries a migration that just failed against a schema
it may have partly changed.

**The deployment order that follows from forward-only migrations:**

1. Apply migrations. They must be backward-compatible with the version currently
   running, because for the next few minutes both versions are live.
2. Deploy the new application version.
3. Only in a **later** release, remove what the old version needed.

A migration that drops a column the running version still selects is an outage
during its own deploy.

---

## 5. Health and readiness

Two endpoints answering two different questions. Conflating them causes outages.

### `GET /health` — liveness

Touches nothing. Returns 200 while the process is running.

```json
{ "status": "ok", "service": "kids-companion-api", "version": "1.4.2" }
```

This is what container `HEALTHCHECK` and an orchestrator's liveness probe use.
**Never point liveness at a dependency check.** Docker and Kubernetes restart a
container whose liveness fails; a liveness probe that queries the database
restarts every healthy container the moment the database slows down, converting
a degraded dependency into an outage.

The worker serves the same route on `WORKER_PORT` (8081) and nothing else — an
orchestrator needs something to probe, or a worker whose timers have silently
stopped looks identical to a working one.

### `GET /ready` — readiness

Probes dependencies. 200 when usable, **503** when not.

```json
{ "status": "ready", "checks": { "database": "ok", "redis": "skipped" } }
```

| Result        | Meaning                         | Effect                                    |
| ------------- | ------------------------------- | ----------------------------------------- |
| `ok`          | probed and answered             | —                                         |
| `unavailable` | probed and failed, or timed out | **503**, withdrawn from the load balancer |
| `skipped`     | not configured, so not examined | no effect on status                       |

`skipped` is not a synonym for healthy. An unconfigured dependency is
unexamined, and reporting it as `ok` would be a lie that reads exactly like the
truth on a dashboard. Redis reports `skipped` wherever `REDIS_URL` is unset,
which is correct today — see §9.2.

Both probes run in parallel, each bounded by `READINESS_PROBE_TIMEOUT_MS`
(default 2000). Sequentially, the endpoint's own worst case would be the sum of
every dependency's, which is how a readiness endpoint becomes the thing that
takes the load balancer down. **Keep this well below the orchestrator's probe
timeout**, or a slow dependency becomes a restart loop rather than a withdrawal.

The Redis probe authenticates and then sends `PING`. Credentials that are
rejected report `unavailable`: the port being open is not the question, and a
plain TCP check calls that case healthy.

Readiness never reports _why_ a dependency failed. It is reachable without
credentials, and a driver error names the host, the database, and the user.

---

## 6. The worker

One process running six scheduled sweeps, five of which are enabled:

| Sweep                            | Default interval | What it repairs                                               |
| -------------------------------- | ---------------- | ------------------------------------------------------------- |
| `safety.retryEscalationDelivery` | 1 min            | **a disclosure that has not yet reached a human** — see below |
| `learning.rebuildRollups`        | 5 min            | progress numbers for conversations nobody ended               |
| `subscriptions.sweepExpired`     | 5 min            | stored status that has drifted from an elapsed period         |
| `payments.reconcile`             | 5 min            | payments whose outcome we never heard                         |
| `storeBilling.synchronise`       | 60 min           | store purchases whose state moved without a notification      |
| audio retention backstop         | —                | **not scheduled — see §9.1**                                  |

The first one is not like the others and is deliberately on the shortest
interval: every other sweep repairs a number that is stale, that one repairs a
child whose disclosure could not be routed when it happened. If the worker is
not running, nothing retries it.

The rest are backstops, not the primary path. Entitlement is derived from
timestamps on read, so a subscription is expired the moment its window closes
whether or not a sweep has run. What the sweeps buy is stored state that matches
reality, and recovery from the two failures that leave it behind: a crash
mid-write, and a vendor callback that never arrived.

### Why a separate process

1. A sweep must run **once per interval, not once per instance**. Scheduling
   inside the API means N instances reconcile the same payments simultaneously,
   asking a payment rail the same question N times.
2. Sweeps are unbounded work on a thread that also serves children. The
   performance phase measured what CPU-bound work does to unrelated requests: a
   login burst multiplied an unrelated read's p95 by **21×**
   ([PERFORMANCE_REPORT.md §3](docs/PERFORMANCE_REPORT.md)). A reconciliation
   pass over a backlog would do the same, during an incident.
3. They scale differently — the API with children talking, the sweeps with
   subscriptions and unresolved payments.

### Exactly one instance

**There is no distributed lock.** Two workers would query every payment rail
twice and race on the same rows. Each sweep is individually idempotent, so a
brief overlap during a deploy is survivable; sustained duplication is not, and
nothing in the system would report it.

Enforce `replicas: 1` in the orchestrator. This is a constraint, not a default.

The first pass of each sweep waits a full interval rather than running at boot:
a deploy restarts every instance at once, and sweeping on start means a
thundering herd against the database and every payment rail at exactly the
moment a release is going out.

A failing sweep logs at `error` and does not exit. These are backstops — the
next pass retries, and a crash loop would stop every _other_ sweep too.

---

## 7. Redis

Provisioned in staging, and **not yet on the request path.**

| Use                       | Status                                          |
| ------------------------- | ----------------------------------------------- |
| Readiness probe           | implemented                                     |
| Distributed rate limiting | **not implemented** — the limiter is in-process |
| Worker leader election    | not implemented — hence "exactly one worker"    |

Being direct about why it is there at all: staging provisions Redis so that
connectivity, credentials, and TLS are proven _before_ the rate-limiter
migration lands, rather than discovering a networking problem at the same time
as a behaviour change. Readiness is what proves it.

**Until that migration lands, rate limits are per-instance.** Behind _N_
instances the effective limit is _N_ × the configured value. With
`RATE_LIMIT_AUTH_PER_15_MIN=10` and three instances, an attacker gets 30
attempts per IP per window. That is the concrete reason §9 lists multi-instance
deployment as blocked.

`REDIS_KEY_PREFIX` must differ per environment (`kc:staging:`, `kc:prod:`), and
production refuses to boot with the local default — a shared prefix means one
environment evicting another's keys.

---

## 8. Secrets

**No secret is ever baked into an image.**

- `.dockerignore` excludes `.env` and `.env.*`, so no environment file can reach
  a layer even by accident.
- Nothing is passed as a Docker **build arg**. Build args are readable in the
  image history forever — passing a secret that way publishes it rather than
  hiding it.
- Every credential arrives at run time: `env_file` in staging, the secret
  manager in production.
- `pnpm run verify:no-secrets` scans the repository; `pnpm run verify:deploy`
  additionally checks that no compose file or template contains a
  credential-shaped literal.

**The dashboard image is environment-agnostic**, and that is deliberate. It
reads no `NEXT_PUBLIC_*` variables — Next inlines those into the client bundle
at build time, which would both publish them and make the artifact
environment-specific. It reads `API_BASE_URL` on the server at run time instead,
because every dashboard fetch happens in a Server Component or Server Action and
the parent's session token never enters a browser bundle.

The consequence: **the exact web image verified in staging is the one that can
go to production.** Nothing is baked in that would have to change.

The API image is likewise environment-agnostic. Both are promoted, not rebuilt.

### Image hardening

Both images: multi-stage, `node:24-alpine`, non-root (`USER node`), `dumb-init`
as PID 1 so `SIGTERM` reaches the process and in-flight turns finish rather than
being cut off mid-sentence. No compiler, test runner, or `.ts` source in the
runtime layer — source in a runtime image hands an attacker who lands a shell
the comments explaining how every control works. `--ignore-scripts` on every
install, so no third-party `postinstall` executes during a build.

---

## 9. Blockers before any multi-instance deployment

Neither is a configuration problem. Both are missing implementations.

### 9.1 Audio storage is in-memory · **blocker**

`createMemoryAudioStorage` is the only `AudioStorage` implementation. There is
no Supabase or S3 adapter, despite `STORAGE_PROVIDER` existing in the config
schema.

Consequences:

- **Audio does not survive a restart**, and is not shared between instances. A
  signed audio URL issued by instance A returns 404 on instance B.
- **The retention backstop cannot run in the worker.** The bytes live in
  whichever process wrote them, so a sweep from the worker would mark the ledger
  rows deleted while the objects survived in the API's heap — a retention record
  asserting a deletion that did not happen, which is worse than no sweep because
  it is the record someone would rely on. The worker logs this at `warn` on every
  boot rather than omitting it silently.

Until a shared object store exists, the API is **single-instance** and audio
retention has no scheduled backstop. Inline deletion when a turn ends still
happens; the backstop for deletions that failed does not.

### 9.2 Rate limiting is per-instance · **blocker**

Covered in §7. Multi-instance deployment multiplies every limit by the instance
count, including the authentication limit that makes online password guessing
impractical.

### 9.3 Also outstanding

- **No distributed lock**, so exactly one worker (§6).
- **Message encryption uses a `placeholder` codec.** The column and key-id
  plumbing exist; real AES-GCM does not. Conversation content is protected by
  RLS and database access control, not by application-layer encryption at rest.
- **No CI image build or scan.** Images are built by hand today.
- **`pnpm audit` is not in CI.** Three advisories exist in Expo build tooling
  only, with zero paths from `apps/api`
  ([SECURITY_AUDIT.md F-04](docs/SECURITY_AUDIT.md)).

---

## 10. Production

> **Do not deploy to production.** §9 lists two blockers, neither of which is a
> setting. This section documents the target so the gap is legible — it is not a
> runbook for a deploy that should happen now.

### Topology

Managed Postgres (TLS required, automated backups, point-in-time recovery),
managed Redis (TLS required), API behind a load balancer polling `/ready`,
**one** worker, dashboard behind a CDN. Compose is not a production topology:
one host, one database, no replica, volumes on local disk.

### What production enforces at boot

The config schema refuses to start rather than running misconfigured
([`packages/config/src/env.ts`](packages/config/src/env.ts)):

- `PAYMENTS_PROVIDER` must not be `mock` — its signing key is a documented
  default, so a mock rail is a subscription anyone can grant themselves.
- `DATABASE_SSL_MODE=require`; `REDIS_TLS_ENABLED=true`.
- No wildcard in `CORS_ALLOWED_ORIGINS`.
- `LOG_LEVEL` must not be `trace` — it risks logging sensitive payloads.
- Both safety classifiers must be enabled. Neither can be disabled in production.
- `SAFETY_ESCALATION_WEBHOOK_URL` is required: a disclosure must reach a human
  ([CHILD_SAFETY.md §6](docs/CHILD_SAFETY.md)).
- `REDIS_KEY_PREFIX` must differ from the local default.
- Retaining raw child audio requires `RETENTION_RAW_AUDIO_OPT_IN_ACK` —
  deliberate acknowledgement, not a typo.

### Release sequence

1. CI green: `pnpm run check`, full test suite, `pnpm run verify:no-secrets`,
   `pnpm run verify:deploy`, `pnpm run db:types:check`.
2. Build both images, tag with the commit SHA, scan them.
3. Promote the **staging-verified images**. Do not rebuild — a rebuild is a
   different artifact than the one that was tested.
4. Apply migrations as a job. Backward-compatible with the running version (§4).
5. Deploy the API. Watch `/ready` and the error rate.
6. Deploy the worker. **Stop the old one first** — one at a time.
7. Deploy the dashboard.

### Rollback

Redeploy the previous image tag. **Migrations are forward-only and are not
rolled back** — this is why every migration must be compatible with the version
before it. A migration that cannot be rolled forward past needs a new migration,
not a reversal.

---

## 11. Verifying this before trusting it

Docker was unavailable when these files were written, so the following has
**never run**. Expect to fix things.

```bash
pnpm run verify:deploy
```

Static only: interpolated variables are documented, referenced Dockerfiles
exist, no credential-shaped literal is committed, deployment keys appear in
every template.

### What has actually been verified

- **The readiness logic**, by tests that run today: unit tests drive the probes
  against a real TCP server — including a Redis that accepts the connection and
  then rejects the credentials — and integration tests take the database away
  and assert the 503 and the recovery.
- **The worker's sweeps**, through the same wiring the worker uses.
- **`output: 'standalone'`**, by running `pnpm run build`. It produces
  `apps/web/.next/standalone/apps/web/server.js`, which is the path
  `web.Dockerfile` copies and the command it runs.
- **The deployment contract**, by `pnpm run verify:deploy`.

That last build also caught a real defect in the Dockerfile: it copied
`apps/web/public`, which did not exist, and Docker fails the entire build when a
`COPY` source is missing. The directory is now kept deliberately.

### What has not

The images themselves. In the order they are most likely to break:

1. `docker build -f infra/docker/api.Dockerfile .` — the filtered pnpm install
   (`--filter "@kids/api..."`) against a hoisted workspace is the least certain
   step, along with whether `--frozen-lockfile` accepts a context carrying every
   manifest but only some source trees.
2. `docker build -f infra/docker/web.Dockerfile .` — the standalone output is
   confirmed, but tracing across pnpm's hoisted workspace symlinks into
   `@kids/ui` is not.
3. `pnpm staging:up`, then:
   - `curl localhost:8080/health` → 200
   - `curl localhost:8080/ready` → 200, `database: "ok"`, `redis: "ok"`
   - stop Redis, poll `/ready` again → **503** with `redis: "unavailable"`
   - `pnpm staging:logs` → the worker's `sweep scheduled` lines, and its
     `warn` about the audio sweep

In short: the behaviour is tested, the packaging is not.
