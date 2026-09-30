import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { buildCheckoutBrowserFixture } from '../support/checkout-browser-fixture';

let fixture: string;
// No application server: PLAYWRIGHT_BASE_URL=https://checkout.test disables it.
// All requests are intercepted; the form fixture prevents every native POST.
test.beforeAll(async () => { fixture = await buildCheckoutBrowserFixture(); });

async function openFixture(page: Page) {
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === 'https://checkout.test' && route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: fixture });
    }
    return route.abort('blockedbyclient');
  });
  await page.goto('https://checkout.test/portal/checkout');
  await expect(page.getByRole('heading', { name: 'Checkout', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Place order', exact: true })).toBeEnabled();
}

async function completeOrder(page: Page) {
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.checkoutFixture.calls.length)).toBe(1);
  const submissionId = await page.evaluate(() => window.checkoutFixture.calls[0].submission_id);
  await page.evaluate(() => window.checkoutFixture.completeOrder?.());
  await expect(page.getByRole('heading', { name: 'Your order is placed.', exact: true })).toBeVisible();
  return submissionId;
}

test('locks submission immediately and gives clear progress during a slow confirmation', async ({ page }) => {
  await openFixture(page);
  await page.getByRole('button', { name: 'Place order', exact: true }).dblclick();
  await expect(page.getByRole('button', { name: 'Placing order...', exact: true })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('Sending your order');
  await expect(page.getByRole('button', { name: 'Placing order...', exact: true })).toHaveAttribute('aria-busy', 'true');
  await page.locator('form').evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
    (form as HTMLFormElement).requestSubmit();
  });
  expect(await page.evaluate(() => window.checkoutFixture.calls.length)).toBe(1);
  expect(await page.evaluate(() => window.checkoutFixture.readSubmission()?.status)).toBe('submitted');
});

test('reuses the submission identity after reload instead of creating a second order intent', async ({ page }) => {
  await openFixture(page);
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  const firstSubmissionId = await page.evaluate(() => window.checkoutFixture.calls[0].submission_id);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Place order', exact: true })).toBeEnabled();
  await expect(page.locator('input[name="submission_id"]')).toHaveValue(firstSubmissionId);
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  expect(await page.evaluate(() => window.checkoutFixture.calls[0].submission_id)).toBe(firstSubmissionId);
});

test('clears only the confirmed customer draft and keeps its receipt across reloads', async ({ page }) => {
  await openFixture(page);
  const submissionId = await completeOrder(page);
  await expect.poll(() => page.evaluate(() => window.checkoutFixture.readCart())).toEqual([]);
  expect(await page.evaluate(() => window.checkoutFixture.readSubmission())).toMatchObject({ submissionId, status: 'completed', orderId: '4a13baf3-1111-4111-8111-111111111111' });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem(window.checkoutFixture.otherCartStorageKey) || '[]'))).toEqual([expect.objectContaining({ qty: 2 })]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your order is placed.', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('no need to submit it again');
  await expect(page.getByRole('button', { name: /reorder/i })).toHaveCount(0);
  expect(await page.evaluate(() => window.checkoutFixture.readCart())).toEqual([]);
});

test('an older receipt cannot erase a newer cart with the same products and quantities', async ({ page }) => {
  await openFixture(page);
  const confirmedSubmissionId = await completeOrder(page);
  await expect.poll(() => page.evaluate(() => window.checkoutFixture.readCart())).toEqual([]);
  await page.evaluate(() => window.checkoutFixture.setCartQuantity(4));
  const newerSubmission = await page.evaluate(() => window.checkoutFixture.readSubmission());
  expect(newerSubmission?.submissionId).not.toBe(confirmedSubmissionId);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your order is placed.', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.checkoutFixture.readCart())).toEqual([expect.objectContaining({ qty: 4 })]);
  expect(await page.evaluate(() => window.checkoutFixture.readSubmission())).toEqual(newerSubmission);
});

test('renders responsive checkout and confirmation without serious accessibility violations', async ({ page }, testInfo) => {
  await openFixture(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const checkoutAudit = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(checkoutAudit.violations.filter((issue) => issue.impact === 'serious' || issue.impact === 'critical')).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('checkout.png'), fullPage: true });

  await completeOrder(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'View my orders', exact: true })).toBeVisible();
  const confirmationAudit = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(confirmationAudit.violations.filter((issue) => issue.impact === 'serious' || issue.impact === 'critical')).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('confirmation.png'), fullPage: true });
});

test('keeps the order confirmed when only recurring setup needs attention', async ({ page }) => {
  await openFixture(page);
  await completeOrder(page);
  await page.goto(`${page.url()}&recurring=error`);
  await expect(page.getByRole('heading', { name: 'Your order is placed.', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Only the recurring schedule could not be saved. Please do not place this order again.');
  await expect(page.getByRole('link', { name: 'Review recurring orders', exact: true })).toHaveAttribute('href', '/portal/recurring-orders');
});
