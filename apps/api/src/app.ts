import { randomBytes } from 'node:crypto';

import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import {
  createAnthropicProvider,
  createConversationEngine,
  createMockProvider,
  type AIProvider,
} from '@kids/ai';
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

import { createAuditLogger } from './audit.js';
import authPlugin from './plugins/auth.js';
import errorBoundary from './plugins/error-boundary.js';
import requestContext from './plugins/request-context.js';
import security from './plugins/security.js';
import { authRoutes } from './routes/auth.js';
import { characterRoutes } from './routes/characters.js';
import { childRoutes } from './routes/children.js';
import { consentRoutes } from './routes/consent.js';
import { conversationRoutes } from './routes/conversations.js';
import { healthRoutes } from './routes/health.js';
import { learningRoutes } from './routes/learning.js';
import { parentRoutes as parentDashboardRoutes } from './routes/parent.js';
import { parentRoutes as parentAccountRoutes } from './routes/parents.js';
import { practiceRoutes } from './routes/practice.js';
import { voiceRoutes } from './routes/voice.js';
import { createAttemptCounter, createPolicyStore } from './safety-store.js';

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

  await app.register(healthRoutes(config));
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

  await app.register(learningRoutes({ db }), { prefix: '/api' });
  await app.register(parentDashboardRoutes({ db, audit, clock }), { prefix: '/api' });

  return app;
};

/** The concrete application type, for callers that need to name it. */
export type App = Awaited<ReturnType<typeof buildApp>>;
