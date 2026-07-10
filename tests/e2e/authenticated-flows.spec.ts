import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

type Credentials = { email: string; password: string };

function credentials(prefix: string): Credentials | null {
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  return email && password ? { email, password } : null;
}

async function signIn(page: Page, account: Credentials) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: /sign in/i }).click();
}

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).include('main').analyze();
  expect(violations.filter(({ impact }) => impact === 'critical' || impact === 'serious')).toEqual([]);
}

test('customer can reach Quick Restock and use its search by keyboard', async ({ page }) => {
  const customer = credentials('E2E_CUSTOMER');
  test.skip(!customer, 'Set E2E_CUSTOMER_EMAIL and E2E_CUSTOMER_PASSWORD to run this customer flow.');

  await signIn(page, customer!);
  await expect(page).toHaveURL(/\/portal(?:\?.*)?$/);
  await expect(page.getByRole('heading', { name: /Build this week.s restock/i })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  const search = page.getByLabel('Search products');
  await search.focus();
  await search.fill('coffee');
  await expect(page.getByText(/product(?:s)? shown/i)).toBeAttached();
  await search.fill('');

  const addButton = page.getByRole('button', { name: /^Add .* to order$/i }).first();
  await expect(addButton).toBeVisible();
  await addButton.click();
  await page.locator('a:visible').filter({ hasText: /^Review order$/ }).first().click();

  const quantity = page.getByLabel(/^Quantity for /).first();
  await quantity.fill('');
  await expect(quantity).toHaveValue('');
  await expect(page.locator('.cart-review-row')).toHaveCount(1);
  await quantity.fill('10000');
  await quantity.press('Enter');
  await expect(quantity).toHaveValue('9999');
});

test('full admin can reach the admin workspace', async ({ page }) => {
  const admin = credentials('E2E_ADMIN');
  test.skip(!admin, 'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to run this admin role flow.');

  await signIn(page, admin!);
  await expect(page).toHaveURL(/\/admin(?:\/|$)/);
  await expect(page.locator('main')).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});

test('limited admin is redirected away from a denied section', async ({ page }) => {
  const limitedAdmin = credentials('E2E_LIMITED_ADMIN');
  const deniedPath = process.env.E2E_LIMITED_ADMIN_DENIED_PATH;
  test.skip(
    !limitedAdmin || !deniedPath,
    'Set limited-admin credentials and E2E_LIMITED_ADMIN_DENIED_PATH to verify its configured permission boundary.'
  );

  await signIn(page, limitedAdmin!);
  await page.goto(deniedPath!);
  await expect(page).toHaveURL(/\/admin\/access-denied/);
  await expectNoSeriousAccessibilityViolations(page);
});

test('inactive users are denied portal access', async ({ page }) => {
  const inactiveUser = credentials('E2E_INACTIVE_USER');
  test.skip(
    !inactiveUser,
    'Set E2E_INACTIVE_USER_EMAIL and E2E_INACTIVE_USER_PASSWORD to run this inactive-user flow.'
  );

  await signIn(page, inactiveUser!);
  await expect(page).toHaveURL(/\/login\?inactive=1/);
  await expect(page.locator('.login-alert[role="alert"]')).toContainText('inactive');
  await expectNoSeriousAccessibilityViolations(page);
});

test('a customer cannot read an order belonging to another center', async ({ page }) => {
  const customer = credentials('E2E_CENTER_A_USER');
  const otherCenterOrderId = process.env.E2E_OTHER_CENTER_ORDER_ID;
  test.skip(
    !customer || !otherCenterOrderId,
    'Set center-A credentials and an order ID owned by a different center to run isolation coverage.'
  );

  await signIn(page, customer!);
  const response = await page.goto(`/portal/orders/${encodeURIComponent(otherCenterOrderId!)}`);
  expect(response?.status()).toBe(404);
  await expect(page.getByText(/could not be found/i)).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});
