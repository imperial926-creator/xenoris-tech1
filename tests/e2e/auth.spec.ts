import { test, expect } from '@playwright/test';

/**
 * Phase 1 e2e smoke test: register a brand-new organization through the real
 * UI and land on the dashboard. Uses a randomized email per run so it can be
 * re-run against a persistent dev database without colliding.
 *
 * Run with: npm run test:e2e (requires `npm run dev` reachable — the
 * Playwright config starts it automatically, see playwright.config.ts).
 */
test('a new restaurant can register and reach the dashboard', async ({ page }) => {
  const unique = Date.now();
  await page.goto('/register');

  await page.getByLabel('Restaurant / organization name').fill(`E2E Test Restaurant ${unique}`);
  await page.getByLabel('Organization email').fill(`e2e-org-${unique}@restaurant-platform.local`);
  await page.getByLabel('First name').fill('E2E');
  await page.getByLabel('Last name').fill('Owner');
  await page.getByLabel('Your email (login)').fill(`e2e-owner-${unique}@restaurant-platform.local`);
  await page.getByLabel('Password').fill('SuperSecret123!');

  await page.getByRole('button', { name: 'Create organization' }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText('Business Overview')).toBeVisible();
});

test('an unauthenticated visitor to /dashboard is redirected to /login', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});
