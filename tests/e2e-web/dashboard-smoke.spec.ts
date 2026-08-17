import { expect, test } from '@playwright/test';

/**
 * Browser smoke tests. Run with `pnpm test:e2e:web` after
 * `pnpm exec playwright install --with-deps`.
 *
 * Phase 5 replaces these with the real parent-dashboard journeys: sign in, view
 * a child's conversation history, change a control, export data, delete an
 * account. For now this proves the harness and the build are wired correctly.
 */
test.describe('parent dashboard', () => {
  test('renders the landing page', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'kids-companion' })).toBeVisible();
  });

  test('sets security headers', async ({ page }) => {
    const response = await page.goto('/');

    expect(response?.headers()['x-content-type-options']).toBe('nosniff');
    expect(response?.headers()['x-frame-options']).toBe('DENY');
  });

  test('is not indexable — this surface is for parents, not search engines', async ({ page }) => {
    await page.goto('/');

    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveAttribute('content', /noindex/);
  });
});
