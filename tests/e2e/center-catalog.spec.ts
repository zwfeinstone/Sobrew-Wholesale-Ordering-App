import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { buildCenterCatalogBrowserFixture, CENTER_CATALOG_FIXTURE_PRODUCTS } from '../support/center-catalog-browser-fixture';

let fixture: string;
// PLAYWRIGHT_BASE_URL=https://center-catalog.test disables the app server.
// Every request is intercepted and the React action only captures FormData.
test.beforeAll(async () => { fixture = await buildCenterCatalogBrowserFixture(); });

async function openFixture(page: Page) {
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === 'https://center-catalog.test' && route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: fixture });
    }
    return route.abort('blockedbyclient');
  });
  await page.goto('https://center-catalog.test/admin/users/fixture-center');
  await expect(page.getByRole('heading', { name: /Catalog & pricing/ })).toBeVisible();
}

function categoryGroup(page: Page, name: string) {
  return page.locator('details').filter({ has: page.locator('summary').filter({ hasText: new RegExp(`^${name}`) }) });
}

function productName(id: string) {
  const product = CENTER_CATALOG_FIXTURE_PRODUCTS.find(product => product.id === id);
  if (!product) throw new Error(`Unknown fixture product: ${id}`);
  return product.name;
}

function assignment(page: Page, id: string) {
  return page.locator('label').filter({ has: page.locator('strong').filter({ hasText: productName(id) }) }).getByRole('checkbox');
}

test('normalizes category labels and orders roasts, numeric pack sizes, case counts, and variants', async ({ page }, testInfo) => {
  await openFixture(page);
  await expect(categoryGroup(page, 'Fraction Packs').locator('summary')).toContainText('3 selected');
  await expect(categoryGroup(page, 'Filter Packs').locator('summary')).toContainText('1 selected');
  await expect(categoryGroup(page, 'K-Cups').locator('summary')).toContainText('1 selected');
  await page.getByRole('combobox', { name: 'Product category', exact: true }).selectOption('fraction_packs');
  const fraction = categoryGroup(page, 'Fraction Packs');
  await expect(fraction.getByRole('heading', { level: 3 })).toHaveText(['Medium Roast', 'Dark Roast', 'Decaf']);
  const medium = fraction.getByRole('region', { name: 'Medium Roast', exact: true });
  await expect(medium.locator('strong')).toHaveText([
    productName('medium-1-5-72'),
    productName('medium-1-5-100'),
    productName('medium-1-5-filters'),
    productName('medium-2'),
    productName('medium-sku'),
    productName('medium-10'),
  ]);
  await expect(medium.getByText('2.5 oz per pack', { exact: true })).toBeVisible();
  await expect(medium.getByText('With filters', { exact: true })).toBeVisible();
  await expect(fraction.getByRole('region', { name: 'Decaf', exact: true }).locator('strong')).toHaveText(productName('decaf'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const audit = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(audit.violations.filter(issue => issue.impact === 'serious' || issue.impact === 'critical')).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('center-catalog-organized.png'), fullPage: true });
});

test('submits every assigned product and price when filters and collapsed categories hide rows', async ({ page }) => {
  await openFixture(page);
  await page.getByRole('spinbutton', { name: `Price for ${productName('medium-2')}`, exact: true }).fill('125.75');
  await page.getByRole('combobox', { name: 'Product category', exact: true }).selectOption('filter_packs');
  await page.getByRole('combobox', { name: 'Pack roast', exact: true }).selectOption('Dark Roast');
  await expect(page.locator('strong:visible')).toHaveText([productName('filter-dark')]);
  await categoryGroup(page, 'Filter Packs').locator('summary').click();
  await expect(categoryGroup(page, 'Filter Packs')).not.toHaveAttribute('open', '');
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save pricing', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.centerCatalogFixture.submissions.length)).toBe(1);
  const [submission] = await page.evaluate(() => window.centerCatalogFixture.submissions);
  expect(submission.filter(([key]) => key === 'product_id').map(([, value]) => value).sort()).toEqual(['dark-2', 'filter-dark', 'k-cups', 'medium-1-5-72', 'medium-2'].sort());
  expect(Object.fromEntries(submission)).toMatchObject({
    center_id: 'fixture-center',
    'price_medium-1-5-72': '88.00',
    'price_medium-2': '125.75',
    'price_dark-2': '120.00',
    'price_filter-dark': '0.00',
    'complimentary_filter-dark': 'on',
    'price_k-cups': '42.00',
  });
  expect(submission.filter(([key]) => key.startsWith('price_'))).toHaveLength(5);
});

test('retains assignment changes, resolves zero-price review with complimentary approval, and clears empty filters', async ({ page }, testInfo) => {
  await openFixture(page);
  await page.getByRole('combobox', { name: 'Product category', exact: true }).selectOption('fraction_packs');
  await page.getByRole('combobox', { name: 'Pack roast', exact: true }).selectOption('Medium Roast');
  await assignment(page, 'medium-1-5-72').uncheck();
  // The exact-name row excludes the otherwise similarly named With filters variant.
  const newProduct = page.locator('strong').filter({ hasText: new RegExp(`^${productName('medium-1-5-100').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).locator('..').locator('..');
  await newProduct.getByRole('checkbox').check();
  await page.getByRole('spinbutton', { name: `Price for ${productName('medium-1-5-100')}`, exact: true }).fill('0');
  await page.getByRole('combobox', { name: 'Product visibility', exact: true }).selectOption('review');
  await expect(page.locator('strong:visible')).toHaveText([productName('medium-1-5-100')]);
  await expect(page.getByRole('status').filter({ hasText: 'assigned products need a price' })).toBeVisible();
  // Resolving this row removes it from Needs pricing immediately; assert the resulting view and saved value.
  await page.getByRole('checkbox', { name: `Complimentary ${productName('medium-1-5-100')}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No products found', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).first().click();
  await page.getByRole('combobox', { name: 'Product visibility', exact: true }).selectOption('assigned');
  await expect(page.locator('strong:visible')).toHaveCount(5);
  await expect(page.getByRole('spinbutton', { name: `Price for ${productName('medium-1-5-100')}`, exact: true })).toHaveValue('0');
  await page.getByRole('textbox', { name: 'Search customer products', exact: true }).fill('no matching product');
  await expect(page.getByRole('heading', { name: 'No products found', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: 'Search customer products', exact: true })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Product visibility', exact: true })).toHaveValue('all');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('center-catalog-pricing.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save pricing', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.centerCatalogFixture.submissions.length)).toBe(1);
  const [submission] = await page.evaluate(() => window.centerCatalogFixture.submissions);
  const ids = submission.filter(([key]) => key === 'product_id').map(([, value]) => value);
  expect(ids).toHaveLength(5);
  expect(ids).toContain('medium-1-5-100');
  expect(ids).not.toContain('medium-1-5-72');
  expect(Object.fromEntries(submission)).toMatchObject({ 'price_medium-1-5-100': '0', 'complimentary_medium-1-5-100': 'on' });
  expect(submission.some(([key]) => key === 'price_medium-1-5-72')).toBe(false);
});
