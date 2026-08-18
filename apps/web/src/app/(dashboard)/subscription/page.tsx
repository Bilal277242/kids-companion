import { Card, ErrorState, InfoBanner, PageHeader, Pill } from '../../../components/ui';
import { getSubscription } from '../../../lib/api';
import { count, longDate } from '../../../lib/format';

export const dynamic = 'force-dynamic';

/**
 * Subscription.
 *
 * A statement of what the account is on, not a checkout. Payment happens through
 * the app store or the wallet a parent signed up with, and this page says so
 * rather than collecting a card — the rails available in Pakistan are still open
 * (Q-02), and a web form that took card details would need to be PCI scope this
 * product does not want.
 *
 * There is no card number here because there is no card number stored. The
 * `subscriptions` table has a vendor token, a brand, and four digits, and that
 * is the whole of it.
 */

const money = (minor: number, currency: string): string => {
  if (minor === 0) return 'Free';
  const major = (minor / 100).toFixed(2).replace(/\.00$/, '');
  return `${currency} ${major}`;
};

const STATUS_WORDS: Record<string, string> = {
  free: 'Free plan',
  trialing: 'Free trial',
  active: 'Active',
  past_due: 'Payment failed',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export default async function SubscriptionPage() {
  const result = await getSubscription();

  if (result.state !== 'ok') {
    return (
      <>
        <PageHeader title="Subscription" />
        <ErrorState message={result.state === 'error' ? result.message : 'Please sign in again.'} />
      </>
    );
  }

  const { plan, limits, renewal, paymentMethod, childProfilesUsed, availablePlans, note } =
    result.data;

  return (
    <>
      <PageHeader
        title="Subscription"
        description="What your account is on today, and what it allows."
      />

      {plan.status === 'past_due' && (
        <InfoBanner>
          Your last payment did not go through. Your family keeps access for now — we do not cut a
          child off mid-conversation over a failed card — but the plan will fall back to free if it
          is not resolved.
        </InfoBanner>
      )}

      <div className="stack">
        <Card title="Your plan">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div>
              <p className="stat-value" style={{ fontSize: '1.6rem' }}>
                {plan.displayName}
              </p>
              <p className="small muted">{plan.description}</p>
            </div>
            <Pill tone={plan.tier === 'paid' ? 'active' : 'neutral'}>
              {STATUS_WORDS[plan.status] ?? plan.status}
            </Pill>
          </div>

          <dl className="stack" style={{ marginTop: 'var(--space-4)', gap: 'var(--space-2)' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <dt className="small muted">Price</dt>
              <dd className="small" style={{ margin: 0 }}>
                {money(plan.priceMinor, plan.currency)}
                {plan.priceMinor > 0 && plan.billingInterval !== 'none'
                  ? ` a ${plan.billingInterval}`
                  : ''}
              </dd>
            </div>
            {renewal.trialEndsAt !== null && (
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <dt className="small muted">Trial ends</dt>
                <dd className="small" style={{ margin: 0 }}>
                  {longDate(renewal.trialEndsAt)}
                </dd>
              </div>
            )}
            {renewal.currentPeriodEnd !== null && (
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <dt className="small muted">
                  {renewal.cancelAt === null ? 'Renews' : 'Access until'}
                </dt>
                <dd className="small" style={{ margin: 0 }}>
                  {longDate(renewal.currentPeriodEnd)}
                </dd>
              </div>
            )}
            {paymentMethod.last4 !== null && (
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <dt className="small muted">Paid with</dt>
                <dd className="small" style={{ margin: 0 }}>
                  {`${paymentMethod.brand ?? 'card'} ending ${paymentMethod.last4}`}
                </dd>
              </div>
            )}
          </dl>

          <p className="stat-explain">{note}</p>
          <p className="stat-caveat">
            We never see or store your full card number. Our payment provider holds it and gives us
            a token, a brand, and the last four digits — enough for you to recognise which card, and
            nothing more.
          </p>
        </Card>

        <Card title="What this plan allows">
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Plan limits</caption>
              <thead>
                <tr>
                  <th scope="col">Limit</th>
                  <th scope="col">On your plan</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Child profiles</th>
                  <td>
                    {`${String(childProfilesUsed)} of ${String(limits.childProfileLimit)} used`}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Messages a day</th>
                  <td>{count(limits.dailyTurnLimit, 'message')}</td>
                </tr>
                <tr>
                  <th scope="row">Minutes a day</th>
                  <td>
                    {limits.dailyMinuteLimit === 0
                      ? 'No limit from the plan'
                      : count(limits.dailyMinuteLimit, 'minute')}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Messages in one chat</th>
                  <td>{count(limits.maxConversationTurns, 'message')}</td>
                </tr>
                <tr>
                  <th scope="row">Talking out loud</th>
                  <td>
                    {limits.voiceEnabled
                      ? count(limits.dailyVoiceTurnLimit, 'voice message') + ' a day'
                      : 'Not on this plan'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="stat-caveat">
            Your own daily time limit sits on top of these and can only make them smaller. If you
            set 20 minutes a day, 20 minutes is what applies.
          </p>
        </Card>

        {availablePlans.length > 1 && (
          <Card title="All plans">
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Available plans</caption>
                <thead>
                  <tr>
                    <th scope="col">Plan</th>
                    <th scope="col">Price</th>
                    <th scope="col">Children</th>
                    <th scope="col">Minutes a day</th>
                  </tr>
                </thead>
                <tbody>
                  {availablePlans.map((option) => (
                    <tr key={option.code}>
                      <th scope="row">
                        {option.displayName}
                        {option.code === plan.code && (
                          <>
                            {' '}
                            <Pill tone="active">Your plan</Pill>
                          </>
                        )}
                      </th>
                      <td>{money(option.priceMinor, option.currency)}</td>
                      <td>{String(option.childProfileLimit)}</td>
                      <td>
                        {option.dailyMinuteLimit === 0
                          ? 'No limit'
                          : String(option.dailyMinuteLimit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="stat-explain">
              To change plan, use the app store or payment provider you signed up with. We do not
              take card details on this page.
            </p>
          </Card>
        )}
      </div>
    </>
  );
}
