import { expect, test, type Page } from '@playwright/test';
import { buildProspectingBrowserFixture } from '../support/prospecting-browser-fixture';

let fixture: string;
test.beforeAll(async () => { fixture = await buildProspectingBrowserFixture('tests/fixtures/prospecting-sample-quote.fixture.tsx'); });

async function openFixture(page: Page, query = '') {
  await page.route('https://sample-quote.test/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
  await page.goto(`https://sample-quote.test/admin/sales/prospecting/sample-order/sample-order-1/quote?${query}`);
  await expect(page.getByRole('heading', { name: 'Sample tracking & pricing', exact: true })).toBeVisible();
  await expect(page.getByLabel('Tracking number', { exact: true })).toBeEnabled();
}

async function bulkQuote(page: Page) {
  await page.getByLabel('Tracking number', { exact: true }).fill('1Z0751H30305695303');
  const boxes = page.getByRole('checkbox');
  for (let index = 1; index < await boxes.count(); index++) await boxes.nth(index).uncheck();
  await page.getByRole('spinbutton').first().fill('35.00');
}

async function calls(page: Page) { return page.evaluate(() => window.sampleQuoteFixture.calls); }

test('requires tracking, previews only the selected custom quote, and fits the screen', async ({ page }) => {
  await openFixture(page);
  await expect(page.getByRole('button', { name: 'Send samples & pricing email', exact: true })).toBeDisabled();
  expect(await page.getByRole('checkbox', { checked: true }).count()).toBe(11);
  await bulkQuote(page);
  const preview = page.getByRole('region', { name: 'Email preview', exact: true });
  await expect(preview).toContainText('$35.00 per bag ($7.00/lb)');
  await expect(preview).toContainText('Haskins <haskins@sobrew.com>');
  await expect(preview).toContainText('Ron Smith <ron@example.test>');
  await expect(preview).toContainText('1Z0751H30305695303');
  await expect(preview).not.toContainText('Fraction Pack');
  await expect(preview).not.toContainText('Decaf Dark Roast');
  await expect(preview).not.toContainText('K Cups');
  await expect(page.getByRole('button', { name: 'Send samples & pricing email', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await calls(page)).toHaveLength(0);
});

test('restores an unsent quote after reload and keeps it when finishing later', async ({ page }) => {
  await openFixture(page);
  await bulkQuote(page);
  page.on('dialog', dialog => dialog.accept());
  await page.reload();
  await expect(page.getByText('Your tracking and pricing draft was restored.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Tracking number', { exact: true })).toHaveValue('1Z0751H30305695303');
  await expect(page.getByRole('spinbutton').first()).toHaveValue('35.00');
  expect(await page.getByRole('checkbox', { checked: true }).count()).toBe(1);
  await page.getByRole('link', { name: 'Finish later', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Keep this email draft for later?');
  await page.getByRole('button', { name: 'Keep draft and leave', exact: true }).click();
  expect(await page.evaluate(() => window.prospectingFixture.navigation)).toContain('request_view=orders');
  expect(await page.evaluate(() => sessionStorage.getItem('prospecting-sample-quote-v1:sample-order-1'))).toContain('35.00');
  expect(await calls(page)).toHaveLength(0);
});

test('freezes an uncertain send and retries the identical payload', async ({ page }) => {
  await openFixture(page, 'mode=connection');
  await bulkQuote(page);
  await page.getByRole('button', { name: 'Send samples & pricing email', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('response was interrupted');
  await expect(page.getByRole('alert')).toBeFocused();
  await expect(page.getByLabel('Tracking number', { exact: true })).toBeDisabled();
  await expect(page.getByRole('spinbutton').first()).toBeDisabled();
  await expect(page.getByRole('checkbox').first()).toBeDisabled();
  const original = (await calls(page))[0];
  await page.evaluate(() => { window.sampleQuoteFixture.mode = 'success'; });
  await page.getByRole('button', { name: 'Check / retry email send', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Samples and pricing email sent', exact: true })).toBeVisible();
  expect(await calls(page)).toEqual([original, original]);
  await expect(page.getByRole('status')).toBeFocused();
  expect(await page.evaluate(() => sessionStorage.getItem('prospecting-sample-quote-v1:sample-order-1'))).toBeNull();
});

test('blocks duplicate sends during a pending request and after success', async ({ page }) => {
  await openFixture(page, 'mode=deferred');
  await bulkQuote(page);
  await page.locator('form').evaluate(form => {
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole('button', { name: 'Sending email…', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Tracking number', { exact: true })).toBeDisabled();
  expect(await calls(page)).toEqual([{ orderId: 'sample-order-1', trackingNumber: '1Z0751H30305695303', lines: [{ id: 'bulk-regular', priceCents: 3500 }] }]);
  await page.evaluate(() => window.sampleQuoteFixture.complete?.());
  await expect(page.getByRole('heading', { name: 'Samples and pricing email sent', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Send samples & pricing email', exact: true })).toHaveCount(0);
  await page.locator('form').evaluate(form => form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true })));
  expect(await calls(page)).toHaveLength(1);
});
