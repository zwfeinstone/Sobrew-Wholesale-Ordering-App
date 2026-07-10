import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

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

function optionalCount(name: string) {
  const rawValue = process.env[name];
  if (!rawValue) return null;

  const value = Number(rawValue.replaceAll(',', ''));
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }

  return value;
}

function statCard(page: Page, label: string): Locator {
  return page.locator('.stat-card').filter({ has: page.getByText(label, { exact: true }) });
}

async function statCount(page: Page, label: string) {
  const card = statCard(page, label);
  await expect(card).toHaveCount(1);

  const displayedValue = (await card.locator('p').nth(1).innerText()).trim();
  const normalizedValue = displayedValue.replaceAll(',', '');
  expect(normalizedValue, `${label} should render as an exact whole-number count.`).toMatch(/^\d+$/);
  return Number(normalizedValue);
}

async function expectRateWithRawRatio(page: Page, label: string) {
  const card = statCard(page, label);
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(/(?:\d+(?:\.\d)% · [\d,]+ \/ [\d,]+|—)/);
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

test.describe('Prospecting report', () => {
  test('full admin sees exact pipeline totals and conversion rates', async ({ page }) => {
    const admin = credentials('E2E_ADMIN');
    const expectedTotalLeads = optionalCount('E2E_PROSPECTING_EXPECTED_TOTAL_LEADS');
    test.skip(!admin, 'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to run this Prospecting report flow.');

    await signIn(page, admin!);
    await page.goto('/admin/reports?report=prospecting');

    await expect(page).toHaveURL(/\/admin\/reports\?.*report=prospecting/);
    await expect(page.getByRole('heading', { name: 'Selected-period performance' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Current pipeline snapshot' })).toBeVisible();
    await expect(page.getByText(/reached the 1,000-row safety limit/i)).toHaveCount(0);

    const totalLeads = await statCount(page, 'Total Leads');
    if (expectedTotalLeads === null) {
      expect(totalLeads, 'The all-rep pipeline count should not be capped at 1,000.').toBeGreaterThan(1_000);
    } else {
      expect(totalLeads).toBe(expectedTotalLeads);
    }

    await expectRateWithRawRatio(page, 'Live Contact Rate');
    await expectRateWithRawRatio(page, 'Calls → Sample');
    await expectNoSeriousAccessibilityViolations(page);
  });

  test('owner can restrict the report to a configured sales rep', async ({ page }) => {
    const admin = credentials('E2E_ADMIN');
    const salesRepId = process.env.E2E_PROSPECTING_SALES_REP_ID;
    const expectedSelectedTotal = optionalCount('E2E_PROSPECTING_EXPECTED_SELECTED_REP_TOTAL_LEADS');
    test.skip(
      !admin || !salesRepId,
      'Set full-admin credentials and E2E_PROSPECTING_SALES_REP_ID to verify the selected-rep aggregate.'
    );

    await signIn(page, admin!);
    await page.goto('/admin/reports?report=prospecting');
    const allRepTotal = await statCount(page, 'Total Leads');

    const params = new URLSearchParams({ report: 'prospecting', sales_rep: salesRepId! });
    await page.goto(`/admin/reports?${params.toString()}`);

    await expect(page.getByLabel('Sales rep')).toHaveValue(salesRepId!);
    expect(new URL(page.url()).searchParams.get('sales_rep')).toBe(salesRepId);
    const selectedRepTotal = await statCount(page, 'Total Leads');
    expect(selectedRepTotal).toBeLessThanOrEqual(allRepTotal);
    if (expectedSelectedTotal !== null) expect(selectedRepTotal).toBe(expectedSelectedTotal);
  });

  test('non-owner report scope ignores a forged sales-rep parameter', async ({ page }) => {
    const limitedAdmin = credentials('E2E_LIMITED_ADMIN');
    const forgedSalesRepId = process.env.E2E_PROSPECTING_FORGED_SALES_REP_ID
      ?? process.env.E2E_PROSPECTING_SALES_REP_ID;
    test.skip(
      !limitedAdmin || !forgedSalesRepId,
      'Set limited-admin credentials and a Prospecting sales-rep ID to verify forged-filter isolation.'
    );

    await signIn(page, limitedAdmin!);
    await page.goto('/admin/reports?report=prospecting');
    const baselineUrl = new URL(page.url());
    test.skip(
      baselineUrl.pathname !== '/admin/reports' || baselineUrl.searchParams.get('report') !== 'prospecting',
      'The configured limited admin cannot view the Prospecting report.'
    );

    const baselineTotal = await statCount(page, 'Total Leads');
    const params = new URLSearchParams({ report: 'prospecting', sales_rep: forgedSalesRepId! });
    await page.goto(`/admin/reports?${params.toString()}`);

    await expect(page.getByLabel('Sales rep')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Current pipeline snapshot' })).toBeVisible();
    expect(await statCount(page, 'Total Leads')).toBe(baselineTotal);
  });
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
