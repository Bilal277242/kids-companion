import { describe, expect, it } from 'vitest';

import { ConfigurationError, parseConfig } from './load.js';

/** The minimum a deployed environment needs before the strict rules apply. */
const deployedBase = {
  APP_ENV: 'production',
  NODE_ENV: 'production',
  DATABASE_SSL_MODE: 'require',
  REDIS_TLS_ENABLED: 'true',
  REDIS_KEY_PREFIX: 'kc:prod:',
  SAFETY_ESCALATION_WEBHOOK_URL: 'https://alerts.example.com/hook',
  ALERT_WEBHOOK_URL: 'https://alerts.example.com/ops',
  CORS_ALLOWED_ORIGINS: 'https://app.example.com',
  // A deployed environment must name a real rail; the mock one is refused.
  PAYMENTS_PROVIDER: 'stripe',
  STRIPE_SECRET_KEY: 'sk_test_not_a_real_key',
  STRIPE_WEBHOOK_SECRET: 'whsec_not_a_real_secret',
} as const;

describe('parseConfig', () => {
  it('applies safe defaults so a clean checkout boots with an empty environment', () => {
    const config = parseConfig({});

    expect(config.APP_ENV).toBe('local');
    expect(config.API_PORT).toBe(8080);
    // Every external provider defaults to a mock, so no API keys are needed.
    expect(config.AI_PROVIDER).toBe('mock');
    expect(config.STT_PROVIDER).toBe('mock');
    expect(config.TTS_PROVIDER).toBe('mock');
  });

  it('defaults raw audio retention to zero days', () => {
    // The highest-risk data decision available to us defaults to "do not retain".
    // See docs/adr/0006-voice-pipeline-and-audio-retention.md.
    expect(parseConfig({}).RETENTION_RAW_AUDIO_DAYS).toBe(0);
  });

  it('rejects a value that does not parse rather than coercing it', () => {
    expect(() => parseConfig({ API_PORT: 'not-a-port' })).toThrow(ConfigurationError);
  });

  it('rejects an unrecognised boolean instead of silently reading it as false', () => {
    expect(() => parseConfig({ METRICS_ENABLED: 'yes' })).toThrow(ConfigurationError);
  });

  it('normalises durations to seconds', () => {
    const config = parseConfig({ AUTH_ACCESS_TOKEN_TTL: '15m', CHILD_SESSION_TTL: '2h' });

    expect(config.AUTH_ACCESS_TOKEN_TTL).toBe(900);
    expect(config.CHILD_SESSION_TTL).toBe(7_200);
  });

  it('parses a comma-separated list into trimmed entries', () => {
    const config = parseConfig({ CORS_ALLOWED_ORIGINS: 'https://a.com, https://b.com ' });

    expect(config.CORS_ALLOWED_ORIGINS).toEqual(['https://a.com', 'https://b.com']);
  });

  it('names every failing variable, not just the first', () => {
    try {
      parseConfig({ API_PORT: 'nope', METRICS_ENABLED: 'maybe' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      const { issues } = error as ConfigurationError;
      expect(issues.join('\n')).toContain('API_PORT');
      expect(issues.join('\n')).toContain('METRICS_ENABLED');
    }
  });

  it('rejects a secret still set to the .env.example placeholder', () => {
    expect(() => parseConfig({ AUTH_JWT_SECRET: 'replace-me-min-32-chars-high-entropy' })).toThrow(
      ConfigurationError,
    );
  });
});

describe('cross-field rules', () => {
  it('requires the provider credential when that provider is selected', () => {
    expect(() => parseConfig({ AI_PROVIDER: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('requires a webhook secret when the Stripe rail is selected', () => {
    // An unverified webhook endpoint is a free-subscription vulnerability, so
    // the credential that verifies signatures is required to boot, not checked
    // on the first webhook.
    expect(() => parseConfig({ PAYMENTS_PROVIDER: 'stripe' })).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * THE MOCK RAIL CANNOT REACH A DEPLOYED ENVIRONMENT.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Its signing key is a documented default in `.env.example`. In production
   * that is not a mock — it is a webhook endpoint anyone who has read the repo
   * can post a valid `subscription.activated` to.
   */
  it('refuses the mock payment rail outside local and ci', () => {
    expect(() => parseConfig({ ...deployedBase, PAYMENTS_PROVIDER: 'mock' })).toThrow(
      /PAYMENTS_PROVIDER/,
    );
  });

  it('accepts a fully specified production environment', () => {
    expect(() => parseConfig({ ...deployedBase })).not.toThrow();
  });

  it('refuses to start production with the input safety classifier disabled', () => {
    expect(() =>
      parseConfig({ ...deployedBase, SAFETY_INPUT_CLASSIFIER_ENABLED: 'false' }),
    ).toThrow(/SAFETY_INPUT_CLASSIFIER_ENABLED/);
  });

  it('refuses to start production with the output safety classifier disabled', () => {
    expect(() =>
      parseConfig({ ...deployedBase, SAFETY_OUTPUT_CLASSIFIER_ENABLED: 'false' }),
    ).toThrow(/SAFETY_OUTPUT_CLASSIFIER_ENABLED/);
  });

  it('refuses to start production without an escalation route for disclosures', () => {
    const { SAFETY_ESCALATION_WEBHOOK_URL: _omitted, ...withoutWebhook } = deployedBase;

    expect(() => parseConfig(withoutWebhook)).toThrow(/SAFETY_ESCALATION_WEBHOOK_URL/);
  });

  it('refuses to start production with nowhere for an alert to go', () => {
    /* Five alert conditions existed, were correct, were tested — and every one
     * of them delivered a log line that nothing was watching. A paging system
     * nobody receives is indistinguishable from a working one right up to the
     * incident, which is why this is a boot refusal rather than a warning. */
    const { ALERT_WEBHOOK_URL: _omitted, ...withoutAlerts } = deployedBase;

    expect(() => parseConfig(withoutAlerts)).toThrow(/ALERT_WEBHOOK_URL/);
  });

  it('does not require an alert destination outside production', () => {
    // Local and CI have no pager and should not pretend to.
    expect(() => parseConfig({})).not.toThrow();
    expect(parseConfig({}).ALERT_WEBHOOK_URL).toBeUndefined();
  });

  it('refuses to retain raw child audio in production without explicit acknowledgement', () => {
    expect(() => parseConfig({ ...deployedBase, RETENTION_RAW_AUDIO_DAYS: '30' })).toThrow(
      /RETENTION_RAW_AUDIO_DAYS/,
    );
  });

  it('allows raw audio retention in production once acknowledged', () => {
    expect(() =>
      parseConfig({
        ...deployedBase,
        RETENTION_RAW_AUDIO_DAYS: '30',
        RETENTION_RAW_AUDIO_OPT_IN_ACK: 'approved-2026-08-17-parent-opt-in-only',
      }),
    ).not.toThrow();
  });

  it('rejects a wildcard CORS origin in a deployed environment', () => {
    expect(() => parseConfig({ ...deployedBase, CORS_ALLOWED_ORIGINS: '*' })).toThrow(
      /CORS_ALLOWED_ORIGINS/,
    );
  });

  it('requires database TLS in a deployed environment', () => {
    expect(() => parseConfig({ ...deployedBase, DATABASE_SSL_MODE: 'disable' })).toThrow(
      /DATABASE_SSL_MODE/,
    );
  });

  it('rejects trace-level logging in production', () => {
    expect(() => parseConfig({ ...deployedBase, LOG_LEVEL: 'trace' })).toThrow(/LOG_LEVEL/);
  });

  it('rejects the local Redis key prefix in production', () => {
    expect(() => parseConfig({ ...deployedBase, REDIS_KEY_PREFIX: 'kc:local:' })).toThrow(
      /REDIS_KEY_PREFIX/,
    );
  });

  it('does not apply deployed-environment rules to local', () => {
    // Local development must stay frictionless: no TLS, no wildcarding rules.
    expect(() => parseConfig({ APP_ENV: 'local', DATABASE_SSL_MODE: 'disable' })).not.toThrow();
  });
});
