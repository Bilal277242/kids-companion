import { createMetricsRegistry, TECHNICAL_METRICS, type MetricsRegistry } from '@kids/analytics';
import type { Clock, Logger } from '@kids/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAlertMonitor,
  createLogAlertSink,
  createWebhookAlertSink,
  DEFAULT_THRESHOLDS,
  type Alert,
  type AlertSink,
} from './alerts.js';

/**
 * Alerting.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AN ALERT NOBODY HAS SEEN FIRE IS NOT AN ALERT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Until this file existed the only assertion about alerting anywhere was that
 * no alerts were firing on a healthy system — which passes just as happily
 * against a monitor that can never fire at all. That is the worst failure mode
 * available to a paging system: it is indistinguishable from a working one
 * right up to the incident, and it manufactures confidence in the meantime.
 *
 * So every condition here is driven until it actually fires, and then until it
 * clears. The two properties that decide whether people keep paying attention
 * to a pager get their own tests:
 *
 *   DOES IT FIRE when something is genuinely wrong?
 *   DOES IT STAY QUIET otherwise — no repeats, no firing on noise?
 */

const at = (iso: string): Clock => ({
  now: () => new Date(iso).getTime(),
  nowIso: () => iso as never,
});

const clock = at('2026-09-01T12:00:00.000Z');

/** Collects what was delivered, so a test can assert on it. */
const recordingSink = (): { sink: AlertSink; delivered: Alert[] } => {
  const delivered: Alert[] = [];
  return { sink: { deliver: (alert) => delivered.push(alert) }, delivered };
};

/** A registry with the technical metrics the monitor reads already defined. */
const registryWith = (options: {
  requests?: number;
  errors?: number;
  p99Ms?: number;
}): MetricsRegistry => {
  const registry = createMetricsRegistry();
  registry.counter(TECHNICAL_METRICS.requestsTotal, 'requests');
  registry.counter(TECHNICAL_METRICS.errorsTotal, 'errors');
  registry.histogram(TECHNICAL_METRICS.requestDuration, 'duration', 'ms');

  if (options.requests !== undefined) {
    registry.increment(TECHNICAL_METRICS.requestsTotal, { route: '/x' }, options.requests);
  }
  if (options.errors !== undefined) {
    registry.increment(TECHNICAL_METRICS.errorsTotal, { route: '/x' }, options.errors);
  }
  if (options.p99Ms !== undefined) {
    // One observation is enough: with a single sample every percentile is it.
    registry.observe(TECHNICAL_METRICS.requestDuration, options.p99Ms, { route: '/x' });
  }

  return registry;
};

describe('alert monitor', () => {
  /* ======================================================================== */
  /* Safety — the condition that matters most                                 */
  /* ======================================================================== */

  describe('safety pipeline', () => {
    it('fires on the very first failure', () => {
      const { sink, delivered } = recordingSink();
      const monitor = createAlertMonitor({ registry: registryWith({}), sink, clock });

      monitor.reportSafetyFailure('classifier timed out');

      /* No threshold, no rate, no second occurrence. Every other condition here
       * means the product is down; this one means the product is UP and the
       * layer that decides what reaches a child is not working. */
      expect(delivered).toHaveLength(1);
      expect(delivered[0]?.condition).toBe('safety_pipeline');
      expect(delivered[0]?.severity).toBe('critical');
      expect(delivered[0]?.observed.detail).toBe('classifier timed out');
      expect(delivered[0]?.firstSeenAt).toBe('2026-09-01T12:00:00.000Z');
    });

    it('does not deliver the same alert again while it is still firing', () => {
      const { sink, delivered } = recordingSink();
      const monitor = createAlertMonitor({ registry: registryWith({}), sink, clock });

      monitor.reportSafetyFailure('first');
      monitor.reportSafetyFailure('second');
      monitor.reportSafetyFailure('third');

      // An alert that repeats every minute is an alert that gets muted, and a
      // muted alert is the one nobody sees during the next incident.
      expect(delivered).toHaveLength(1);
      expect(monitor.active()).toHaveLength(1);
    });
  });

  /* ======================================================================== */
  /* Error rate                                                               */
  /* ======================================================================== */

  describe('error rate', () => {
    it('stays quiet on a small sample, however bad it looks', () => {
      const { sink, delivered } = recordingSink();
      // Three requests, two of them failures: 67%, and utterly meaningless.
      const registry = registryWith({ requests: 3, errors: 2 });
      const monitor = createAlertMonitor({ registry, sink, clock });

      expect(monitor.evaluate()).toEqual([]);
      expect(delivered).toEqual([]);
    });

    it('fires once the sample is big enough and the rate is past the threshold', () => {
      const { sink, delivered } = recordingSink();
      const registry = registryWith({ requests: 200, errors: 20 });
      const monitor = createAlertMonitor({ registry, sink, clock });

      const raised = monitor.evaluate();

      expect(raised).toHaveLength(1);
      expect(raised[0]?.condition).toBe('error_rate');
      expect(raised[0]?.observed.rate).toBeCloseTo(0.1, 3);
      expect(delivered).toHaveLength(1);
    });

    it('does not fire at exactly the sample floor with an acceptable rate', () => {
      const { sink } = recordingSink();
      // 50 requests, 2 errors — 4%, just under the 5% threshold.
      const registry = registryWith({ requests: DEFAULT_THRESHOLDS.minimumSample, errors: 2 });
      const monitor = createAlertMonitor({ registry, sink, clock });

      expect(monitor.evaluate()).toEqual([]);
    });

    it('clears when the rate recovers, and can fire again afterwards', () => {
      const { sink, delivered } = recordingSink();
      const registry = registryWith({ requests: 100, errors: 20 });
      const monitor = createAlertMonitor({ registry, sink, clock });

      expect(monitor.evaluate()).toHaveLength(1);
      expect(monitor.active()).toHaveLength(1);

      // Traffic recovers: a further 900 clean requests drags the rate to 2%.
      registry.increment(TECHNICAL_METRICS.requestsTotal, { route: '/x' }, 900);
      expect(monitor.evaluate()).toEqual([]);
      expect(monitor.active()).toEqual([]);

      /* The point of clearing. A condition that recovers and breaks again is a
       * second incident and must page a second time — a latch that never
       * releases turns the next outage into silence. */
      registry.increment(TECHNICAL_METRICS.errorsTotal, { route: '/x' }, 400);
      expect(monitor.evaluate()).toHaveLength(1);
      expect(delivered).toHaveLength(2);
    });
  });

  /* ======================================================================== */
  /* Latency                                                                  */
  /* ======================================================================== */

  describe('latency', () => {
    it('fires when p99 crosses the threshold', () => {
      const { sink, delivered } = recordingSink();
      const registry = registryWith({ p99Ms: DEFAULT_THRESHOLDS.latencyP99Ms + 1 });
      const monitor = createAlertMonitor({ registry, sink, clock });

      const raised = monitor.evaluate();

      expect(raised).toHaveLength(1);
      expect(raised[0]?.condition).toBe('latency');
      // A warning, not a critical: slow is not the same as down.
      expect(raised[0]?.severity).toBe('warning');
      expect(delivered).toHaveLength(1);
    });

    it('stays quiet when nothing has been measured yet', () => {
      const { sink } = recordingSink();
      // A registry with no observations reports p99 of zero. Zero must read as
      // "no data", never as "instant" and never as an alert.
      const monitor = createAlertMonitor({ registry: registryWith({}), sink, clock });

      expect(monitor.evaluate()).toEqual([]);
      expect(monitor.active()).toEqual([]);
    });

    it('takes the worst route, not the average of them', () => {
      const { sink } = recordingSink();
      const registry = registryWith({});
      registry.observe(TECHNICAL_METRICS.requestDuration, 5, { route: '/fast' });
      registry.observe(TECHNICAL_METRICS.requestDuration, 30_000, { route: '/slow' });

      const monitor = createAlertMonitor({ registry, sink, clock });

      /* Averaging routes is how a broken endpoint hides behind a healthy one:
       * the health check is fast and frequent, so the mean stays beautiful
       * while the endpoint children actually use has stopped answering. */
      const raised = monitor.evaluate();
      expect(raised).toHaveLength(1);
      expect(raised[0]?.observed.p99Ms).toBe(30_000);
    });
  });

  /* ======================================================================== */
  /* AI provider                                                              */
  /* ======================================================================== */

  describe('ai provider', () => {
    it('tolerates failures below the threshold', () => {
      const { sink, delivered } = recordingSink();
      const monitor = createAlertMonitor({ registry: registryWith({}), sink, clock });

      for (let i = 0; i < DEFAULT_THRESHOLDS.aiFailures - 1; i += 1) monitor.reportAiFailure();

      // One provider hiccup is a retry, not an incident.
      expect(delivered).toEqual([]);
    });

    it('fires after enough consecutive failures', () => {
      const { sink, delivered } = recordingSink();
      const monitor = createAlertMonitor({ registry: registryWith({}), sink, clock });

      for (let i = 0; i < DEFAULT_THRESHOLDS.aiFailures; i += 1) monitor.reportAiFailure();

      expect(delivered).toHaveLength(1);
      expect(delivered[0]?.condition).toBe('ai_provider');
    });

    it('a success resets the run, so intermittent failures never accumulate', () => {
      const { sink, delivered } = recordingSink();
      const monitor = createAlertMonitor({ registry: registryWith({}), sink, clock });

      /* CONSECUTIVE is the load-bearing word. A provider that fails one call in
       * five is annoying; a counter that never resets would eventually page
       * about it anyway, and that alert would be meaningless by the time it
       * arrived. */
      for (let i = 0; i < 20; i += 1) {
        monitor.reportAiFailure();
        monitor.reportAiSuccess();
      }

      expect(delivered).toEqual([]);
    });

    it('clears on recovery and can fire again', () => {
      const { sink, delivered } = recordingSink();
      const monitor = createAlertMonitor({ registry: registryWith({}), sink, clock });

      for (let i = 0; i < DEFAULT_THRESHOLDS.aiFailures; i += 1) monitor.reportAiFailure();
      expect(monitor.active()).toHaveLength(1);

      monitor.reportAiSuccess();
      expect(monitor.active()).toEqual([]);

      for (let i = 0; i < DEFAULT_THRESHOLDS.aiFailures; i += 1) monitor.reportAiFailure();
      expect(delivered).toHaveLength(2);
    });
  });

  /* ======================================================================== */
  /* Database                                                                 */
  /* ======================================================================== */

  it('fires on a database failure and reports it as critical', () => {
    const { sink, delivered } = recordingSink();
    const monitor = createAlertMonitor({ registry: registryWith({}), sink, clock });

    monitor.reportDatabaseFailure('connection refused');

    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.condition).toBe('database');
    expect(delivered[0]?.severity).toBe('critical');
  });

  it('lists every condition currently firing', () => {
    const { sink } = recordingSink();
    const monitor = createAlertMonitor({ registry: registryWith({}), sink, clock });

    monitor.reportDatabaseFailure('gone');
    monitor.reportSafetyFailure('gone too');

    expect(
      monitor
        .active()
        .map((alert) => alert.condition)
        .sort(),
    ).toEqual(['database', 'safety_pipeline']);
  });
});

/* ========================================================================== */
/* Sinks                                                                      */
/* ========================================================================== */

describe('alert sinks', () => {
  const alert: Alert = {
    condition: 'database',
    severity: 'critical',
    summary: 'The database is unreachable.',
    observed: { detail: 'connection refused' },
    firstSeenAt: '2026-09-01T12:00:00.000Z',
  };

  let logger: Logger;
  let fatal: ReturnType<typeof vi.fn>;
  let error: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fatal = vi.fn();
    error = vi.fn();
    logger = { fatal, error } as unknown as Logger;
  });

  it('logs at fatal, which is already routed everywhere', () => {
    createLogAlertSink(logger).deliver(alert);

    expect(fatal).toHaveBeenCalledTimes(1);
    const [payload, message] = fatal.mock.calls[0] as [Record<string, unknown>, string];
    expect(payload.alert).toBe('database');
    expect(message).toBe('The database is unreachable.');
  });

  it('posts to the webhook and still writes the log line', async () => {
    const posted: string[] = [];
    const sink = createWebhookAlertSink(createLogAlertSink(logger), {
      url: 'https://pager.invalid/hook',
      post: async (_url, body) => {
        posted.push(body);
        return await Promise.resolve();
      },
      logger,
    });

    sink.deliver(alert);
    await Promise.resolve();

    expect(fatal).toHaveBeenCalledTimes(1);
    expect(posted).toHaveLength(1);
    expect(JSON.parse(posted[0]!)).toMatchObject({ condition: 'database' });
  });

  it('survives a webhook that fails, because the log is the reliable path', async () => {
    const sink = createWebhookAlertSink(createLogAlertSink(logger), {
      url: 'https://pager.invalid/hook',
      post: async () => await Promise.reject(new Error('pager is down')),
      logger,
    });

    /* The pager being down must not become its own incident. An unhandled
     * rejection here would crash the process during the outage the alert was
     * trying to report. */
    expect(() => sink.deliver(alert)).not.toThrow();

    // Let the rejection settle.
    await new Promise((resolve) => setImmediate(resolve));

    expect(fatal).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
