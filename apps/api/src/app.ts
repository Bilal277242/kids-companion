import { randomBytes } from 'node:crypto';

import swagger from '@fastify/swagger';
import {
  createLocalAuthAdapter,
  createSessionService,
  createSupabaseAuthAdapter,
  createTokenService,
  type AuthProvider,
} from '@kids/auth';
import type { Config } from '@kids/config';
import type { Database } from '@kids/db';
import { createLogger } from '@kids/shared';
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
import { childRoutes } from './routes/children.js';
import { consentRoutes } from './routes/consent.js';
import { healthRoutes } from './routes/health.js';
import { parentRoutes } from './routes/parents.js';

export interface BuildAppOptions {
  readonly config: Config;
  /**
   * Injected so integration tests can drive the real routes against real SQL and
   * real RLS policies in PGlite, with no Docker daemon and no mock standing in
   * for the thing most worth testing.
   */
  readonly db: Database;
  readonly now?: () => Date;
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

  await app.register(requestContext);
  await app.register(errorBoundary);
  await app.register(security, { config });
  await app.register(authPlugin, { db, tokens, sessions });

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
  await app.register(parentRoutes({ auth, db, sessions, audit }));
  await app.register(childRoutes({ audit }));
  await app.register(consentRoutes({ audit }));

  return app;
};

/** The concrete application type, for callers that need to name it. */
export type App = Awaited<ReturnType<typeof buildApp>>;
