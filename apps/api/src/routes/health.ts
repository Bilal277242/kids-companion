import type { Config } from '@kids/config';
import { healthResponseSchema, readyResponseSchema } from '@kids/validation';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

/**
 * Liveness, readiness, and version. See docs/API_CONVENTIONS.md §10.
 *
 * Every route declares a response schema, so Fastify serialises through it and
 * a field the schema does not name cannot be emitted.
 */
export const healthRoutes =
  (config: Config): FastifyPluginAsyncZod =>
  async (app) => {
    /**
     * Liveness. Deliberately touches no dependency.
     *
     * A liveness probe that fails on a slow database query restarts a healthy
     * process during exactly the incident where restarts hurt most.
     */
    app.get(
      '/health',
      {
        schema: {
          description: 'Liveness. Never touches a dependency.',
          response: { 200: healthResponseSchema },
        },
        config: { rateLimit: false },
      },
      async () => ({
        status: 'ok' as const,
        service: config.SERVICE_NAME,
        version: config.SERVICE_VERSION,
      }),
    );

    /** Readiness. Checks dependencies; drives load-balancer routing. */
    app.get(
      '/ready',
      {
        schema: {
          description: 'Readiness. Reports dependency reachability.',
          response: { 200: readyResponseSchema, 503: readyResponseSchema },
        },
        config: { rateLimit: false },
      },
      async (_request, reply) => {
        // Phase 1 adds real Postgres and Redis probes here. They are reported as
        // `skipped` rather than `ok` so readiness never claims a check it did not run.
        const checks: Record<string, 'ok' | 'unavailable' | 'skipped'> = {
          database: 'skipped',
          redis: 'skipped',
        };

        const degraded = Object.values(checks).some((v) => v === 'unavailable');
        return await reply
          .status(degraded ? 503 : 200)
          .send({ status: degraded ? ('degraded' as const) : ('ready' as const), checks });
      },
    );

    app.get(
      '/v1/version',
      {
        schema: {
          description: 'Build version and environment.',
          response: {
            200: z.object({
              version: z.string(),
              service: z.string(),
              appEnv: z.string(),
            }),
          },
        },
      },
      async () => ({
        version: config.SERVICE_VERSION,
        service: config.SERVICE_NAME,
        appEnv: config.APP_ENV,
      }),
    );
  };
