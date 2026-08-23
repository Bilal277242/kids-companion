import { randomBytes } from 'node:crypto';

import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import {
  createAnthropicProvider,
  createConversationEngine,
  createMockProvider,
  type AIProvider,
} from '@kids/ai';
import { createMetricsRegistry, type MetricsRegistry } from '@kids/analytics';
import {
  createLocalAuthAdapter,
  createSessionService,
  createSupabaseAuthAdapter,
  createTokenService,
  type AuthProvider,
} from '@kids/auth';
import type { Config } from '@kids/config';
import type { Database } from '@kids/db';
import {
  createMockSubscriptionProvider,
  createAppleStoreProvider,
  createGooglePlayProvider,
  createMockStoreProvider,
  createRailRegistry,
  describeRegistry,
  type CardConfig,
  type CarrierBillingConfig,
  type EasypaisaConfig,
  type JazzCashConfig,
  type MobileStore,
  type RailRegistry,
  type StoreBillingProvider,
  type SubscriptionProvider,
} from '@kids/payments';
import {
  createMockAnalysisProvider,
  createTranscriptionAnalysisProvider,
  type SpeechAnalysisProvider,
} from '@kids/practice';
import { createCircuitBreaker, createLogger, systemClock } from '@kids/shared';
import {
  createDeepgramProvider,
  createElevenLabsProvider,
  createMemoryAudioStorage,
  createMemoryTtsCache,
  createMockSttProvider,
  createMockTtsProvider,
  type AudioStorage,
  type SpeechToTextProvider,
  type TextToSpeechProvider,
} from '@kids/voice';
import Fastify from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { createAlertMonitor, createLogAlertSink } from './alerts.js';
import { createAuditLogger } from './audit.js';
import { createLearningRecorder } from './learning-events.js';
import { createPaymentStore } from './payment-store.js';
import authPlugin from './plugins/auth.js';
import errorBoundary from './plugins/error-boundary.js';
import metricsPlugin from './plugins/metrics.js';
import requestContext from './plugins/request-context.js';
import security from './plugins/security.js';
import { authRoutes } from './routes/auth.js';
import { characterRoutes } from './routes/characters.js';
import { childRoutes } from './routes/children.js';
import { consentRoutes } from './routes/consent.js';
import { conversationRoutes } from './routes/conversations.js';
import { healthRoutes } from './routes/health.js';
import { createLearningStore, learningRoutes } from './routes/learning.js';
import { metricsScrapeRoutes, observabilityRoutes } from './routes/observability.js';
import { parentRoutes as parentDashboardRoutes } from './routes/parent.js';
import { parentRoutes as parentAccountRoutes } from './routes/parents.js';
import { paymentRoutes } from './routes/payments.js';
import { practiceRoutes } from './routes/practice.js';
import { storeBillingRoutes } from './routes/store-billing.js';
import { subscriptionRoutes } from './routes/subscriptions.js';
import { voiceRoutes } from './routes/voice.js';
import { createEscalationDelivery } from './safety-escalation.js';
import { createAttemptCounter, createPolicyStore } from './safety-store.js';
import { createStoreBilling } from './store-billing.js';
import { createSubscriptionReconciler } from './subscription-reconciler.js';

export interface BuildAppOptions {
  readonly config: Config;
  /**
   * Injected so integration tests can drive the real routes against real SQL and
   * real RLS policies in PGlite, with no Docker daemon and no mock standing in
   * for the thing most worth testing.
   */
  readonly db: Database;
  readonly now?: () => Date;
  /**
   * Overrides the provider chosen from configuration.
   *
   * Same reasoning as `db`: integration tests need to drive the real routes
   * through real failure modes — a timeout, an outage, a malformed response —
   * and the only honest way to produce those is a provider that produces them.
   * Never set outside tests; production resolves the provider from config below.
   */
  readonly aiProvider?: AIProvider;
  readonly sttProvider?: SpeechToTextProvider;
  readonly ttsProvider?: TextToSpeechProvider;
  /** Injected so a test can assert audio is actually gone, not merely marked. */
  readonly audioStorage?: AudioStorage;
  readonly analysisProvider?: SpeechAnalysisProvider;
  /**
   * Overrides the payment rail.
   *
   * Set only by tests, which need to sign webhooks with a known secret and to
   * drive a rail that refuses a cancellation. Production resolves this from
   * `PAYMENTS_PROVIDER`, and configuration refuses `mock` outside local and ci.
   */
  readonly subscriptionProvider?: SubscriptionProvider;
  /**
   * Overrides the payment rail registry.
   *
   * Tests need rails that refuse, rails that go quiet, and — importantly — a
   * registry with nothing in it, because "payments are off" is the default
   * state of this product and has to keep working.
   */
  readonly railRegistry?: RailRegistry;
  /**
   * Overrides the mobile store providers.
   *
   * Tests need a store that refuses, a store that changes its mind, and — the
   * default — no store at all, since a product with no app-store billing has to
   * keep working.
   */
  readonly storeProviders?: readonly (readonly [MobileStore, StoreBillingProvider])[];
  /**
   * Overrides the metrics registry.
   *
   * Injected so a test can assert what was recorded — and, more usefully, that
   * nothing identifying ever reaches a label.
   */
  readonly metricsRegistry?: MetricsRegistry;
}

/**
 * Resolves the JWT signing secret.
 *
 * Production must supply one — the config schema requires it. Local and CI fall
 * back to an ephemeral per-process secret so a fresh clone runs with an unedited
 * `.env`; sessions then do not survive a restart, which is stated loudly rather
 * than discovered. A hardcoded development default would eventually ship.
 */
const resolveJwtSecret = (config: Config, warn: (msg: string) => void): string => {
  if (config.AUTH_JWT_SECRET !== undefined) return config.AUTH_JWT_SECRET;

  if (config.APP_ENV === 'local' || config.APP_ENV === 'ci') {
    warn('AUTH_JWT_SECRET is unset — using an ephemeral secret. Sessions end at restart.');
    return randomBytes(48).toString('base64');
  }

  throw new Error(`AUTH_JWT_SECRET is required when APP_ENV=${config.APP_ENV}`);
};

export const buildApp = async (options: BuildAppOptions) => {
  const { config, db } = options;
  // The composition root is where the default Clock is chosen; everything
  // downstream receives it by injection, which is what the lint rule protects.
  // eslint-disable-next-line no-restricted-syntax
  const now = options.now ?? (() => new Date());

  const app = Fastify({
    // The redacting logger from @kids/shared, not Fastify's default. Transcript
    // text, child identifiers, and credentials must never reach a log line.
    loggerInstance: createLogger({
      level: config.LOG_LEVEL,
      serviceName: config.SERVICE_NAME,
      serviceVersion: config.SERVICE_VERSION,
      appEnv: config.APP_ENV,
      pretty: config.APP_ENV === 'local',
    }),
    genReqId: () => '',
    bodyLimit: config.API_BODY_LIMIT_BYTES,
    requestTimeout: config.API_REQUEST_TIMEOUT_MS,
    trustProxy: config.API_TRUST_PROXY,
    routerOptions: { ignoreTrailingSlash: false },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const tokens = createTokenService({
    secret: resolveJwtSecret(config, (msg) => {
      app.log.warn(msg);
    }),
    issuer: config.AUTH_JWT_ISSUER ?? config.API_PUBLIC_URL,
    audience: config.AUTH_JWT_AUDIENCE ?? 'kids-companion-app',
    accessTokenTtlSeconds: config.AUTH_ACCESS_TOKEN_TTL,
    refreshTokenTtlSeconds: config.AUTH_REFRESH_TOKEN_TTL,
  });

  const sessions = createSessionService({
    db,
    tokens,
    accessTokenTtlSeconds: config.AUTH_ACCESS_TOKEN_TTL,
    now,
  });

  // Emailed tokens are returned in the API response ONLY outside deployed
  // environments. Doing so in production would be a complete authentication
  // bypass — anyone could request a reset for any address and read the token.
  const exposeTokens = config.APP_ENV === 'local' || config.APP_ENV === 'ci';

  const auth: AuthProvider =
    config.AUTH_PROVIDER === 'supabase'
      ? createSupabaseAuthAdapter({
          db,
          supabaseUrl: config.SUPABASE_URL ?? '',
          serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY ?? '',
          anonKey: config.SUPABASE_ANON_KEY ?? '',
          redirectUrl: `${config.API_PUBLIC_URL}/auth/callback`,
        })
      : createLocalAuthAdapter({
          db,
          tokens,
          hashParams: {
            memoryKib: config.PASSWORD_HASH_MEMORY_KIB,
            iterations: config.PASSWORD_HASH_ITERATIONS,
            parallelism: config.PASSWORD_HASH_PARALLELISM,
          },
          emailVerificationTtlSeconds: 86_400,
          passwordResetTtlSeconds: 3_600,
          maxFailedLogins: config.PARENT_GATE_MAX_ATTEMPTS,
          lockoutMinutes: config.PARENT_GATE_LOCKOUT_MINUTES,
          exposeTokens,
          now,
        });

  const audit = createAuditLogger(db);

  // The AI provider, behind the port. The mock is the default in local and ci,
  // so the whole conversation loop runs with no API key and no spend.
  const aiProvider: AIProvider =
    options.aiProvider ??
    (config.AI_PROVIDER === 'anthropic' && config.ANTHROPIC_API_KEY !== undefined
      ? createAnthropicProvider({
          apiKey: config.ANTHROPIC_API_KEY,
          conversationModel: config.AI_MODEL_CONVERSATION ?? 'claude-sonnet-5',
          classifierModel: config.AI_MODEL_SAFETY_CLASSIFIER ?? 'claude-haiku-4-5-20251001',
        })
      : createMockProvider());

  // Safety policy is DATA, not code (infra/migrations/…_safety_subsystem.sql).
  // Primed at boot and refreshed in the background, so tightening a threshold
  // after a real-world miss is an UPDATE rather than a release.
  const policies = createPolicyStore({
    db,
    onError: (error) => {
      app.log.error(
        { err: error },
        'safety policy load failed — running on the compiled-in fallback',
      );
    },
  });
  await policies.prime();
  if (policies.isFallback()) {
    app.log.warn('safety policy table unavailable — using the compiled-in fallback policy');
  }

  const engine = createConversationEngine({
    provider: aiProvider,
    safetyPolicy: policies.current,
    attempts: createAttemptCounter(db),
    limits: {
      maxExchanges: config.AI_CONTEXT_MAX_EXCHANGES,
      maxHistoryTokens: config.AI_CONTEXT_MAX_HISTORY_TOKENS,
      maxOutputTokens: config.AI_MAX_OUTPUT_TOKENS,
    },
    retry: {
      maxAttempts: config.AI_MAX_RETRIES + 1,
      // Bounded by the voice-loop latency budget: a retry that would exceed the
      // remaining budget is not attempted (ARCHITECTURE.md §7.1).
      budgetMs: config.AI_REQUEST_TIMEOUT_MS,
      baseDelayMs: 200,
      maxDelayMs: 2000,
    },
    breaker: createCircuitBreaker({ failureThreshold: 5, cooldownMs: 30_000 }, (from, to) => {
      // An open breaker is the earliest signal of a vendor incident.
      app.log.warn({ from, to, provider: aiProvider.name }, 'ai circuit breaker changed state');
    }),
    moderationTimeoutMs: config.AI_MODERATION_TIMEOUT_MS,
    generationTimeoutMs: config.AI_REQUEST_TIMEOUT_MS,
    temperature: config.AI_TEMPERATURE,
  });

  /* ---------------- Voice ----------------
   * The providers are ports (docs/adr/0004). The mocks are the default in local
   * and ci, so the whole voice loop — including safety — runs on a fresh clone
   * with no API keys and no spend.
   */
  const stt: SpeechToTextProvider =
    options.sttProvider ??
    (config.STT_PROVIDER === 'deepgram' && config.DEEPGRAM_API_KEY !== undefined
      ? createDeepgramProvider({ apiKey: config.DEEPGRAM_API_KEY })
      : createMockSttProvider());

  const tts: TextToSpeechProvider =
    options.ttsProvider ??
    (config.TTS_PROVIDER === 'elevenlabs' && config.ELEVENLABS_API_KEY !== undefined
      ? createElevenLabsProvider({
          apiKey: config.ELEVENLABS_API_KEY,
          cache: createMemoryTtsCache(),
        })
      : createMockTtsProvider());

  const clock = options.now
    ? { now: () => options.now!().getTime(), nowIso: () => options.now!().toISOString() as never }
    : systemClock;

  const audioStorage = options.audioStorage ?? createMemoryAudioStorage({ clock });

  // Pronunciation analysis. The transcription-backed provider is the honest
  // default for a real deployment: it reports `utterance` granularity, which
  // is exactly what a transcript can support. A phoneme-capable vendor plugs
  // in here without touching the scorer (docs/adr/0004, Q-06).
  const speechAnalysis: SpeechAnalysisProvider =
    options.analysisProvider ??
    (config.SPEECH_ANALYSIS_PROVIDER === 'transcription'
      ? createTranscriptionAnalysisProvider(stt)
      : createMockAnalysisProvider());

  await app.register(requestContext);

  /* Metrics before the error boundary, so a request that fails inside another
   * plugin is still counted — an error rate that silently excludes the errors
   * it cannot see is worse than no error rate. */
  const metricsRegistry = options.metricsRegistry ?? createMetricsRegistry();
  await app.register(metricsPlugin, {
    registry: metricsRegistry,
    nowMs: () => clock.now(),
  });

  /* Alerts.
   *
   * The default sink is a `fatal` log line rather than an outbound webhook:
   * every deployment already ships logs somewhere, and an alerting path with a
   * network dependency fails exactly when the network does. */
  const alertMonitor = createAlertMonitor({
    registry: metricsRegistry,
    sink: createLogAlertSink(app.log),
    clock,
  });

  await app.register(errorBoundary);
  await app.register(security, { config });
  await app.register(authPlugin, { db, tokens, sessions });

  // Multipart is registered ONLY for the voice upload. The byte ceiling is
  // enforced as the body streams, so an oversized upload is cut off at the
  // socket rather than buffered and then measured — measuring after buffering
  // lets an attacker choose how much memory we spend.
  await app.register(multipart, {
    limits: {
      fileSize: config.VOICE_MAX_UPLOAD_BYTES,
      files: 1,
      fields: 4,
      fieldSize: 1_024,
      parts: 6,
    },
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'kids-companion API',
        description:
          'Voice-first AI companion for children. Generated from route schemas — never hand-written.',
        version: config.SERVICE_VERSION,
      },
      servers: [{ url: config.API_PUBLIC_URL }],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(healthRoutes(config, { db }));
  await app.register(
    authRoutes({
      auth,
      sessions,
      audit,
      exposeTokens,
      authRateLimitPerWindow: config.RATE_LIMIT_AUTH_PER_15_MIN,
    }),
  );
  await app.register(parentAccountRoutes({ auth, db, sessions, audit }));
  await app.register(childRoutes({ audit }));
  await app.register(consentRoutes({ audit }));
  await app.register(characterRoutes());
  // Mounted under /api, matching the product specification. Everything else in
  // this service is under /v1, so this prefix carries no version — a real
  // inconsistency, recorded in docs/API_CONVENTIONS.md §1.1 rather than quietly
  // resolved in one direction here.
  /**
   * Routing for safety escalations.
   *
   * Built here so it can reach the alert monitor: an escalation that cannot be
   * delivered is a failure of the safety pipeline, and `reportSafetyFailure`
   * is the one alert condition that fires on the FIRST occurrence rather than
   * on a rate. See docs/CHILD_SAFETY.md §6.1 item 5.
   */
  const escalations = createEscalationDelivery({
    db,
    clock,
    logger: app.log,
    webhookUrl: config.SAFETY_ESCALATION_WEBHOOK_URL,
    onDeliveryFailure: (detail) => {
      alertMonitor.reportSafetyFailure(detail);
    },
  });

  /**
   * Records what a child did, so the progress dashboard has something to show.
   *
   * The rollup pipeline was already complete and had no producer; this is it.
   */
  const learning = createLearningRecorder({
    db,
    store: createLearningStore(db),
    clock,
    logger: app.log,
  });

  await app.register(
    conversationRoutes({
      engine,
      db,
      audit,
      maxExchanges: config.AI_CONTEXT_MAX_EXCHANGES,
      dailyTurnLimit: config.AI_PER_CHILD_DAILY_TURN_LIMIT,
      encryptionKeyId: 'placeholder',
      messageRateLimitPerMinute: config.RATE_LIMIT_CONVERSATION_PER_MINUTE,
      startRateLimitPerHour: config.RATE_LIMIT_CONVERSATION_START_PER_HOUR,
      clock,
      escalations,
      learning,
    }),
    { prefix: '/api' },
  );

  await app.register(
    voiceRoutes({
      engine,
      db,
      audit,
      stt,
      tts,
      storage: audioStorage,
      clock,
      retention: {
        rawAudioDays: config.RETENTION_RAW_AUDIO_DAYS,
        transientSeconds: config.VOICE_TRANSIENT_AUDIO_SECONDS,
      },
      limits: {
        maxBytes: config.VOICE_MAX_UPLOAD_BYTES,
        maxDurationMs: config.VOICE_MAX_DURATION_MS,
        minDurationMs: config.VOICE_MIN_DURATION_MS,
        allowUnknownDuration: config.VOICE_ALLOW_UNKNOWN_DURATION,
      },
      sttTimeoutMs: config.STT_TIMEOUT_MS,
      ttsTimeoutMs: config.TTS_TIMEOUT_MS,
      maxRetries: config.AI_MAX_RETRIES,
      requestTimeoutMs: config.AI_REQUEST_TIMEOUT_MS,
      encryptionKeyId: 'placeholder',
      maxExchanges: config.AI_CONTEXT_MAX_EXCHANGES,
      rateLimitPerMinute: config.RATE_LIMIT_VOICE_PER_MINUTE,
    }),
    { prefix: '/api' },
  );

  await app.register(
    practiceRoutes({
      db,
      audit,
      learning,
      analysis: speechAnalysis,
      storage: audioStorage,
      clock,
      retention: {
        rawAudioDays: config.RETENTION_RAW_AUDIO_DAYS,
        transientSeconds: config.VOICE_TRANSIENT_AUDIO_SECONDS,
      },
      limits: {
        maxBytes: config.VOICE_MAX_UPLOAD_BYTES,
        maxDurationMs: config.VOICE_MAX_DURATION_MS,
        minDurationMs: config.VOICE_MIN_DURATION_MS,
        allowUnknownDuration: config.VOICE_ALLOW_UNKNOWN_DURATION,
      },
      analysisTimeoutMs: config.SPEECH_ANALYSIS_TIMEOUT_MS,
      rateLimitPerMinute: config.RATE_LIMIT_PRACTICE_PER_MINUTE,
    }),
    { prefix: '/api' },
  );

  /* Payments.
   *
   * The rail is chosen by configuration, and `mock` is refused outright in any
   * deployed environment — its signing key is a documented default, which would
   * make the webhook endpoint a subscription anyone could grant themselves. */
  const subscriptionProvider =
    options.subscriptionProvider ??
    createMockSubscriptionProvider({
      webhookSecret: config.PAYMENTS_MOCK_WEBHOOK_SECRET,
      toleranceSeconds: config.PAYMENTS_WEBHOOK_TOLERANCE_SECONDS,
      now: () => new Date(clock.now()),
    });

  const subscriptionReconciler = createSubscriptionReconciler({ db, audit, clock });

  /* Payment rails.
   *
   * ZERO ENABLED RAILS IS A SUPPORTED STATE, and the default one. Every family
   * is then on the free tier, every child can still talk, and the only visible
   * difference is that checkout says payments are unavailable. Nothing in the
   * conversation path, the safety pipeline, or the dashboard touches this. */
  const railClock = () => new Date(clock.now());

  const jazzcash: JazzCashConfig | undefined =
    config.JAZZCASH_MERCHANT_ID === undefined
      ? undefined
      : {
          merchantId: config.JAZZCASH_MERCHANT_ID,
          password: config.JAZZCASH_PASSWORD ?? '',
          integritySalt: config.JAZZCASH_INTEGRITY_SALT ?? '',
          mode: config.JAZZCASH_MODE,
          sandboxCallbackSecret: config.PAYMENTS_SANDBOX_CALLBACK_SECRET,
          now: railClock,
        };

  const easypaisa: EasypaisaConfig | undefined =
    config.EASYPAISA_STORE_ID === undefined
      ? undefined
      : {
          storeId: config.EASYPAISA_STORE_ID,
          hashKey: config.EASYPAISA_HASH_KEY ?? '',
          mode: config.EASYPAISA_MODE,
          sandboxCallbackSecret: config.PAYMENTS_SANDBOX_CALLBACK_SECRET,
          now: railClock,
        };

  const carrierBilling: CarrierBillingConfig | undefined =
    config.CARRIER_BILLING_MERCHANT_ID === undefined
      ? undefined
      : {
          aggregator: config.CARRIER_BILLING_AGGREGATOR ?? '',
          merchantId: config.CARRIER_BILLING_MERCHANT_ID,
          apiKey: config.CARRIER_BILLING_API_KEY ?? '',
          callbackSecret: config.CARRIER_BILLING_CALLBACK_SECRET ?? '',
          mode: config.CARRIER_BILLING_MODE,
          sandboxCallbackSecret: config.PAYMENTS_SANDBOX_CALLBACK_SECRET,
          now: railClock,
        };

  const card: CardConfig | undefined =
    config.CARD_PROCESSOR === undefined
      ? undefined
      : {
          processor: config.CARD_PROCESSOR,
          secretKey: config.CARD_SECRET_KEY ?? '',
          webhookSecret: config.CARD_WEBHOOK_SECRET ?? '',
          mode: config.CARD_MODE,
          sandboxCallbackSecret: config.PAYMENTS_SANDBOX_CALLBACK_SECRET,
          now: railClock,
        };

  const railRegistry =
    options.railRegistry ??
    createRailRegistry({
      enabled: config.PAYMENTS_ENABLED_RAILS as never,
      ...(jazzcash ? { jazzcash } : {}),
      ...(easypaisa ? { easypaisa } : {}),
      ...(carrierBilling ? { carrierBilling } : {}),
      ...(card ? { card } : {}),
    });

  // Logged once at boot. "Which rails are live, and is any of them unverified?"
  // is the question nobody asks until an incident.
  if (railRegistry.anyAvailable()) {
    app.log.info({ rails: describeRegistry(railRegistry) }, 'payment rails enabled');
  } else {
    app.log.info('no payment rails enabled — the free tier is the only plan');
  }

  const paymentStore = createPaymentStore({
    db,
    registry: railRegistry,
    audit,
    clock,
    reconcileAfterMinutes: config.PAYMENTS_RECONCILE_AFTER_MINUTES,
  });

  await app.register(paymentRoutes({ registry: railRegistry, payments: paymentStore, audit }), {
    prefix: '/api',
  });

  /* Mobile store billing.
   *
   * The mock provider is a REAL verification service that can say no — a stub
   * that confirmed everything would make the tests pass while proving the
   * opposite of what they claim. Configuration refuses it in any deployed
   * environment, because there it would grant subscriptions nobody paid for. */
  const storeProviders = new Map<MobileStore, StoreBillingProvider>(options.storeProviders ?? []);

  if (options.storeProviders === undefined) {
    for (const store of config.STORE_BILLING_ENABLED_STORES) {
      if (store !== 'apple_iap' && store !== 'google_play') continue;

      if (config.STORE_BILLING_PROVIDER === 'mock') {
        storeProviders.set(
          store,
          createMockStoreProvider({
            store,
            notificationSecret: config.STORE_BILLING_MOCK_SECRET,
            environment: config.STORE_BILLING_ENVIRONMENT,
            productId: `${store}.monthly`,
            now: () => new Date(clock.now()),
          }),
        );
        continue;
      }

      if (store === 'apple_iap' && config.APPLE_IAP_ISSUER_ID !== undefined) {
        storeProviders.set(
          store,
          createAppleStoreProvider({
            issuerId: config.APPLE_IAP_ISSUER_ID,
            keyId: config.APPLE_IAP_KEY_ID ?? '',
            privateKey: config.APPLE_IAP_PRIVATE_KEY ?? '',
            bundleId: config.APPLE_IAP_BUNDLE_ID ?? '',
            ...(config.APPLE_IAP_SHARED_SECRET === undefined
              ? {}
              : { sharedSecret: config.APPLE_IAP_SHARED_SECRET }),
            environment: config.STORE_BILLING_ENVIRONMENT,
          }),
        );
      }

      if (store === 'google_play' && config.GOOGLE_PLAY_PACKAGE_NAME !== undefined) {
        storeProviders.set(
          store,
          createGooglePlayProvider({
            packageName: config.GOOGLE_PLAY_PACKAGE_NAME,
            serviceAccountJson: config.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON ?? '',
            ...(config.GOOGLE_PLAY_NOTIFICATION_TOPIC === undefined
              ? {}
              : { notificationTopic: config.GOOGLE_PLAY_NOTIFICATION_TOPIC }),
            environment: config.STORE_BILLING_ENVIRONMENT,
          }),
        );
      }
    }
  }

  const storeBilling = createStoreBilling({ db, providers: storeProviders, audit, clock });

  await app.register(
    storeBillingRoutes({ billing: storeBilling, providers: storeProviders, audit }),
    { prefix: '/api' },
  );

  await app.register(
    subscriptionRoutes({
      db,
      provider: subscriptionProvider,
      reconciler: subscriptionReconciler,
      audit,
      clock,
      checkoutRateLimitPerHour: config.RATE_LIMIT_CHECKOUT_PER_HOUR,
    }),
    { prefix: '/api' },
  );

  /* `/metrics` sits outside `/api`: it is scraped by infrastructure and is not
   * part of the product's API surface. The staff endpoints are a SEPARATE
   * plugin under `/api`, registered once — see docs/SECURITY_AUDIT.md for why
   * that separation is structural rather than a flag. */
  await app.register(
    metricsScrapeRoutes({
      registry: metricsRegistry,
      alerts: alertMonitor,
      metricsEnabled: config.METRICS_ENABLED,
    }),
  );

  await app.register(
    observabilityRoutes({ db, registry: metricsRegistry, alerts: alertMonitor, clock }),
    { prefix: '/api' },
  );

  await app.register(learningRoutes({ db }), { prefix: '/api' });
  await app.register(parentDashboardRoutes({ db, audit, clock }), { prefix: '/api' });

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * THE SCHEDULED SWEEPS, EXPOSED FOR THE WORKER PROCESS.
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * These are backstops, not the primary path. Entitlement is computed from
   * timestamps whenever it is read, so a subscription is expired the moment its
   * window closes whether or not `sweepExpired` has run. What the sweeps buy is
   * stored state that matches reality, and recovery from the two failures that
   * leave it behind: a crash mid-write, and a vendor callback that never came.
   *
   * They are attached here rather than rebuilt in `worker.ts` so there is
   * exactly ONE place that decides which rails are enabled, which store
   * providers are configured, and how they are constructed. A second wiring
   * path would drift from this one, and the first symptom would be a sweep
   * quietly reconciling against a rail the API does not use.
   *
   * `apps/api/src/worker.ts` builds the app solely to obtain these, and never
   * calls `listen` — no route registered above is reachable in that process.
   */
  app.decorate('maintenance', {
    /** Moves elapsed subscriptions to `expired`. Returns rows changed. */
    sweepExpiredSubscriptions: async (): Promise<number> =>
      await subscriptionReconciler.sweepExpired(),

    /**
     * Retries escalations no human has been told about yet.
     *
     * Listed FIRST because it is the only sweep whose backlog is a child
     * waiting rather than a number being stale.
     */
    retryEscalationDelivery: async () => await escalations.retryPending(),

    /**
     * Rebuilds progress rollups for days whose events are newer than them.
     *
     * The dashboard reads the rollups, so a conversation nobody ended shows a
     * parent zeros until this runs.
     */
    rebuildLearningRollups: async () => await learning.rebuildStale(),

    /** Asks each rail about payments we never heard the outcome of. */
    reconcilePayments: async () => await paymentStore.reconcile(),

    /** Re-verifies store purchases whose state may have moved without a notification. */
    synchroniseStorePurchases: async () => await storeBilling.synchronise(),

    /**
     * Whether audio retention can be swept from ANOTHER process.
     *
     * The only `AudioStorage` implementation is in-memory, so the bytes live in
     * whichever process wrote them. A sweep run elsewhere would mark the ledger
     * rows deleted while the objects survived in the API's heap — a retention
     * record asserting a deletion that did not happen, which is worse than not
     * sweeping at all. See DEPLOYMENT.md.
     */
    audioSweepIsShared: false,
  });

  return app;
};

declare module 'fastify' {
  interface FastifyInstance {
    readonly maintenance: {
      retryEscalationDelivery(): Promise<{ attempted: number; delivered: number }>;
      rebuildLearningRollups(): Promise<{ days: number }>;
      sweepExpiredSubscriptions(): Promise<number>;
      reconcilePayments(): Promise<{ checked: number; resolved: number; stillUnresolved: number }>;
      synchroniseStorePurchases(): Promise<{ checked: number; changed: number }>;
      readonly audioSweepIsShared: boolean;
    };
  }
}

/** The concrete application type, for callers that need to name it. */
export type App = Awaited<ReturnType<typeof buildApp>>;
