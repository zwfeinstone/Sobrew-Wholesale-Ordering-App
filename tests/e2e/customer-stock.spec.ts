import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { buildCheckoutBrowserFixture } from '../support/checkout-browser-fixture';

let fixture: string;
test.beforeAll(async () => { fixture = await buildCheckoutBrowserFixture(); });

async function openFixture(page: Page, path: string) {
  await page.route('**/*', (route) => {
    if (route.request().resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" />' });
    if (new URL(route.request().url()).origin === 'https://checkout.test' && route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'text/html', body: fixture });
    return route.abort('blockedbyclient');
  });
  await page.goto(`https://checkout.test${path}`);
}

test('shows all three allocation counts in the order guide and caps cart quantities', async ({ page }, testInfo) => {
  await openFixture(page, '/portal?held_stock=1');
  await expect(page.getByRole('heading', { name: 'Custom 8-ounce bags' })).toBeVisible();
  const summary = page.locator('[aria-label="Your bags inventory"]');
  await expect(summary).toContainText('Available to order900');
  await expect(summary).toContainText('Awaiting shipment100');
  await expect(summary).toContainText('Held at Sobrew1,000');
  await expect(page.getByText('Purchased batch', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const audit = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(audit.violations.filter((issue) => issue.impact === 'serious' || issue.impact === 'critical')).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('customer-stock-guide.png'), fullPage: true });

  await page.goto('https://checkout.test/portal/cart?held_stock=1');
  const quantity = page.getByRole('spinbutton', { name: 'Quantity for Custom 8-ounce bags' });
  await expect(quantity).toHaveAttribute('max', '900');
  await quantity.fill('1000');
  await quantity.blur();
  await expect(quantity).toHaveValue('900');
  await expect(page.getByRole('button', { name: 'Increase Custom 8-ounce bags quantity' })).toBeDisabled();
  expect(await page.evaluate(() => window.checkoutFixture.readCart()[0].qty)).toBe(900);
});

test('disables exhausted batches and removes stale cart quantities', async ({ page }) => {
  await openFixture(page, '/portal?held_stock=1&available=0');
  await expect(page.getByRole('button', { name: /Fully allocated/ })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.checkoutFixture.readCart())).toEqual([]);
});

test('prevents recurring allocation orders and explains that releases have no extra invoice', async ({ page }) => {
  await openFixture(page, '/portal/checkout?held_stock=1');
  await expect(page.getByRole('checkbox', { name: 'Make this order recurring' })).toBeDisabled();
  await expect(page.getByText('This delivery is included in your purchased batch.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.checkoutFixture.calls.length)).toBe(1);
  expect(await page.evaluate(() => window.checkoutFixture.calls[0].is_recurring)).toBeUndefined();
});


test('Ground and Whole Bean share one limit across guide, cart and checkout', async ({ page }, testInfo) => {
  await openFixture(page, '/portal?shared_stock=1');
  await expect(page.getByRole('heading', { name: 'Custom 8-ounce bags - Ground', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Custom 8-ounce bags - Whole Bean', exact: true })).toBeVisible();
  const guideSummaries = page.locator('[aria-label="Shared bag inventory"]');
  await expect(guideSummaries).toHaveCount(2);
  await expect(guideSummaries.first()).toContainText('Shared bag inventory (Ground + Whole Bean)');
  await expect(guideSummaries.last()).toContainText('Both options use this same bag balance.');
  await expect(guideSummaries.first()).toContainText('Available to order1,000');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const audit = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(audit.violations.filter((issue) => issue.impact === 'serious' || issue.impact === 'critical')).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('shared-stock-guide.png'), fullPage: true });

  await page.goto('https://checkout.test/portal/cart?shared_stock=1');
  const summary = page.locator('[aria-label="Shared bag inventory"]');
  await expect(summary).toHaveCount(1);
  await expect(summary).toContainText('In this order: 150 bags combined');
  const ground = page.getByRole('spinbutton', { name: 'Quantity for Custom 8-ounce bags - Ground', exact: true });
  const whole = page.getByRole('spinbutton', { name: 'Quantity for Custom 8-ounce bags - Whole Bean', exact: true });
  await expect(ground).toHaveAttribute('max', '950');
  await ground.fill('600');
  await ground.blur();
  await expect(whole).toHaveAttribute('max', '400');
  await whole.fill('500');
  await whole.blur();
  await expect(whole).toHaveValue('400');
  await expect(summary).toContainText('In this order: 1,000 bags combined');
  await expect(page.getByRole('button', { name: 'Increase Custom 8-ounce bags - Ground quantity', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Increase Custom 8-ounce bags - Whole Bean quantity', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('shared-stock-cart.png'), fullPage: true });

  await page.goto('https://checkout.test/portal/checkout?shared_stock=1');
  await expect(page.locator('[aria-label="Shared bag inventory"]')).toHaveCount(1);
  await expect(page.locator('[aria-label="Shared bag inventory"]')).toContainText('In this order: 1,000 bags combined');
  await expect(page.getByRole('checkbox', { name: 'Make this order recurring' })).toBeDisabled();
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.checkoutFixture.calls.length)).toBe(1);
  const submitted = await page.evaluate(() => JSON.parse(window.checkoutFixture.calls[0].cart_json) as Array<{ qty: number }>);
  expect(submitted.reduce((sum, item) => sum + item.qty, 0)).toBe(1000);
});

test('guide add buttons respond to the other variant using the entire pool', async ({ page }) => {
  await openFixture(page, '/portal?shared_stock=1');
  await page.evaluate(() => window.checkoutFixture.setSharedQuantities(1000, 0));
  await expect(page.getByRole('button', { name: 'Fully allocated Custom 8-ounce bags - Whole Bean to order', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Decrease Custom 8-ounce bags - Ground quantity', exact: true }).click();
  await page.getByRole('button', { name: 'Add Custom 8-ounce bags - Whole Bean to order', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.checkoutFixture.readCart().reduce((sum, item) => sum + item.qty, 0))).toBe(1000);
  await expect(page.getByRole('button', { name: 'Increase Custom 8-ounce bags - Whole Bean quantity', exact: true })).toBeDisabled();
});

test('checkout rejects a stale combined quantity that exceeds the shared balance', async ({ page }) => {
  await openFixture(page, '/portal/checkout?shared_stock=1');
  await page.evaluate(() => window.checkoutFixture.setSharedQuantities(600, 500));
  await expect(page.locator('[aria-label="Shared bag inventory"]')).toContainText('In this order: 1,100 bags combined');
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.checkoutFixture.readCart().reduce((sum, item) => sum + item.qty, 0))).toBe(1000);
  expect(await page.evaluate(() => sessionStorage.getItem('checkout-fixture-accepted-posts'))).toBeNull();
});
