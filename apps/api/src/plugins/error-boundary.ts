import { redactObject, toAppError, validationFailed, type ValidationDetail } from '@kids/shared';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

/**
 * The single error boundary. See docs/ERROR_HANDLING.md §11.
 *
 * Handlers never format errors themselves. One place, one shape — which is what
 * makes "never leak internals" auditable rather than aspirational.
 */
/**
 * The plugin types `params.issue` as `unknown`, so narrow it here rather than
 * asserting — a malformed issue must not crash the error handler itself.
 */
interface ZodIssueShape {
  readonly path: readonly (string | number | symbol)[];
  readonly message: string;
}

const isZodIssueShape = (value: unknown): value is ZodIssueShape =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { path?: unknown }).path) &&
  typeof (value as { message?: unknown }).message === 'string';

interface FastifyValidationEntry {
  readonly instancePath?: string;
  readonly message?: string;
  readonly params?: { readonly issue?: unknown };
}

/**
 * Extracts field-level detail from a schema rejection.
 *
 * Handles BOTH shapes, because relying on the type provider's own predicate
 * silently mislabelled every schema rejection as an internal error — a malformed
 * request body returned 500 instead of 400, for months, because no test had
 * exercised a schema-level rejection rather than a hand-thrown one.
 *
 * So the detection is now the presence of `error.validation`, which is Fastify's
 * own contract and does not depend on a plugin's helper agreeing with us.
 */
const validationDetailsOf = (error: unknown): ValidationDetail[] => {
  const entries = (error as { validation?: unknown }).validation;
  if (!Array.isArray(entries)) return [];

  return (entries as FastifyValidationEntry[]).map((entry) => {
    const issue: unknown = entry.params?.issue;

    if (isZodIssueShape(issue)) {
      return {
        field: issue.path.map((p) => String(p)).join('.') || '(body)',
        issue: issue.message,
      };
    }

    // Fastify's standard shape: `instancePath` like "/birthYear".
    return {
      field: (entry.instancePath ?? '').replace(/^\//, '').replace(/\//g, '.') || '(body)',
      issue: entry.message ?? 'is invalid',
    };
  });
};

const errorBoundaryPlugin: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((error, request, reply) => {
    // The presence of `error.validation` is what makes it a schema rejection —
    // not whether the details could be extracted from it. Gating on the details
    // being non-empty is what turned malformed request bodies into 500s: the
    // predicate matched, the per-entry shape did not, and an empty detail list
    // fell through to "internal error".
    const isSchemaRejection = Array.isArray((error as { validation?: unknown }).validation);
    const details: ValidationDetail[] = isSchemaRejection ? validationDetailsOf(error) : [];

    const appError = isSchemaRejection ? validationFailed(details, error) : toAppError(error);

    // Context is developer-authored and therefore the most likely place for a
    // sensitive field to be added without thinking. Redact before it reaches a log.
    const logPayload = {
      err: appError,
      requestId: request.requestId,
      errorCode: appError.code,
      errorCategory: appError.category,
      context: redactObject(appError.context),
      method: request.method,
      route: request.routeOptions.url ?? request.url,
    };

    app.log[appError.logLevel](logPayload, 'request failed');

    void reply.status(appError.httpStatus).send(appError.toClientBody(request.requestId));
  });

  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({
      error: {
        code: 'RESOURCE_NOT_FOUND',
        message: 'Not found.',
        requestId: request.requestId,
      },
    });
  });
};

export default fp(errorBoundaryPlugin, { name: 'error-boundary' });
