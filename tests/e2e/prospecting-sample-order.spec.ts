import { expect, test, type Page } from '@playwright/test';
import { buildProspectingBrowserFixture } from '../support/prospecting-browser-fixture';

let fixture: string;
test.beforeAll(async () => { fixture = await buildProspectingBrowserFixture('tests/fixtures/prospecting-sample-order.fixture.tsx'); });
async function openFixture(page: Page, query = '') {
  await page.route('https://sample-order.test/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
  await page.goto(`https://sample-order.test/admin/sales/prospecting/sample-order?${query}`);
  await expect(page.getByRole('button', { name: query ? 'Create sample order' : 'Save order & continue', exact: true })).toBeEnabled();
}

test('fulfilling a linked sample request automatically opens tracking and pricing', async ({ page }) => {
  await openFixture(page);
  await page.getByRole('button', { name: 'Save order & continue', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.prospectingFixture.navigation)).toBe('/admin/sales/prospecting/sample-order/sample-order-1/quote?back=%2Fadmin%2Fsales%2Fprospecting%2Fadmin%3Ftab%3Drequests%26sample_page%3D3');
  expect(await page.evaluate(() => window.sampleOrderFixture.calls)).toBe(1);
  expect(await page.evaluate(() => window.prospectingFixture.navigationCalls.length)).toBe(1);
});

test('standalone shipments retain order confirmation without a prospect quote', async ({ page }) => {
  await openFixture(page, 'standalone=1');
  await page.getByRole('button', { name: 'Create sample order', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sample order created', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.prospectingFixture.navigation)).toBe('');
  await expect(page.getByRole('link', { name: 'Continue to tracking & pricing', exact: true })).toHaveCount(0);
});
