# Analytics and observability

Two pipelines that look similar and are governed by opposite rules.

---

## 1. The rule everything follows

> **Privacy requirements override analytics requirements.**

Not as a principle to weigh against others — as the thing that decides the
architecture. Concretely:

- **No child-scoped event ever leaves this system.** Not pseudonymously, not
  aggregated, not at all. `sanitiseEvent` refuses it.
- **No metric label may carry an identifier.** `assertLabelsAreDimensions`
  throws, and the route label is the pattern (`/api/parent/dashboard/:childId`),
  never the URL.
- **Product questions about children are answered from aggregates in our own
  database**, computed by SQL functions that return counts and ratios and
  cannot return a row per person.
- **Analytics is off by default.** `ANALYTICS_ENABLED=false` ships the no-op
  provider. The burden is on whoever wants the data.

---

## 2. Two destinations, not equally trusted

|                          | Internal                     | External             |
| ------------------------ | ---------------------------- | -------------------- |
| Where                    | our `analytics_events` table | a third-party vendor |
| Retention                | our sweep, 395 days          | theirs               |
| Deleted with the account | yes                          | not reliably         |
| Child-scoped events      | permitted                    | **never**            |
| Account-scoped events    | permitted                    | permitted            |

A parent consented to their child talking to a character in our product. They
did not consent to a behavioural record of that child accumulating at a vendor
under that vendor's policy.

What a third party may receive is the parent-facing commercial funnel — an
account was created, a plan was viewed, a subscription started. Facts about a
customer, which is what product analytics is actually for.

### The event catalogue is an allow-list

An event not in `EVENT_CATALOGUE` is refused. Every entry carries a stated
purpose and the exact properties it may hold, so shipping a new one is a
decision somebody makes on purpose.

`sanitiseEvent` applies five rules in order, and each **refuses** rather than
redacting — a silently redacted event is one nobody notices is wrong until a
dashboard built on it is empty:

1. the event is in the catalogue,
2. the destination is permitted for its scope,
3. the subject is a pseudonym, not a raw id,
4. every property is declared,
5. no property **value** is an identifier or free text.

Rule 5 is the one that earns its keep. `reason` is a perfectly reasonable
declared property, and it is where a child's sentence ends up.

---

## 3. Never collected

- Session replay or screen recording.
- Device fingerprinting, and no advertising identifier.
- Any cross-application identity graph.
- A per-message or per-utterance event stream.
- Anything a child said, or how well they said it.
- Precise location — country at most, and only for the account.

Each of these is unremarkable in a consumer app and inappropriate in one used by
five-year-olds.

---

## 4. Technical metrics

`GET /metrics`, Prometheus text format, outside `/api` because it is
infrastructure rather than product surface.

Response time with p50/p95/p99, request volume, error rate, CPU, memory, event
loop lag, database connections, AI quota, queue size, and storage — the full
list is `TECHNICAL_METRICS`.

Three decisions worth knowing:

- **Percentiles use nearest rank, not interpolation.** An interpolated p99
  reports a latency no request experienced, and somebody chasing a slow endpoint
  wants a real number.
- **The histogram reservoir is bounded** (a ring, biased toward recent
  observations) but **count and sum are exact for all time** — an average that
  quietly covered only the last 2,048 requests would be a different number from
  the one anyone expects.
- **4xx is volume, not error.** A client being told no is the system working;
  counting it as an error makes the error rate a measure of how many people
  mistype a password.

### Why in-process rather than a vendor SDK

A metrics client is a long-lived process that batches data to a third party.
This application handles children's conversations, and the only feature we
actually need is a histogram.

---

## 5. Structured logging and request ids

Both already existed and are unchanged: `createLogger` emits JSON, every request
gets an id (`x-request-id`, echoed in error bodies so a parent can quote it),
and `redactObject` strips sensitive paths before anything is written.

Error tracking is the existing error boundary — an `AppError` taxonomy with a
per-category log level, a request id on every failure, and no stack or internal
hostname in any client-facing body.

---

## 6. Alerts

Five conditions, not fifty. An alert that fires often is one nobody reads, and a
paging system nobody reads converts a real outage into a notification somebody
swipes away at 2 a.m. Every entry answers: **would a person have to get out of
bed for this?**

| Condition         | Severity | Fires on                                |
| ----------------- | -------- | --------------------------------------- |
| `safety_pipeline` | critical | the **first** occurrence                |
| `error_rate`      | critical | ≥5% of requests failing, min 50 samples |
| `latency`         | warning  | p99 ≥ 10s                               |
| `database`        | critical | unreachable                             |
| `ai_provider`     | critical | 5 consecutive failures                  |

**`safety_pipeline` is the one that matters most.** Every other condition means
the product is down. That one means the product is **up and unsafe** — children
are talking and the layer that checks what reaches them is not working. One
occurrence is enough.

Each condition has a producer, and they are worth naming because for a long
time three of them had none:

| Condition         | Reported by                                                   |
| ----------------- | ------------------------------------------------------------- |
| `safety_pipeline` | every conversation and voice turn (`turn-health.ts`)          |
| `ai_provider`     | the same, on a provider timeout or outage                     |
| `database`        | the readiness probe, which already runs against the real pool |
| `error_rate`      | the metrics registry, on the evaluation timer                 |
| `latency`         | the same                                                      |

**A blocked turn is not a safety failure.** It is the pipeline working: a rule
fired and a reply was stopped. The failure is `safety_unavailable` — the
classifier could not be reached, so the pipeline failed closed and children are
hitting a wall mid-conversation.

### 6.1 Where an alert goes

`ALERT_WEBHOOK_URL` is **required in production**. Without it every alert is a
`fatal` log line that something else would have to notice.

The log line is written either way and is never removed: every deployment
already ships logs somewhere, and an alerting path with a network dependency
fails exactly when it is needed. The webhook is layered on top of it, not
substituted for it — if the post fails, the alert is still recorded.

`ALERT_WEBHOOK_FORMAT` selects the body:

- `generic` — a JSON object (`event`, `condition`, `severity`, `summary`,
  `observed`). Point an Alertmanager receiver, an Opsgenie custom webhook, or
  anything in-house at it.
- `slack` — the incoming-webhook `text` shape, which Mattermost and others also
  accept.

Three attempts, briefly spaced, then it gives up and the log line stands alone.
A 4xx other than 429 is not retried. **The URL is a credential** — a Slack
incoming-webhook URL lets anyone holding it post into the channel — so it is
never written to a log, never included in an error message, and never placed in
an alert body.

An alert body carries the condition, the severity, and the measurement that
tripped it. **It never carries conversation content.**

### 6.2 Firing, and stopping

An alert already firing is not re-delivered — a condition that pages every
minute is one that gets muted.

It clears when the measurement recovers, or when nothing has reported it for
`reArmAfterMs` (15 minutes), and **a resolution is delivered when it does**.
That window exists because `safety_pipeline` and `database` are only ever told
about failures: with no way to clear them and no re-delivery, they fired once
per process and then went silent for good.

---

## 7. Product metrics

`GET /api/admin/metrics/product`, staff-only (`audit:read`), every figure an
aggregate computed by SQL in our own database.

Activation funnel · conversation completion and duration · feature adoption ·
weekly retention cohorts · subscription conversion · churn · MRR · ARR.

Two details worth checking if you change them:

- **MRR normalises every billing interval to a month** — weekly × 52/12, yearly
  ÷ 12. Counting a yearly plan at full price is the classic SaaS reporting
  error: MRR jumps twelvefold the month it sells and collapses the month after.
- **Voluntary and involuntary churn are separate.** A cancellation is a product
  problem; an expiry after a failed payment is a payments problem. Conflating
  them hides a broken rail behind "churn".

There is deliberately **no engagement score** — a number that would invite
someone to optimise how long a child stays in the app, which is the opposite of
what this product is for.

---

## 8. Known limitations

- **Tracing is declared and unread.** `OTEL_EXPORTER_OTLP_ENDPOINT` is a
  configuration key with no exporter behind it.
- **`ai_quota_remaining`, `queue_size`, and `storage_bytes` are registered but
  not yet populated** — the providers that would report them do not expose the
  figures today. They render as empty series rather than as zeros, which is the
  honest state.
- **Database connection gauges are not wired** to the PGlite test adapter, so
  they are empty in tests.
- **No external analytics provider is implemented.** The port and the gate
  exist; `ANALYTICS_PROVIDER` accepts `posthog` in configuration and nothing
  implements it. Adding one is a provider that receives already-sanitised
  account-scoped events.
- **Retention is weekly cohorts only.** No daily or monthly rollup.
