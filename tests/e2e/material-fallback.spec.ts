import { writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { buildMaterialFallbackBrowserFixture } from '../support/material-fallback-browser-fixture';

let fixture: string;
// Set PLAYWRIGHT_BASE_URL=https://material-fallback.test to disable the app server.
// Every request is intercepted; the fixture never calls the application or database.
test.beforeAll(async () => {
  fixture = await buildMaterialFallbackBrowserFixture();
  await writeFile('/private/tmp/sobrew-material-fallback-fixture.html', fixture);
});

async function openFixture(page: Page, query = '') {
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === 'https://material-fallback.test' && route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: fixture });
    }
    return route.abort('blockedbyclient');
  });
  await page.goto(`https://material-fallback.test/?${query}`);
  await expect(page.getByRole('heading', { name: /^(Fraction|Filter)-pack packaging$/ })).toBeVisible();
  await page.getByText('Material quantities for this run', { exact: true }).click();
}

function material(page: Page, name: string) {
  return page.locator('details li').filter({ has: page.getByText(name, { exact: true }) });
}

test('regular cases split bags and recompute shortages when production quantity changes', async ({ page }, testInfo) => {
  await openFixture(page);
  await expect(material(page, 'Roll Stock Fraction Pack Bag')).toContainText('Need 60 each');
  await expect(material(page, 'Fraction Pack Bag')).toContainText('Need 40 each');
  await page.getByRole('spinbutton', { name: 'Actually made' }).fill('2');
  await expect(material(page, 'Fraction Pack Bag')).toContainText('Need 140 each');
  await page.getByRole('spinbutton', { name: 'Actually made' }).fill('3');
  await expect(material(page, 'Fraction Pack Bag')).toContainText('Short 40 each');
  await expect(page.getByText('Materials are short for 3 units.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Record completed production' }).click();
  await expect(page.getByRole('status')).toContainText('Simulated run rejected');
  expect(await page.evaluate(() => window.materialFallbackFixture.submissions)).toEqual([expect.objectContaining({ product: 'regular', quantity: 3, recorded: false })]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('regular-fallback-shortage.png'), fullPage: true });
});

test('sample boxes use two six-ounce fallback bags and preserve the carton alternative', async ({ page }, testInfo) => {
  await openFixture(page, 'product=sample&scenario=depleted');
  await expect(material(page, '6 oz Fraction Pack Bag')).toContainText('Need 2 each');
  await expect(material(page, 'Fraction Pack Bag')).toHaveCount(0);
  await expect(material(page, 'Sample Box 12 × 6 × 4')).toContainText('Need 1 each');
  await page.getByRole('spinbutton', { name: 'Actually made' }).fill('2');
  await expect(material(page, '6 oz Fraction Pack Bag')).toContainText('Need 4 each');
  await page.getByRole('button', { name: 'Record completed production' }).click();
  await expect(page.getByRole('status')).toContainText('Simulated run accepted: 2 sample boxes.');
  expect(await page.evaluate(() => window.materialFallbackFixture.submissions[0].materials)).toContainEqual({ id: 'six-ounce-bag', quantity: 4 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('sample-six-ounce-fallback.png'), fullPage: true });
});

test('filter packs use 40 whole bags per case, preferring roll stock before older bags', async ({ page }, testInfo) => {
  await openFixture(page, 'product=filter_pack&scenario=covered');
  const primaryStock = page.getByRole('spinbutton', { name: 'Roll-stock bags on hand' });
  const quantity = page.getByRole('spinbutton', { name: 'Actually made' });
  const record = page.getByRole('button', { name: 'Record completed production' });
  await expect(primaryStock).toHaveValue('5882');
  await expect(material(page, 'Filter Pack Bag - Roll Stock')).toContainText('Need 40 each');
  await expect(material(page, 'Filter Pack Bag')).toHaveCount(0);

  await primaryStock.fill('20');
  await expect(material(page, 'Filter Pack Bag - Roll Stock')).toContainText('Need 20 each');
  await expect(material(page, 'Filter Pack Bag')).toContainText('Need 20 each');
  // Fractional stock cannot substitute for another whole filter pack bag.
  await primaryStock.fill('20.9999');
  await expect(material(page, 'Filter Pack Bag - Roll Stock')).toContainText('Need 20 each');
  await expect(material(page, 'Filter Pack Bag')).toContainText('Need 20 each');

  await primaryStock.fill('0');
  await expect(material(page, 'Filter Pack Bag - Roll Stock')).toHaveCount(0);
  await expect(material(page, 'Filter Pack Bag')).toContainText('Need 40 each');
  await quantity.fill('1.5');
  await expect(record).toBeDisabled();
  expect(await page.evaluate(() => window.materialFallbackFixture.submissions)).toEqual([]);
  await quantity.fill('2');
  await page.getByText('Material quantities for this run', { exact: true }).click();
  await expect(material(page, 'Filter Pack Bag')).toContainText('Need 80 each');
  await record.click();
  await expect(page.getByRole('status')).toContainText('Simulated run accepted: 2 cases.');
  expect(await page.evaluate(() => window.materialFallbackFixture.submissions)).toEqual([
    expect.objectContaining({ product: 'filter_pack', quantity: 2, recorded: true, materials: expect.arrayContaining([{ id: 'filter-bag', quantity: 80 }]) }),
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('filter-pack-fallback.png'), fullPage: true });
});

test('stock controls cover primary-only, mixed, depleted, shortage, and inactive fallback states', async ({ page }) => {
  await openFixture(page, 'scenario=covered');
  await expect(material(page, 'Roll Stock Fraction Pack Bag')).toContainText('Need 100 each');
  await expect(material(page, 'Fraction Pack Bag')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Stock scenario' }).selectOption('mixed');
  await page.getByText('Material quantities for this run', { exact: true }).click();
  await expect(material(page, 'Fraction Pack Bag')).toContainText('Need 40 each');
  await page.getByRole('combobox', { name: 'Stock scenario' }).selectOption('depleted');
  await page.getByText('Material quantities for this run', { exact: true }).click();
  await expect(material(page, 'Fraction Pack Bag')).toContainText('Need 100 each');
  await page.getByRole('spinbutton', { name: 'Fallback bags on hand' }).fill('0');
  await expect(material(page, 'Fraction Pack Bag')).toContainText('Short 100 each');
  await page.getByRole('checkbox', { name: 'Fallback material is active' }).uncheck();
  await expect(page.getByText('Material estimate unavailable. Check the recipe and its units.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record completed production' })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Stock scenario' }).selectOption('short');
  await page.getByText('Material quantities for this run', { exact: true }).click();
  await expect(material(page, 'Fraction Pack Bag')).toContainText('Short 50 each');
});

test('renders the real form responsively without serious accessibility violations', async ({ page }, testInfo) => {
  await openFixture(page, 'product=sample&scenario=mixed');
  await expect(material(page, 'Roll Stock Fraction Pack Bag')).toContainText('Need 1 each');
  await expect(material(page, '6 oz Fraction Pack Bag')).toContainText('Need 1 each');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const audit = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(audit.violations.filter((issue) => issue.impact === 'serious' || issue.impact === 'critical')).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('sample-mixed-fallback.png'), fullPage: true });
});
