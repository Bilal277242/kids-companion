import { TECHNICAL_METRICS, type MetricsRegistry } from '@kids/analytics';
import type { Clock, Logger } from '@kids/shared';

/**
 * Alerts for critical backend failures.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * FIVE CONDITIONS. NOT FIFTY.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * An alert that fires often is an alert nobody reads, and a paging system
 * nobody reads is worse than none — it converts a real outage into one more
 * notification somebody swipes away at 2 a.m.
 *
 * So the list is short, and every entry answers the same question: **would a
 * person have to get out of bed for this?** Anything that would not is a
 * dashboard line, not an alert.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SAFETY ALERT IS DIFFERENT, AND IT IS THE ONE THAT MATTERS MOST.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every other condition here is about the product being down. `safety_pipeline`
 * is about the product being UP and unsafe, which is worse: children are
 * talking and the layer that checks what reaches them is not working. It fires
 * on the first occurrence rather than on a rate, because one is enough.
 */

export const ALERT_CONDITIONS = [
  'safety_pipeline',
  'error_rate',
  'latency',
  'database',
  'ai_provider',
] as const;
export type AlertCondition = (typeof ALERT_CONDITIONS)[number];

export type AlertSeverity = 'critical' | 'warning';

export interface Alert {
  readonly condition: AlertCondition;
  readonly severity: AlertSeverity;
  /** What is wrong, in a sentence somebody woken up can act on. */
  readonly summary: string;
  /** The measurement that tripped it, so nobody has to go and find it. */
  readonly observed: Readonly<Record<string, number | string>>;
  readonly firstSeenAt: string;
}

export interface AlertThresholds {
  /** Fraction of requests returning 5xx, over the sample window. */
  readonly errorRate: number;
  /** p99 request latency, milliseconds. */
  readonly latencyP99Ms: number;
  /** Minimum requests before a rate means anything. */
  readonly minimumSample: number;
  /** Consecutive AI provider failures. */
  readonly aiFailures: number;
}

export const DEFAULT_THRESHOLDS: AlertThresholds = Object.freeze({
  // 5% of requests failing is well past "a bad deploy" and into "customers
  // cannot use the product".
  errorRate: 0.05,
  // Ten seconds at p99. A child asked a question and the character went silent.
  latencyP99Ms: 10_000,
  // Below this, a rate is noise: two errors out of three requests at 4 a.m. is
  // not an outage, it is a health check and a crawler.
  minimumSample: 50,
  aiFailures: 5,
});

export interface AlertSink {
  /**
   * Delivers an alert.
   *
   * Never throws, and never blocks the caller — an alerting system that can
   * fail the request it is alerting about has made the outage worse.
   */
  deliver(alert: Alert): void;
}

/**
 * The default sink: a structured log line at `fatal`.
 *
 * Deliberately not an HTTP call to a pager by default. Every deployment already
 * ships logs somewhere, `fatal` is already routed, and adding an outbound
 * dependency to the alerting path means the alert fails when the network does —
 * which is exactly when it is needed.
 *
 * A webhook sink is available for deployments that want one, and it wraps this
 * rather than replacing it.
 */
export const createLogAlertSink = (logger: Logger): AlertSink => ({
  deliver: (alert) => {
    logger.fatal(
      {
        alert: alert.condition,
        severity: alert.severity,
        observed: alert.observed,
        firstSeenAt: alert.firstSeenAt,
      },
      alert.summary,
    );
  },
});

/**
 * Adds an outbound webhook, keeping the log line.
 *
 * The log is the reliable path; the webhook is the fast one. If the webhook
 * fails the alert is still recorded, which is the whole reason it is layered
 * this way rather than substituted.
 */
export const createWebhookAlertSink = (
  base: AlertSink,
  options: {
    readonly url: string;
    readonly post: (url: string, body: string) => Promise<void>;
    readonly logger: Logger;
  },
): AlertSink => ({
  deliver: (alert) => {
    base.deliver(alert);

    void options
      .post(
        options.url,
        JSON.stringify({
          condition: alert.condition,
          severity: alert.severity,
          summary: alert.summary,
          observed: alert.observed,
          firstSeenAt: alert.firstSeenAt,
        }),
      )
      .catch((error: unknown) => {
        // Swallowed on purpose. The alert is already in the log, and an
        // unhandled rejection from the alerting path would be its own incident.
        options.logger.error({ err: error }, 'alert webhook failed');
      });
  },
});

/* -------------------------------------------------------------------------- */
/* Evaluation                                                                  */
/* -------------------------------------------------------------------------- */

export interface AlertMonitor {
  /** Checks every condition. Called on a timer, and by the health endpoint. */
  evaluate(): readonly Alert[];
  /** Reports a safety-pipeline failure. Fires on the first one. */
  reportSafetyFailure(detail: string): void;
  /** Reports an AI provider failure. Fires after several in a row. */
  reportAiFailure(): void;
  reportAiSuccess(): void;
  /** Reports a database connectivity failure. */
  reportDatabaseFailure(detail: string): void;
  /** Alerts currently firing, for the health endpoint. */
  active(): readonly Alert[];
}

export const createAlertMonitor = (options: {
  readonly registry: MetricsRegistry;
  readonly sink: AlertSink;
  readonly clock: Clock;
  readonly thresholds?: AlertThresholds;
}): AlertMonitor => {
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const { registry, sink, clock } = options;

  const firing = new Map<AlertCondition, Alert>();
  let consecutiveAiFailures = 0;

  /**
   * Raises an alert, once.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * AN ALERT THAT REPEATS EVERY MINUTE IS AN ALERT THAT GETS MUTED.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * A condition that is already firing is not re-delivered. It clears when the
   * measurement recovers, and only then can it fire again.
   */
  const raise = (
    condition: AlertCondition,
    severity: AlertSeverity,
    summary: string,
    observed: Readonly<Record<string, number | string>>,
  ): Alert | undefined => {
    const existing = firing.get(condition);
    if (existing) return undefined;

    const alert: Alert = {
      condition,
      severity,
      summary,
      observed,
      firstSeenAt: clock.nowIso(),
    };
    firing.set(condition, alert);
    sink.deliver(alert);
    return alert;
  };

  const clear = (condition: AlertCondition): void => {
    firing.delete(condition);
  };

  /** Totals a counter across every label combination. */
  const counterTotal = (name: string): number => {
    const snapshot = registry.snapshot()[name];
    if (!Array.isArray(snapshot)) return 0;
    return snapshot.reduce<number>(
      (sum, entry) =>
        sum +
        (typeof (entry as { value?: number }).value === 'number'
          ? (entry as { value: number }).value
          : 0),
      0,
    );
  };

  /** The worst p99 across every route. */
  const worstP99 = (): number => {
    const snapshot = registry.snapshot()[TECHNICAL_METRICS.requestDuration];
    if (!Array.isArray(snapshot)) return 0;
    return snapshot.reduce<number>(
      (worst, entry) => Math.max(worst, (entry as { p99?: number }).p99 ?? 0),
      0,
    );
  };

  return {
    evaluate: () => {
      const raised: Alert[] = [];

      /* ---- Error rate ---- */
      const requests = counterTotal(TECHNICAL_METRICS.requestsTotal);
      const errors = counterTotal(TECHNICAL_METRICS.errorsTotal);

      if (requests >= thresholds.minimumSample) {
        const rate = errors / requests;
        if (rate >= thresholds.errorRate) {
          const alert = raise(
            'error_rate',
            'critical',
            `${String(Math.round(rate * 100))}% of requests are failing.`,
            { rate: Math.round(rate * 1_000) / 1_000, requests, errors },
          );
          if (alert) raised.push(alert);
        } else {
          clear('error_rate');
        }
      }

      /* ---- Latency ---- */
      const p99 = worstP99();
      if (p99 >= thresholds.latencyP99Ms) {
        const alert = raise(
          'latency',
          'warning',
          `p99 request latency is ${String(Math.round(p99))} ms — a child is waiting and the character is silent.`,
          { p99Ms: Math.round(p99) },
        );
        if (alert) raised.push(alert);
      } else if (p99 > 0) {
        clear('latency');
      }

      return raised;
    },

    /* ------------------------------------------------------------------ */
    /* Safety                                                              */
    /* ------------------------------------------------------------------ */
    /* The one condition with no threshold and no rate. The safety pipeline
     * fails closed, so a failure means turns are being refused — but it can
     * also mean the classifier is unavailable and children are hitting a wall
     * mid-conversation. Either way somebody needs to know now, not after five
     * more occurrences. */
    reportSafetyFailure: (detail) => {
      raise('safety_pipeline', 'critical', 'The safety pipeline is failing.', { detail });
    },

    reportAiFailure: () => {
      consecutiveAiFailures += 1;
      if (consecutiveAiFailures >= thresholds.aiFailures) {
        raise(
          'ai_provider',
          'critical',
          'The AI provider is failing repeatedly. Children are seeing the fallback reply.',
          { consecutiveFailures: consecutiveAiFailures },
        );
      }
    },

    reportAiSuccess: () => {
      consecutiveAiFailures = 0;
      clear('ai_provider');
    },

    reportDatabaseFailure: (detail) => {
      raise('database', 'critical', 'The database is unreachable.', { detail });
    },

    active: () => [...firing.values()],
  };
};
