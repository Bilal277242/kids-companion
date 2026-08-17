import type { ParentId, SubscriptionId, IsoTimestamp } from '@kids/types';

/**
 * Payment ports.
 *
 * Three concerns are kept separate, deliberately, because they are commonly
 * conflated — see docs/adr/0007-payments-and-app-store-billing.md:
 *
 *   1. Payment collection — vendor-specific, per rail.
 *   2. Subscription state — our record, reconciled from verified webhooks.
 *   3. Entitlement       — "may this child take another turn right now?",
 *                          answered from our own state, in one place.
 */

export const PAYMENT_RAILS = [
  'stripe',
  'jazzcash',
  'easypaisa',
  'apple_iap',
  'google_play',
  'mock',
] as const;
export type PaymentRail = (typeof PAYMENT_RAILS)[number];

/** Minor units plus a currency code. Never a float. */
export interface Money {
  readonly amountMinor: number;
  readonly currency: string;
}

export interface CheckoutRequest {
  readonly parentId: ParentId;
  readonly planCode: string;
  readonly price: Money;
  /** Required — retries on a flaky mobile connection are routine, not an edge case. */
  readonly idempotencyKey: string;
}

export interface CheckoutSession {
  readonly rail: PaymentRail;
  readonly externalId: string;
  readonly redirectUrl?: string;
  readonly expiresAt: IsoTimestamp;
}

export interface WebhookEvent {
  readonly rail: PaymentRail;
  readonly externalId: string;
  readonly type: string;
  readonly occurredAt: IsoTimestamp;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface PaymentProvider {
  readonly rail: PaymentRail;
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  /**
   * Verifies the signature and returns the parsed event, or rejects.
   *
   * An unverified webhook endpoint is a free-subscription vulnerability, and is
   * the single most common flaw in payment integrations. Implementations MUST
   * verify before parsing, never after.
   */
  verifyAndParseWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
  ): Promise<WebhookEvent>;
}

/* -------------------------------------------------------------------------- */
/* Entitlement                                                                 */
/* -------------------------------------------------------------------------- */

export const SUBSCRIPTION_STATUSES = [
  'free',
  'active',
  'past_due',
  'cancelled',
  'expired',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface Entitlement {
  readonly subscriptionId?: SubscriptionId;
  readonly status: SubscriptionStatus;
  readonly dailyMinuteAllowance: number;
  readonly childProfileLimit: number;
  readonly validUntil?: IsoTimestamp;
}

export interface EntitlementResolver {
  /**
   * Resolved from our own state, never by calling a payment vendor synchronously.
   * A webhook outage must not stop a paying child from talking.
   */
  resolve(parentId: ParentId): Promise<Entitlement>;
}
