import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiHarness, type ApiHarness } from '../helpers/api.js';

/**
 * Integration tests: the real application, real plugins, real serialisation.
 * No network, no containers — `app.inject()` drives the full request lifecycle.
 *
 * Phase 1 adds the Postgres- and Redis-backed suites, which do need containers.
 */
describe('API integration', () => {
  let harness: ApiHarness;
  let app: ApiHarness['app'];

  beforeAll(async () => {
    harness = await createApiHarness();
    app = harness.app;
  }, 180_000);

  afterAll(async () => {
    await harness.close();
  });

  describe('GET /health', () => {
    it('reports liveness', async () => {
      const response = await app.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        status: 'ok',
        service: 'kids-companion-api',
        version: '0.0.0',
      });
    });

    it('responds without touching a dependency', async () => {
      // A liveness probe that fails on a slow query restarts a healthy process
      // during exactly the incident where restarts hurt most.
      const response = await app.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /ready', () => {
    it('reports unrun checks as skipped rather than ok', async () => {
      const response = await app.inject({ method: 'GET', url: '/ready' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'ready',
        checks: { database: 'skipped', redis: 'skipped' },
      });
    });
  });

  describe('request correlation', () => {
    it('returns a request id on every response', async () => {
      const response = await app.inject({ method: 'GET', url: '/health' });

      expect(response.headers['x-request-id']).toBeTruthy();
    });

    it('honours a well-formed client-supplied request id', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { 'x-request-id': 'client-abc-123' },
      });

      expect(response.headers['x-request-id']).toBe('client-abc-123');
    });

    it('replaces a malformed client-supplied request id', async () => {
      // The value lands in log lines. An unbounded client-controlled string in a
      // log aggregator is a log-injection vector, not a formatting problem.
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { 'x-request-id': 'inject\nlevel=fatal msg="fake entry"' },
      });

      expect(response.headers['x-request-id']).not.toContain('\n');
      expect(response.headers['x-request-id']).not.toContain('fake entry');
    });
  });

  describe('error handling', () => {
    it('returns the standard error shape with a request id for an unknown route', async () => {
      const response = await app.inject({ method: 'GET', url: '/no-such-route' });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Not found.' },
      });
      expect(response.json().error.requestId).toBeTruthy();
    });

    it('leaks no stack trace or internal detail', async () => {
      const response = await app.inject({ method: 'GET', url: '/no-such-route' });

      expect(response.body).not.toContain('at ');
      expect(response.body).not.toContain('node_modules');
      expect(response.body).not.toContain('.ts:');
    });
  });

  describe('security headers', () => {
    it('sets the baseline hardening headers', async () => {
      const response = await app.inject({ method: 'GET', url: '/health' });

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    });
  });

  describe('CORS', () => {
    it('does not reflect an arbitrary origin', async () => {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/health',
        headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
      });

      expect(response.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    });

    it('allows a configured origin', async () => {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/health',
        headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'GET' },
      });

      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    });
  });

  describe('response serialisation', () => {
    it('emits only the fields the response schema declares', async () => {
      // This is a privacy control, not a performance trick: a field the schema
      // does not name cannot leak. See docs/adr/0002.
      const response = await app.inject({ method: 'GET', url: '/v1/version' });

      expect(Object.keys(response.json()).sort()).toEqual(['appEnv', 'service', 'version']);
    });
  });

  describe('OpenAPI', () => {
    it('generates a document from the route schemas', () => {
      const document = app.swagger() as { openapi?: string; paths?: Record<string, unknown> };

      expect(document.openapi).toBe('3.1.0');
      expect(Object.keys(document.paths ?? {})).toContain('/health');
    });
  });
});
