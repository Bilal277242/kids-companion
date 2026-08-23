# Production readiness review

**Date:** 2026-08-23
**Scope:** the seventeen categories requested, each verified against the code
rather than recalled.
**Method:** every verdict below cites what was inspected. Where a claim was
surprising it was checked twice — two findings in §4 were corrected mid-review
because the first reading was wrong.

---

## Verdict

# NOT READY FOR PRODUCTION

**6 PASS · 4 PARTIAL · 7 FAIL** — of seventeen categories.

This is not a close call, and the reason is not the count. One finding is a
child-safety gap rather than an infrastructure one:

> **~~A child disclosing harm currently reaches no human.~~ RESOLVED**
> `SAFETY_ESCALATION_WEBHOOK_URL` is now read: an escalation is written to a
> durable delivery ledger and routed to the configured endpoint, retried by
> the worker until it lands. **Who that endpoint belongs to remains Q-07 and
> still blocks launch** — the mechanism exists, the protocol does not. See F-01.

Nothing here should be read as "close, pending sign-off". Three of the failures
(storage, rate limiting, error tracking) are missing implementations, not
settings, and two more (backups, domain) are infrastructure that does not exist
yet.

---

## The table

| #   | Category                  | Status      | One-line reason                                                                                      |
| --- | ------------------------- | ----------- | ---------------------------------------------------------------------------------------------------- |
| 1   | Environment configuration | **PASS**    | 158 keys, Zod-validated, fails to boot rather than run misconfigured                                 |
| 2   | Secrets                   | **PASS**    | Nothing in any image or layer; scanned in CI, history included                                       |
| 3   | Database                  | **PASS**    | Forward-only migrations, checksum ledger, pool + timeout + TLS enforced                              |
| 4   | RLS                       | **PARTIAL** | All 50 tables `ENABLE`+`FORCE`, proven from the catalogue; 85 policies not each behaviourally tested |
| 5   | Backups                   | **FAIL**    | None. No script, no schedule, no restore drill                                                       |
| 6   | Monitoring                | **FAIL**    | Alerts fire into a log file. No external system receives one                                         |
| 7   | Logging                   | **PASS**    | Redaction at 100 % coverage, request ids, no internals in responses                                  |
| 8   | Rate limits               | **FAIL**    | Per-instance and in-memory; behind _N_ instances every limit is *N*×                                 |
| 9   | AI limits                 | **PARTIAL** | Per-child and per-plan enforced; the account-wide cost ceiling is not implemented                    |
| 10  | Payment webhooks          | **PARTIAL** | Mechanism is sound and tested; no rail is verified, so payments cannot run                           |
| 11  | Mobile configuration      | **FAIL**    | Placeholder bundle ids, version 0.0.0, no build profile, never submitted                             |
| 12  | Storage                   | **FAIL**    | Only an in-memory implementation exists                                                              |
| 13  | Domain configuration      | **FAIL**    | No domain. Every hostname in the templates is an example                                             |
| 14  | SSL                       | **PARTIAL** | Enforced everywhere in config; no certificate or terminator exists to enforce it on                  |
| 15  | CORS                      | **PASS**    | Explicit origins, wildcard refused at boot in any deployed environment                               |
| 16  | Error tracking            | **FAIL**    | `SENTRY_DSN` is declared; no client is installed and nothing reads it                                |
| 17  | Rollback strategy         | **PASS**    | Documented, correct about the forward-only database; never rehearsed                                 |

---

## The finding that cuts across seven categories

**Nine configuration keys are declared, validated, documented — and never read
by any code.** Several are the _only_ mechanism their category has.

| Key                                 | Category it belongs to | Consequence                                           |
| ----------------------------------- | ---------------------- | ----------------------------------------------------- |
| ~~`SAFETY_ESCALATION_WEBHOOK_URL`~~ | child safety           | **RESOLVED** — read, routed, retried (F-01)           |
| `AI_DAILY_COST_CEILING_USD`         | AI limits              | No account-wide spend ceiling                         |
| `SENTRY_DSN`                        | error tracking         | No error tracking                                     |
| `STORAGE_PROVIDER`                  | storage                | No object store                                       |
| `OTEL_EXPORTER_OTLP_ENDPOINT`       | monitoring             | No tracing                                            |
| `ENCRYPTION_ACTIVE_KEY_ID`          | database               | Key id is hard-coded `'placeholder'`                  |
| `RETENTION_TRANSCRIPT_DAYS`         | privacy                | Transcripts are never deleted                         |
| `SAFETY_REVIEW_QUEUE_ENABLED`       | child safety           | No review queue                                       |
| `REDIS_URL`                         | rate limits            | Readiness probe only; the limiter never touches Redis |

This is why a configuration review alone would have passed this application.
Every one of these has a sensible default, a validation rule, and a paragraph in
`docs/ENVIRONMENT.md`. Four are _required_ in production by the schema. Setting
them changes nothing.

**Recommendation:** the schema should not require a variable nothing consumes.
Either implement the consumer or drop the requirement — a required setting with
no effect actively misleads whoever configures the environment.

---

## Findings

### F-01 · Safety escalations reach no human · **RESOLVED**

> **Fixed after this review.** Escalations are now recorded in
> `safety_escalations` and routed to `SAFETY_ESCALATION_WEBHOOK_URL`, with a
> worker sweep retrying anything undelivered and a failed delivery raising the
> safety alert. The payload carries no conversation content. **Q-07 — who is
> notified, and what duty attaches — is untouched and still blocks launch.**
>
> The original finding is kept below as written.

#### As originally found

**Category:** monitoring, child safety.

An escalation — the disclosure-of-harm path — does exactly two things
(`apps/api/src/routes/conversations.ts:1007`):

1. writes an audit row, `safety.escalation.raised`, with `requiresHumanReview: true`
2. logs one line at `warn`

There is no webhook call, no notification, no queue, no page. The code says so
itself:

> `// An escalation is not merely a block. It routes to the human protocol in`
> `// docs/CHILD_SAFETY.md §6 — which is unresolved (Q-07), so for now it is`
> `// recorded at the highest fidelity available and flagged loudly.`

So it is known and documented, and the code is honest. What makes it a finding
rather than a tracked gap is the configuration around it: the schema **requires**
`SAFETY_ESCALATION_WEBHOOK_URL` in production, with the message _"disclosures
must reach a human"_. Production refuses to boot without it. Nothing reads it.

Anyone setting that variable would reasonably conclude disclosures are routed.
They are not — detection works, delivery does not.

**Remediation:** implement delivery, or resolve Q-07 and say plainly in the
schema that escalation is audit-only. Do not ship a children's product where a
disclosure depends on someone reading logs.

### F-02 · No backups · **CRITICAL**

**Category:** backups. No backup script, no schedule, no retention policy, no
restore procedure, and no restore ever performed. `DEPLOYMENT.md` §10 assumes
managed Postgres with automated backups and point-in-time recovery; nothing
selects, configures, or verifies that.

This interacts badly with the forward-only migration design. `CI_CD.md` §8.2 is
explicit that an unrecoverable migration leaves restore-from-backup as the only
option — a documented procedure whose one prerequisite does not exist.

**An untested backup is not a backup.** Configure it, then restore from it into
a scratch database and confirm the data is there.

### F-03 · Rate limits are per-instance · **HIGH**

**Category:** rate limits. `@fastify/rate-limit` runs in-process. Behind _N_
instances the effective limit is _N_ × the configured value — including
`RATE_LIMIT_AUTH_PER_15_MIN=10`, which is what makes online password guessing
impractical. Three instances give an attacker 30 attempts per IP per window.

Redis is provisioned in staging and probed by `/ready`, but the limiter never
touches it. Also worth deciding deliberately: the subscription webhook route
hard-codes 600/minute where every other limit is configuration.

**Until this is fixed the API is single-instance**, which is also what F-04
requires.

### F-04 · Object storage does not exist · **HIGH**

**Category:** storage. `createMemoryAudioStorage` is the only `AudioStorage`
implementation; `STORAGE_PROVIDER` is never read. Three consequences:

- Audio does not survive a restart.
- A signed audio URL issued by one instance 404s on another.
- **The audio retention backstop cannot run.** The bytes live in whichever
  process wrote them, so a sweep from the worker would mark ledger rows deleted
  while the objects survived in the API's heap — a retention record asserting a
  deletion that did not happen. The worker refuses to schedule it and logs why
  on every boot.

### F-05 · Transcripts are never deleted · **HIGH**

**Category:** database, privacy. `RETENTION_TRANSCRIPT_DAYS` exists (30 in the
staging template) and `parental_controls.transcript_retention_days` is a
per-child setting a parent can change. Nothing deletes a message by age —
there is no purge job, no SQL function, and no scheduled sweep.

Audio retention _is_ implemented (`app.expire_audio_artifacts`, wired through
`sweepExpiredAudio`), though it cannot be scheduled while F-04 stands.

A retention control a parent can set, that does nothing, is worse than not
offering it.

### F-06 · No error tracking · **MEDIUM**

**Category:** error tracking. `SENTRY_DSN` is declared and optional; no client
is installed in any package and no code reads it. Errors reach structured logs
with request ids — real, and not the same thing. There is no aggregation, no
deduplication, no release correlation, and no alert on a new error type.

### F-07 · Alerts have nowhere to go · **HIGH**

**Category:** monitoring. Five alert conditions exist, are correct, and are
tested to fire and clear (18 tests). The default sink writes a `fatal` log line
— deliberately, so alerting does not depend on an outbound call succeeding
during a network incident. A webhook sink exists and wraps it.

**No webhook is configured, in any environment.** So today every alert,
including `safety_pipeline`, is a log line that something else would have to
notice. Nothing does.

`OTEL_EXPORTER_OTLP_ENDPOINT` is likewise declared and unread: no tracing.

### F-08 · Mobile is not release-configured · **MEDIUM**

**Category:** mobile configuration.

| Item                      | State                                                      |
| ------------------------- | ---------------------------------------------------------- |
| Bundle id / package       | `app.kidscompanion.placeholder` — explicitly a placeholder |
| Version                   | `0.0.0`                                                    |
| `eas.json`                | absent — no build profiles                                 |
| Store submission          | never attempted, correctly                                 |
| Microphone usage string   | present, and honest about what happens to recordings       |
| `RECORD_AUDIO` permission | present                                                    |
| Store secrets in the app  | **none** — verified by a dedicated test                    |

The safety-relevant parts are right. The release-relevant parts do not exist.
Kids-category review on both stores carries additional requirements not yet
addressed.

### F-09 · No domain, and therefore no real TLS · **MEDIUM**

**Categories:** domain configuration, SSL. Every hostname in the templates is an
example (`api-staging.kidscompanion.app`). No domain is registered, no DNS, no
certificate, no terminator, no CDN.

The _configuration_ is right, and enforced: `DATABASE_SSL_MODE=require` and
`REDIS_TLS_ENABLED=true` are refused otherwise in production, HSTS is set with a
two-year max-age and `preload` on both the API (helmet) and the dashboard, and a
wildcard CORS origin fails at boot. None of it has been exercised against a real
certificate.

---

## What passes, and why

### 1 · Environment configuration — PASS

158 keys in one Zod schema with cross-field rules. Configuration is validated
**before anything starts**, so a broken environment fails the deploy rather than
the first child's request — verified directly: booting without `DATABASE_URL`
exits 78 with a named error rather than starting and failing later.

Production-only rules are enforced and tested: no `mock` payment provider, TLS
required, no CORS wildcard, `LOG_LEVEL` not `trace`, both safety classifiers
non-disableable, distinct Redis key prefix, and raw-audio retention requiring an
explicit acknowledgement flag.

Three templates (`.env.example`, `.env.staging.example`, `.env.production.example`)
and `pnpm verify:deploy` fails if a deployment-critical key is missing from any
of them.

_Caveat:_ the schema requires four keys nothing reads. See the cross-cutting
finding.

### 2 · Secrets — PASS

- `verify:no-secrets` scans the repository **including git history**; runs first
  in CI.
- `.gitignore` excludes every `.env*` except templates; templates carry no values.
- **No secret in any image layer**: `.dockerignore` excludes `.env*`, and no
  Docker **build arg** is used anywhere — a build arg is readable in image
  history forever, so it publishes rather than hides.
- The web image needs no build args at all, because the dashboard reads no
  `NEXT_PUBLIC_*` values.
- `verify:deploy` fails the build if a workflow echoes a secret, dumps the
  environment, enables `set -x`, writes a secret to a step summary, or uses
  `pull_request_target`. Negative-tested.
- The pull-request workflow uses **no** secrets at all.

### 3 · Database — PASS

Forward-only migrations, immutable once merged, tracked in `schema_migrations`
with a **checksum** that refuses to apply an edited migration. CI adds
immutability, back-dating, and destructive-statement review before merge, and
applies all 28 migrations to a real PostgreSQL 17 then re-checks idempotency.

Pool bounded (`DATABASE_POOL_MAX`), statement timeout set, TLS required in every
deployed environment, migrations run as a job that completes before the
application starts.

_Not covered here:_ backups (F-02), transcript retention (F-05), and message
encryption, which uses a codec named `placeholder` — deliberately named so a
row encoded that way is obvious rather than plausible. Conversation content is
protected by RLS and database access control, not by application-layer
encryption at rest.

### 4 · RLS — PARTIAL

**Structural: complete and self-maintaining.** All **50** tables have both
`ENABLE` and `FORCE ROW LEVEL SECURITY`, verified not by inspection but by a
test that queries `pg_catalog` for any table missing either and fails if the
list is non-empty. A new table added without RLS fails CI on the next run. This
is the assertion that cannot rot.

**Behavioural: a subset.** **85** policies are declared. `rls-tenant-isolation.test.ts`
proves denial across the tenant-critical surface — cross-parent reads and
writes, planting a child into another family, writing into another family's
conversation, soft-deleted children, immutable records, operational tables
unreachable from an authenticated session, and the no-identity case. Each of the
85 is not individually driven.

_Two corrections made during this review:_ I first recorded transcript retention
as implemented because `RETENTION_RAW_AUDIO_DAYS` is wired — a different key.
And I first read two dashboard queries as duplicates; they read different
tables. Both were checked again before being written down.

### 7 · Logging — PASS

Pino with `redact` configured from a shared `REDACTED_PATHS` list, so redaction
is a property of the logger instance rather than of each call site. The
redaction module is at **100 % of lines and branches** — one of two modules
meeting its spec gate.

Every request carries a request id, returned on every response and present in
every error. The error boundary never returns database internals, driver
messages, or provider errors; readiness reports `unavailable` without saying
why, because it is reachable without credentials.

`LOG_LEVEL=trace` is refused in production.

### 15 · CORS — PASS

Explicit origin list, `credentials: true`, methods limited, 24-hour preflight
cache. A wildcard in any deployed environment fails at boot, and that rule is
tested. The dashboard additionally sets `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, a referrer policy, and a permissions policy
denying camera, microphone, and geolocation.

### 17 · Rollback strategy — PASS (documented), never rehearsed

`CI_CD.md` §8 covers it, and is correct about the part people get wrong:

- **Application:** re-run the production workflow with the previous SHA. It
  promotes the image already in the registry rather than rebuilding, so the
  rollback is the exact artifact that was running before. Approval still
  applies — a rollback is a production deployment, and the fastest way to worsen
  an incident is an unreviewed change made under pressure.
- **Database:** there is no rollback. Migrations are forward-only and
  `check-migrations.mjs` rejects any file that looks like a down migration. This
  is why every migration must be backward-compatible with the running version.
- **The case people get wrong:** if the schema has moved past what the previous
  version can read, rolling the application back makes it worse. Roll forward.

Never exercised. Its backup fallback does not exist (F-02).

---

## Payment webhooks — PARTIAL, and correctly so

The **mechanism** is sound and covered by 44 tests: HMAC signature verification
before anything else, idempotency on `(rail, external_event_id)` inserted first
in the transaction, replay-safety through both a signed timestamp and vendor
`last_event_at` ordering, and one transaction covering the event, the
subscription, the ledger and the checkout. A defect found this session — a
non-UUID reference producing a 500, which tells the rail to retry forever — is
fixed and has a regression test.

**But no payment can be taken.** `PAYMENTS_ENABLED_RAILS` and
`PAYMENTS_VERIFIED_RAILS` are both empty, and a deployed environment refuses to
boot with a rail enabled that is not also listed as verified. No rail has been
verified against its real API documentation and sandbox, so production would run
with zero rails — every family on the free tier.

That is the design working as intended rather than a defect. It is recorded as
PARTIAL because the category cannot be said to pass when the capability cannot
run.

## AI limits — PARTIAL

**Enforced and tested:** per-child daily turn limit (300 operational ceiling,
40/day by plan, whichever is lower), per-conversation turn limit, per-child
daily minutes via parental controls, request timeout, moderation timeout, retry
bound, max output tokens, context window bound.

**Not implemented:** `AI_DAILY_COST_CEILING_USD`. Per-turn cost is recorded
(`total_cost_usd`, `app.record_usage`) but nothing reads the ceiling and nothing
stops spend. Account-wide exposure is bounded only by (children × 40 turns ×
cost per turn) with no cap on signups.

---

## What must be true before this question is asked again

**Blocking, in order:**

1. **F-01** — escalation delivery. A children's product where a disclosure
   reaches no human should not launch.
2. **F-02** — backups configured _and_ a restore performed.
3. **F-04** — object storage, which also unblocks audio retention and
   multi-instance.
4. **F-03** — Redis-backed rate limiting, which also unblocks multi-instance.
5. **F-05** — transcript retention, or withdraw the control that claims it.
6. **F-07** — an alert destination that is not a log file.

**Then:** error tracking (F-06), domain and certificates (F-09), mobile release
configuration (F-08), at least one verified payment rail, and the AI cost
ceiling.

**Also outstanding, from earlier reviews:** real AES-GCM encryption replacing
the placeholder codec; no penetration test or external security review; the e2e
and browser suites have never been executed; images have never been built; the
deployment workflows have never run; no distributed lock, so exactly one worker.

---

## Confidence in this review

**Evidence-based, and incomplete in a specific way.** Every verdict cites code
that was read during the review. What could not be verified, because it does not
exist yet: any behaviour of a real deployment. No container has run, no image
has been built, no certificate has been issued, no backup has been restored.

Categories 5, 9, 13, and 14 are judged on absence of implementation, which is
straightforward. Categories 1, 2, 3, 7, and 15 are judged on code and tests that
do run. Category 4 is split because the two halves of it genuinely differ.

State of the checks at the time of this review, all green:

|                                |                                                           |
| ------------------------------ | --------------------------------------------------------- |
| Test suite                     | **1,450 passed**, 5 skipped (e2e, needs Docker), 0 failed |
| `tsc -b`, `eslint`, `prettier` | pass                                                      |
| `verify:no-secrets`            | pass                                                      |
| `verify:deploy`                | pass                                                      |
| `verify:audit`                 | pass — 2 accepted advisories, 0 blocking                  |
| `verify:references`            | pass                                                      |
| `verify:migrations`            | pass                                                      |

A green suite is not evidence of readiness, and none of the failures above would
turn a single one of those checks red. That is the point worth taking from this
document: **every one of the seven failures is invisible to CI**, because each is
something absent rather than something broken.

The test suite behind these judgements is recorded in `docs/TEST_REPORT.md`; the
security review in `docs/SECURITY_AUDIT.md`; measured behaviour under load in
`docs/PERFORMANCE_REPORT.md`. This document does not restate them and does not
supersede them.

**No production readiness declaration is made.**
