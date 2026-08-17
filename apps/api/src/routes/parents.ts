import type { AuthProvider, SessionService } from '@kids/auth';
import { checkPasswordPolicy, permissionsFor } from '@kids/auth';
import { asSystem, type Database } from '@kids/db';
import { notFound, validationFailed } from '@kids/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditOrFail, type AuditLogger } from '../audit.js';

/**
 * Parent profile, sessions, children, and account deletion.
 *
 * Every route here demonstrates the four-layer check in `plugins/auth.ts`:
 * authenticated → permitted by role → owns the resource → and the database
 * agrees. The `/children/:childId` routes are where all four matter at once.
 */

export interface ParentRoutesOptions {
  readonly auth: AuthProvider;
  readonly db: Database;
  readonly sessions: SessionService;
  readonly audit: AuditLogger;
}

const parentProfileSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  countryCode: z.string(),
  locale: z.string(),
  timezone: z.string(),
  role: z.enum(['parent', 'admin', 'support']),
  emailVerified: z.boolean(),
  status: z.string(),
  permissions: z.array(z.string()),
  createdAt: z.string(),
});

export const parentRoutes =
  (options: ParentRoutesOptions): FastifyPluginAsyncZod =>
  async (app) => {
    const { audit } = options;

    /* ---------------------------------------------------------------------- */
    /* Profile                                                                */
    /* ---------------------------------------------------------------------- */

    app.get(
      '/v1/parents/me',
      {
        onRequest: [app.authenticate],
        preHandler: [app.authorize('account:read_own')],
        schema: {
          description: 'The authenticated parent.',
          response: { 200: parentProfileSchema },
        },
      },
      async (request, reply) => {
        const principal = request.principal;
        if (!principal) throw notFound();

        // The WHERE is not redundant with RLS, and assuming it was is a bug this
        // route actually had: `parents` has a staff SELECT policy, so for an
        // admin or support user RLS returns EVERY parent, and an unfiltered
        // "select from parents" would hand /me an arbitrary other family's
        // profile. RLS is the backstop for a missed check, never a substitute
        // for making the query say what it means.
        const profile = await app.withParent(request, async (tx) => {
          const { rows } = await tx.query<{
            id: string;
            email: string;
            display_name: string | null;
            country_code: string;
            locale: string;
            timezone: string;
            role: 'parent' | 'admin' | 'support';
            email_verified_at: string | null;
            status: string;
            created_at: string;
          }>(
            `select id, email, display_name, country_code, locale, timezone,
                    role, email_verified_at, status, created_at
               from parents
              where id = $1`,
            [principal.parentId],
          );
          return rows[0];
        });

        if (!profile) throw notFound();

        return await reply.status(200).send({
          id: profile.id,
          email: profile.email,
          displayName: profile.display_name,
          countryCode: profile.country_code,
          locale: profile.locale,
          timezone: profile.timezone,
          role: profile.role,
          emailVerified: profile.email_verified_at !== null,
          status: profile.status,
          permissions: [...permissionsFor(profile.role)],
          createdAt: new Date(profile.created_at).toISOString(),
        });
      },
    );

    app.patch(
      '/v1/parents/me',
      {
        onRequest: [app.authenticate],
        preHandler: [app.authorize('account:update_own')],
        schema: {
          description: 'Update the authenticated parent. Absent fields are unchanged.',
          body: z.object({
            displayName: z.string().min(1).max(80).nullable().optional(),
            countryCode: z.string().length(2).optional(),
            locale: z.string().min(2).max(10).optional(),
            timezone: z.string().min(1).max(64).optional(),
          }),
          response: { 200: parentProfileSchema.pick({ id: true, displayName: true }) },
        },
      },
      async (request, reply) => {
        const body = request.body;

        // PATCH semantics: an absent key means "leave it alone", an explicit
        // null means "clear it". Conflating them means editing a nickname
        // silently wipes a timezone (docs/API_CONVENTIONS.md §2).
        const updated = await app.withParent(request, async (tx) => {
          const { rows } = await tx.query<{ id: string; display_name: string | null }>(
            `update parents
                set display_name = case when $1 then $2 else display_name end,
                    country_code = coalesce($3, country_code),
                    locale       = coalesce($4, locale),
                    timezone     = coalesce($5, timezone)
              where id = $6
              returning id, display_name`,
            [
              Object.hasOwn(body, 'displayName'),
              body.displayName ?? null,
              body.countryCode ?? null,
              body.locale ?? null,
              body.timezone ?? null,
              request.principal?.parentId ?? null,
            ],
          );
          return rows[0];
        });

        if (!updated) throw notFound();

        await auditOrFail(
          audit,
          {
            actorId: request.principal?.parentId,
            actorType: 'parent',
            action: 'account.profile.updated',
            resourceType: 'parent',
            resourceId: updated.id,
            outcome: 'success',
            // Field NAMES, never field values. A value here would put personal
            // data into the audit log (docs/LOGGING.md §8).
            metadata: { fields: Object.keys(body) },
          },
          request,
        );

        return await reply.status(200).send({ id: updated.id, displayName: updated.display_name });
      },
    );

    /* ---------------------------------------------------------------------- */
    /* Sessions                                                               */
    /* ---------------------------------------------------------------------- */

    app.get(
      '/v1/parents/me/sessions',
      {
        onRequest: [app.authenticate],
        preHandler: [app.authorize('sessions:read_own')],
        schema: {
          description: 'Where this account is signed in.',
          response: {
            200: z.object({
              items: z.array(
                z.object({
                  id: z.string(),
                  expiresAt: z.string(),
                  revokedAt: z.string().nullable(),
                  current: z.boolean(),
                }),
              ),
            }),
          },
        },
      },
      async (request, reply) => {
        const principal = request.principal;
        if (!principal) throw notFound();

        const records = await options.sessions.listForParent(principal.parentId);

        return await reply.status(200).send({
          items: records.map((s) => ({
            id: s.id,
            expiresAt: new Date(s.expiresAt).toISOString(),
            revokedAt: s.revokedAt === null ? null : new Date(s.revokedAt).toISOString(),
            current: s.id === principal.sessionId,
          })),
        });
      },
    );

    app.post(
      '/v1/parents/me/sessions/revoke-all',
      {
        onRequest: [app.authenticate],
        preHandler: [app.authorize('sessions:revoke_own')],
        schema: {
          description: 'Sign out everywhere, including this session.',
          response: { 200: z.object({ revoked: z.number().int() }) },
        },
      },
      async (request, reply) => {
        const principal = request.principal;
        if (!principal) throw notFound();

        const revoked = await options.sessions.revokeAllForParent(
          principal.parentId,
          'admin_revoked',
        );

        await auditOrFail(
          audit,
          {
            actorId: principal.parentId,
            actorType: 'parent',
            action: 'auth.session.revoked_all',
            resourceType: 'session',
            outcome: 'success',
            metadata: { count: revoked },
          },
          request,
        );

        return await reply.status(200).send({ revoked });
      },
    );

    /* ---------------------------------------------------------------------- */
    /* Password change and account deletion                                   */
    /* ---------------------------------------------------------------------- */

    app.post(
      '/v1/parents/me/password',
      {
        onRequest: [app.authenticate],
        preHandler: [app.authorize('account:update_own')],
        schema: {
          description: 'Change password. Revokes every session, including this one.',
          body: z.object({
            currentPassword: z.string().min(1).max(256),
            newPassword: z.string().min(1).max(256),
          }),
          response: { 200: z.object({ changed: z.boolean() }) },
        },
      },
      async (request, reply) => {
        const principal = request.principal;
        if (!principal) throw notFound();

        const policy = checkPasswordPolicy(request.body.newPassword);
        if (!policy.ok) {
          throw validationFailed([
            { field: 'newPassword', issue: policy.issue ?? 'is not acceptable' },
          ]);
        }

        // Re-authentication, not just an active session. Changing a password is
        // exactly what someone with a stolen device would do first.
        const changed = await options.auth.changePassword(
          principal.parentId,
          request.body.currentPassword,
          request.body.newPassword,
        );

        if (!changed) {
          throw validationFailed([{ field: 'currentPassword', issue: 'is incorrect' }]);
        }

        await auditOrFail(
          audit,
          {
            actorId: principal.parentId,
            actorType: 'parent',
            action: 'auth.password.changed',
            resourceType: 'parent',
            resourceId: principal.parentId,
            outcome: 'success',
            metadata: { sessionsRevoked: true },
          },
          request,
        );

        return await reply.status(200).send({ changed: true });
      },
    );

    app.delete(
      '/v1/parents/me',
      {
        onRequest: [app.authenticate],
        preHandler: [app.authorize('account:delete_own')],
        schema: {
          description: 'Schedule account deletion. Enters the 30-day grace window.',
          body: z.object({ confirmPassword: z.string().min(1).max(256) }),
          response: {
            202: z.object({ status: z.literal('pending_deletion'), graceDays: z.number().int() }),
          },
        },
      },
      async (request, reply) => {
        const principal = request.principal;
        if (!principal) throw notFound();

        // Re-authentication for a destructive action. An active session is not
        // enough for something irreversible (SECURITY.md §2.3).
        const confirmed = await options.auth.verifyCurrentPassword(
          principal.parentId,
          request.body.confirmPassword,
        );

        if (!confirmed) {
          throw validationFailed([{ field: 'confirmPassword', issue: 'is incorrect' }]);
        }

        // A SYSTEM operation, not a parent update — and the schema says so. Every
        // policy on `parents` carries `deleted_at is null`, so the row the update
        // produces would fail its own policy: a parent cannot write themselves
        // into a state where they can no longer act. That is correct. The parent
        // *requests* deletion; the system performs it, with a justification on
        // the audit record (SECURITY.md §3.2).
        await asSystem(options.db, async (tx) => {
          await tx.query(
            `update parents set status = 'pending_deletion', deleted_at = now() where id = $1`,
            [principal.parentId],
          );
        });

        await options.sessions.revokeAllForParent(principal.parentId, 'account_deleted');

        await auditOrFail(
          audit,
          {
            actorId: principal.parentId,
            actorType: 'service_role',
            action: 'account.deletion.requested',
            resourceType: 'parent',
            resourceId: principal.parentId,
            outcome: 'success',
            justification: 'parent-initiated account deletion, re-authenticated',
            metadata: { graceDays: 30 },
          },
          request,
        );

        // The grace window is a deletion in progress, not a hidden account: the
        // parent row is already invisible to RLS, and the retention sweep hard
        // deletes at the end of it (PRIVACY.md §6).
        return await reply.status(202).send({ status: 'pending_deletion' as const, graceDays: 30 });
      },
    );
  };
