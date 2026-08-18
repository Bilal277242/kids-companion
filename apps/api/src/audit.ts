import { asSystem, type Database } from '@kids/db';
import type { FastifyRequest } from 'fastify';

/**
 * Audit logging for security-relevant actions.
 *
 * Records WHO did WHAT to WHICH resource, and whether it succeeded. Never the
 * content of what was accessed: an entry saying "an operator read a transcript"
 * must not contain the transcript, or the audit log becomes a second,
 * less-protected copy of the thing it exists to protect (docs/LOGGING.md §8).
 *
 * Writes run under the system context because `audit_logs` has no SELECT policy
 * for `authenticated` — a principal cannot read, edit, or remove the record of
 * their own actions.
 */

export const AUDIT_ACTIONS = [
  'auth.registration.succeeded',
  'auth.registration.duplicate_email',
  'auth.login.succeeded',
  'auth.login.failed',
  'auth.login.locked_out',
  'auth.logout.succeeded',
  'auth.session.refreshed',
  'auth.session.reuse_detected',
  'auth.session.revoked_all',
  'auth.email.verification_requested',
  'auth.email.verified',
  'auth.password.reset_requested',
  'auth.password.reset_completed',
  'auth.password.changed',
  'account.profile.updated',
  'child.profile.created',
  'child.profile.updated',
  'child.profile.archived',
  'child.profile.restored',
  'child.profile.deleted',
  'conversation.started',
  'conversation.ended',
  'conversation.quota_exhausted',
  'safety.escalation.raised',
  'consent.granted',
  'consent.withdrawn',
  'account.deletion.requested',
  'account.deletion.cancelled',
  'authz.permission.denied',
  'authz.ownership.denied',
  'admin.role.assigned',
  'admin.account.suspended',
  'support.flag.reviewed',

  // Voice. The retention DECISION is audited on every turn, so "were
  // recordings kept?" is answerable from the audit log alone rather than by
  // trusting that a configuration value was what someone said it was.
  'voice.turn.completed',
  'voice.audio.expired',

  // Practice.
  'practice.session.started',

  // Parental controls. "Who loosened this, and when?" has to be answerable.
  'parental_controls.updated',
  'conversation.parental_limit_reached',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type ActorType = 'parent' | 'child_session' | 'system' | 'operator' | 'service_role';

export interface AuditEntry {
  readonly actorId?: string | undefined;
  readonly actorType: ActorType;
  readonly action: AuditAction;
  readonly resourceType: string;
  readonly resourceId?: string | undefined;
  readonly subjectChildId?: string | undefined;
  readonly outcome: 'success' | 'denied' | 'error';
  /** Required for service_role actions — an RLS-bypassing action needs a reason. */
  readonly justification?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface AuditLogger {
  record(entry: AuditEntry, request?: FastifyRequest): Promise<void>;
}

export const createAuditLogger = (db: Database): AuditLogger => ({
  record: async (entry, request) => {
    await asSystem(db, async (tx) => {
      await tx.query(
        `insert into audit_logs
           (actor_id, actor_type, action, resource_type, resource_id, subject_child_id,
            outcome, justification, request_id, source_ip, user_agent, metadata)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          entry.actorId ?? null,
          entry.actorType,
          entry.action,
          entry.resourceType,
          entry.resourceId ?? null,
          entry.subjectChildId ?? null,
          entry.outcome,
          entry.justification ?? null,
          request?.requestId ?? null,
          request?.ip ?? null,
          request?.headers['user-agent'] ?? null,
          JSON.stringify(entry.metadata ?? {}),
        ],
      );
    });
  },
});

/**
 * An audit write that fails must fail the operation.
 *
 * A security-relevant action that could not be recorded is an unaccountable
 * action, and the correct response is to refuse it rather than perform it
 * invisibly (docs/ERROR_HANDLING.md §9). This wrapper exists so that intent is
 * explicit at each call site rather than implied by the absence of a `.catch()`.
 */
export const auditOrFail = async (
  logger: AuditLogger,
  entry: AuditEntry,
  request?: FastifyRequest,
): Promise<void> => {
  await logger.record(entry, request);
};
