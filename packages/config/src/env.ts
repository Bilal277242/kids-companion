import { z } from 'zod';

import { appEnvSchema, nodeEnvSchema, type AppEnv } from './app-env.js';
import {
  boolFromEnv,
  csvFromEnv,
  durationSecondsFromEnv,
  intFromEnv,
  secretFromEnv,
  urlFromEnv,
} from './primitives.js';

/**
 * The environment contract.
 *
 * Every variable the API and the services read is declared here, and
 * `process.env` is touched in exactly one place (`load.ts`).
 *
 * The one exception is the Next.js dashboard, which is a separate deployable
 * with its own runtime and reads a single variable of its own (`API_BASE_URL`,
 * in `apps/web/src/lib/api.ts`). Importing this schema there would drag the
 * whole API contract — database, providers, telemetry — into a server bundle
 * that needs none of it. Both variables live in `.env.example`, which stays the
 * single contract.
 *
 * Sections marked "phase-gated" are typed but optional: the contract is fixed now
 * so `.env.example` and this schema cannot drift, while nothing consumes them
 * until the phase that owns them. See docs/ENVIRONMENT.md.
 */

/* -------------------------------------------------------------------------- */
/* Core runtime                                                                */
/* -------------------------------------------------------------------------- */

const coreSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),
  APP_ENV: appEnvSchema.default('local'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  SERVICE_NAME: z.string().min(1).default('kids-companion-api'),
  SERVICE_VERSION: z.string().min(1).default('0.0.0'),
});

/* -------------------------------------------------------------------------- */
/* API server                                                                  */
/* -------------------------------------------------------------------------- */

const apiSchema = z.object({
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: intFromEnv({ min: 1, max: 65_535 }).default(8080),
  API_PUBLIC_URL: urlFromEnv.default('http://localhost:8080'),
  API_REQUEST_TIMEOUT_MS: intFromEnv({ min: 1_000 }).default(30_000),
  API_BODY_LIMIT_BYTES: intFromEnv({ min: 1_024 }).default(10_485_760),
  // `true` only behind a known load balancer. Otherwise a client can spoof its
  // source IP via X-Forwarded-For and defeat per-IP rate limiting entirely.
  API_TRUST_PROXY: boolFromEnv.default(false),
  CORS_ALLOWED_ORIGINS: csvFromEnv.default(['http://localhost:3000', 'http://localhost:8081']),
});

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                               */
/* -------------------------------------------------------------------------- */

const rateLimitSchema = z.object({
  RATE_LIMIT_GLOBAL_PER_MINUTE: intFromEnv({ min: 1 }).default(600),
  RATE_LIMIT_AUTH_PER_15_MIN: intFromEnv({ min: 1 }).default(10),
  RATE_LIMIT_CONVERSATION_PER_MINUTE: intFromEnv({ min: 1 }).default(30),
  // Starting sessions is far rarer than sending messages, and a client
  // looping on start is the shape of a bug rather than a chatty child.
  RATE_LIMIT_CONVERSATION_START_PER_HOUR: intFromEnv({ min: 1 }).default(30),
  // Lower than the text limit: every voice turn costs an STT call and a TTS
  // call on top of the model.
  RATE_LIMIT_VOICE_PER_MINUTE: intFromEnv({ min: 1 }).default(15),
  RATE_LIMIT_UPLOAD_PER_MINUTE: intFromEnv({ min: 1 }).default(20),
});

/* -------------------------------------------------------------------------- */
/* Safety — phase-gated (Phase 2), but the production rules below bite now      */
/* -------------------------------------------------------------------------- */

const safetySchema = z.object({
  SAFETY_MODE: z.enum(['strict', 'standard']).default('strict'),
  SAFETY_INPUT_CLASSIFIER_ENABLED: boolFromEnv.default(true),
  SAFETY_OUTPUT_CLASSIFIER_ENABLED: boolFromEnv.default(true),
  SAFETY_BLOCKLIST_VERSION: z.string().optional(),
  // The variable exists so the setting is visible and auditable. `open` is not an
  // accepted value in any environment — see docs/CHILD_SAFETY.md rule S-1.
  SAFETY_FAIL_MODE: z.literal('closed').default('closed'),
  SAFETY_ESCALATION_WEBHOOK_URL: urlFromEnv.optional(),
  SAFETY_REVIEW_QUEUE_ENABLED: boolFromEnv.default(true),
});

/* -------------------------------------------------------------------------- */
/* Retention (days)                                                            */
/* -------------------------------------------------------------------------- */

const retentionSchema = z.object({
  // 0 = discard at transcription. See docs/adr/0006.
  RETENTION_RAW_AUDIO_DAYS: intFromEnv({ min: 0 }).default(0),
  RETENTION_TRANSCRIPT_DAYS: intFromEnv({ min: 0, max: 365 }).default(90),
  RETENTION_ANALYTICS_EVENT_DAYS: intFromEnv({ min: 0 }).default(395),
  RETENTION_AUDIT_LOG_DAYS: intFromEnv({ min: 0 }).default(730),
  RETENTION_DELETED_ACCOUNT_GRACE_DAYS: intFromEnv({ min: 0 }).default(30),
  // Required acknowledgement when raw audio retention is switched on in prod.
  RETENTION_RAW_AUDIO_OPT_IN_ACK: z.string().optional(),
});

/* -------------------------------------------------------------------------- */
/* Phase-gated: database, cache, auth, storage, AI, voice, payments, telemetry  */
/* -------------------------------------------------------------------------- */

const dataSchema = z.object({
  SUPABASE_URL: urlFromEnv.optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  DATABASE_POOL_MAX: intFromEnv({ min: 1 }).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: intFromEnv({ min: 100 }).default(10_000),
  DATABASE_SSL_MODE: z.enum(['disable', 'require']).default('disable'),
  REDIS_URL: z.string().optional(),
  REDIS_TLS_ENABLED: boolFromEnv.default(false),
  REDIS_KEY_PREFIX: z.string().min(1).default('kc:local:'),
  QUEUE_CONCURRENCY: intFromEnv({ min: 1 }).default(5),
  QUEUE_MAX_ATTEMPTS: intFromEnv({ min: 1 }).default(3),
});

const authSchema = z.object({
  // Which identity provider backs authentication. `supabase` delegates the
  // credential to GoTrue; `local` manages Argon2id hashes in our own tables and
  // is what local and ci use so the auth surface is testable without a project.
  AUTH_PROVIDER: z.enum(['supabase', 'local']).default('local'),
  AUTH_JWT_SECRET: secretFromEnv().optional(),
  AUTH_JWT_ISSUER: z.string().optional(),
  AUTH_JWT_AUDIENCE: z.string().optional(),
  AUTH_ACCESS_TOKEN_TTL: durationSecondsFromEnv('15m'),
  AUTH_REFRESH_TOKEN_TTL: durationSecondsFromEnv('30d'),
  AUTH_REFRESH_TOKEN_ROTATION: boolFromEnv.default(true),
  CHILD_SESSION_TTL: durationSecondsFromEnv('60m'),
  PARENT_GATE_MODE: z.enum(['arithmetic', 'device_biometric', 'pin']).default('arithmetic'),
  PARENT_GATE_MAX_ATTEMPTS: intFromEnv({ min: 1 }).default(5),
  PARENT_GATE_LOCKOUT_MINUTES: intFromEnv({ min: 1 }).default(15),
  PASSWORD_HASH_MEMORY_KIB: intFromEnv({ min: 19_456 }).default(19_456),
  PASSWORD_HASH_ITERATIONS: intFromEnv({ min: 2 }).default(2),
  PASSWORD_HASH_PARALLELISM: intFromEnv({ min: 1 }).default(1),
  ENCRYPTION_ACTIVE_KEY_ID: z.string().min(1).default('k1'),
});

const providerSchema = z.object({
  STORAGE_PROVIDER: z.enum(['supabase', 's3']).default('supabase'),
  STORAGE_BUCKET_AUDIO: z.string().min(1).default('child-audio'),
  STORAGE_BUCKET_MEDIA: z.string().min(1).default('public-media'),
  STORAGE_SIGNED_URL_TTL_SECONDS: intFromEnv({ min: 30, max: 3_600 }).default(300),

  AI_PROVIDER: z.enum(['anthropic', 'openai', 'mock']).default('mock'),
  AI_MODEL_CONVERSATION: z.string().optional(),
  AI_MODEL_SAFETY_CLASSIFIER: z.string().optional(),
  AI_MAX_OUTPUT_TOKENS: intFromEnv({ min: 1 }).default(512),
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),
  // Roughly the last ten exchanges, per the product specification. Configurable
  // rather than hard-coded: the right number trades conversational memory
  // against cost and latency, and is an empirical question per age group.
  AI_CONTEXT_MAX_EXCHANGES: intFromEnv({ min: 1, max: 50 }).default(10),
  AI_CONTEXT_MAX_HISTORY_TOKENS: intFromEnv({ min: 100 }).default(2000),
  AI_MODERATION_TIMEOUT_MS: intFromEnv({ min: 500 }).default(4000),
  AI_REQUEST_TIMEOUT_MS: intFromEnv({ min: 1_000 }).default(15_000),
  AI_MAX_RETRIES: intFromEnv({ min: 0, max: 5 }).default(2),
  AI_DAILY_COST_CEILING_USD: intFromEnv({ min: 0 }).default(50),
  AI_PER_CHILD_DAILY_TURN_LIMIT: intFromEnv({ min: 1 }).default(300),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  STT_PROVIDER: z.enum(['deepgram', 'google', 'azure', 'openai', 'mock']).default('mock'),
  // A child’s turn is a few seconds. The ceiling is deliberately generous for
  // 30 s of any accepted codec and small enough that a hostile upload cannot
  // occupy a request worker for long.
  VOICE_MAX_UPLOAD_BYTES: intFromEnv({ min: 1_024 }).default(8 * 1024 * 1024),
  VOICE_MAX_DURATION_MS: intFromEnv({ min: 500 }).default(30_000),
  VOICE_MIN_DURATION_MS: intFromEnv({ min: 0 }).default(250),
  // Browser MediaRecorder emits WebM with no duration until the stream is
  // finalised, which is normal. Set false where the duration limit must be
  // load-bearing rather than advisory.
  VOICE_ALLOW_UNKNOWN_DURATION: boolFromEnv.default(true),
  // Below this the child is asked to repeat rather than answered. Low
  // confidence on child speech is expected (R-01); replying confidently to
  // something they did not say is the failure this prevents.
  VOICE_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.4),
  // How long synthesised reply audio stays fetchable. A timeout, not a
  // retention period — see docs/adr/0006.
  VOICE_TRANSIENT_AUDIO_SECONDS: intFromEnv({ min: 30, max: 3_600 }).default(300),

  // Pronunciation practice. `transcription` derives a score from a transcript
  // and can say nothing about how a sound was articulated; a phoneme-capable
  // vendor is Q-06 and unresolved, so the port exists and the weak provider
  // is what ships (services/practice/src/scoring.ts).
  SPEECH_ANALYSIS_PROVIDER: z.enum(['transcription', 'mock']).default('mock'),
  SPEECH_ANALYSIS_TIMEOUT_MS: intFromEnv({ min: 1_000 }).default(10_000),
  RATE_LIMIT_PRACTICE_PER_MINUTE: intFromEnv({ min: 1 }).default(30),
  STT_TIMEOUT_MS: intFromEnv({ min: 1_000 }).default(10_000),
  STT_LANGUAGE_HINTS: csvFromEnv.default(['en-US', 'ur-PK']),
  DEEPGRAM_API_KEY: z.string().optional(),

  TTS_PROVIDER: z.enum(['elevenlabs', 'google', 'azure', 'mock']).default('mock'),
  TTS_TIMEOUT_MS: intFromEnv({ min: 1_000 }).default(10_000),
  TTS_CACHE_TTL_SECONDS: intFromEnv({ min: 0 }).default(604_800),
  ELEVENLABS_API_KEY: z.string().optional(),

  PAYMENTS_ENABLED: boolFromEnv.default(false),
  PAYMENTS_DEFAULT_CURRENCY: z.string().length(3).default('PKR'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

const quotaSchema = z.object({
  FREE_TIER_DAILY_MINUTES: intFromEnv({ min: 0 }).default(10),
  FREE_TIER_CHILD_PROFILE_LIMIT: intFromEnv({ min: 1 }).default(1),
  FREE_TIER_STORY_LIMIT_PER_WEEK: intFromEnv({ min: 0 }).default(3),
  PAID_TIER_CHILD_PROFILE_LIMIT: intFromEnv({ min: 1 }).default(4),
});

const telemetrySchema = z.object({
  OTEL_EXPORTER_OTLP_ENDPOINT: urlFromEnv.optional(),
  SENTRY_DSN: z.string().optional(),
  METRICS_ENABLED: boolFromEnv.default(true),
  METRICS_PORT: intFromEnv({ min: 1, max: 65_535 }).default(9_464),
  ANALYTICS_PROVIDER: z.enum(['posthog', 'none']).default('none'),
  ANALYTICS_WRITE_KEY: z.string().optional(),
  ANALYTICS_ENABLED: boolFromEnv.default(false),
});

const featureFlagSchema = z.object({
  FEATURE_MULTILINGUAL_URDU: boolFromEnv.default(false),
  FEATURE_PRONUNCIATION_PRACTICE: boolFromEnv.default(false),
  FEATURE_STORY_MODE: boolFromEnv.default(false),
  FEATURE_ROLEPLAY_MODE: boolFromEnv.default(false),
  FEATURE_PARENT_DASHBOARD: boolFromEnv.default(false),
  FEATURE_OFFLINE_MODE: boolFromEnv.default(false),
});

/* -------------------------------------------------------------------------- */
/* Assembled schema, with cross-field rules                                    */
/* -------------------------------------------------------------------------- */

const baseSchema = coreSchema
  .extend(apiSchema.shape)
  .extend(rateLimitSchema.shape)
  .extend(safetySchema.shape)
  .extend(retentionSchema.shape)
  .extend(dataSchema.shape)
  .extend(authSchema.shape)
  .extend(providerSchema.shape)
  .extend(quotaSchema.shape)
  .extend(telemetrySchema.shape)
  .extend(featureFlagSchema.shape);

export type RawEnv = z.infer<typeof baseSchema>;

/**
 * Cross-field rules.
 *
 * A per-field schema accepts every one of the misconfigurations below, because
 * each individual value is valid in isolation. These are the ones that actually
 * cause incidents — most importantly, a production deploy cannot start with the
 * safety classifiers switched off.
 */
export const envSchema = baseSchema.superRefine((env, ctx) => {
  const issue = (path: keyof RawEnv, message: string) => {
    ctx.addIssue({ code: 'custom', path: [path], message });
  };

  const isProd = env.APP_ENV === 'production';
  const isDeployed: boolean =
    env.APP_ENV === 'production' || env.APP_ENV === 'staging' || env.APP_ENV === 'development';

  /* --- Provider credentials must be present when the provider is selected --- */
  if (env.AI_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    issue('ANTHROPIC_API_KEY', 'is required when AI_PROVIDER=anthropic');
  }
  if (env.AI_PROVIDER === 'openai' && !env.OPENAI_API_KEY) {
    issue('OPENAI_API_KEY', 'is required when AI_PROVIDER=openai');
  }
  if (env.STT_PROVIDER === 'deepgram' && !env.DEEPGRAM_API_KEY) {
    issue('DEEPGRAM_API_KEY', 'is required when STT_PROVIDER=deepgram');
  }
  if (env.TTS_PROVIDER === 'elevenlabs' && !env.ELEVENLABS_API_KEY) {
    issue('ELEVENLABS_API_KEY', 'is required when TTS_PROVIDER=elevenlabs');
  }
  if (env.PAYMENTS_ENABLED && !env.STRIPE_WEBHOOK_SECRET) {
    issue(
      'STRIPE_WEBHOOK_SECRET',
      'is required when PAYMENTS_ENABLED=true — an unverified webhook endpoint grants free subscriptions',
    );
  }
  if (env.ANALYTICS_ENABLED && !env.ANALYTICS_WRITE_KEY) {
    issue('ANALYTICS_WRITE_KEY', 'is required when ANALYTICS_ENABLED=true');
  }

  /* --- Transport security in any deployed environment --- */
  if (isDeployed) {
    if (env.DATABASE_SSL_MODE !== 'require') {
      issue('DATABASE_SSL_MODE', `must be "require" when APP_ENV=${env.APP_ENV}`);
    }
    if (env.CORS_ALLOWED_ORIGINS.some((o) => o.includes('*'))) {
      issue('CORS_ALLOWED_ORIGINS', 'must not contain a wildcard in a deployed environment');
    }
  }

  /* --- Production-only rules --- */
  if (isProd) {
    if (!env.REDIS_TLS_ENABLED) {
      issue('REDIS_TLS_ENABLED', 'must be true in production');
    }
    if (env.LOG_LEVEL === 'trace') {
      issue('LOG_LEVEL', 'must not be "trace" in production — it risks logging sensitive payloads');
    }
    if (!env.SAFETY_INPUT_CLASSIFIER_ENABLED) {
      issue('SAFETY_INPUT_CLASSIFIER_ENABLED', 'cannot be disabled in production');
    }
    if (!env.SAFETY_OUTPUT_CLASSIFIER_ENABLED) {
      issue('SAFETY_OUTPUT_CLASSIFIER_ENABLED', 'cannot be disabled in production');
    }
    if (!env.SAFETY_ESCALATION_WEBHOOK_URL) {
      issue(
        'SAFETY_ESCALATION_WEBHOOK_URL',
        'is required in production — disclosures must reach a human (docs/CHILD_SAFETY.md §6)',
      );
    }
    if (env.REDIS_KEY_PREFIX === 'kc:local:') {
      issue('REDIS_KEY_PREFIX', 'must differ per environment to avoid cross-environment eviction');
    }
    // Retaining a child's voice is the highest-risk data decision available to
    // us. Turning it on requires deliberate acknowledgement, not a typo.
    if (env.RETENTION_RAW_AUDIO_DAYS > 0 && !env.RETENTION_RAW_AUDIO_OPT_IN_ACK) {
      issue(
        'RETENTION_RAW_AUDIO_DAYS',
        'is greater than 0 in production without RETENTION_RAW_AUDIO_OPT_IN_ACK — see docs/adr/0006',
      );
    }
  }
});

export type ValidatedEnv = z.infer<typeof envSchema>;
export type { AppEnv };
