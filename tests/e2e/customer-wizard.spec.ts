import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { buildCustomerWizardBrowserFixture } from '../support/customer-wizard-browser-fixture';

let fixture: string;
// PLAYWRIGHT_BASE_URL=https://customer-wizard.test disables the app server.
// The fixture prevents every native POST; all other traffic is intercepted.
test.beforeAll(async () => { fixture = await buildCustomerWizardBrowserFixture(); });

async function openFixture(page: Page) {
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === 'https://customer-wizard.test' && route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: fixture });
    }
    return route.abort('blockedbyclient');
  });
  await page.goto('https://customer-wizard.test/admin/users/new');
  await expect(page.getByRole('heading', { name: 'Step 1: Create center + first login', exact: true })).toBeVisible();
}

async function fillLogin(page: Page) {
  await page.getByRole('textbox', { name: 'Center name', exact: true }).fill('New Customer');
  await page.getByRole('textbox', { name: 'First login name', exact: true }).fill('Buyer');
  await page.getByRole('textbox', { name: 'First login email', exact: true }).fill('buyer@example.test');
  await page.getByLabel('Temporary password', { exact: true }).fill('test-password-123');
}

async function fillAddress(page: Page) {
  await page.getByRole('textbox', { name: /^Street address/ }).fill('105 Johnson Dr');
  await page.getByRole('textbox', { name: /^Apartment, suite, or building/ }).fill('Suite 2');
  await page.getByRole('textbox', { name: /^City/ }).fill('Somerville');
  await page.getByRole('combobox', { name: /^State/ }).selectOption('TN');
  await page.getByRole('textbox', { name: /^ZIP code/ }).fill('38068');
}

async function advanceToReview(page: Page) {
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Step 2: Assign products', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Step 3: Set prices', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Step 4: Review & Create', exact: true })).toBeVisible();
}

test('requires a complete address, preserves input, and shows billing/delivery details on review', async ({ page }, testInfo) => {
  await openFixture(page);
  await fillLogin(page);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Step 1: Create center + first login', exact: true })).toBeVisible();
  expect(await page.getByRole('textbox', { name: /^Street address/ }).evaluate((element) => (element as HTMLInputElement).validity.valueMissing)).toBe(true);
  await fillAddress(page);
  await page.getByRole('textbox', { name: /^ZIP code/ }).fill('123');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  expect(await page.getByRole('textbox', { name: /^ZIP code/ }).evaluate((element) => (element as HTMLInputElement).validity.patternMismatch)).toBe(true);
  await page.getByRole('textbox', { name: /^ZIP code/ }).fill('38068');
  await page.getByRole('textbox', { name: /^Street address/ }).fill('   ');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Enter the street address, city, state, and ZIP code');
  await expect(page.getByRole('textbox', { name: 'First login email', exact: true })).toHaveValue('buyer@example.test');
  await page.getByRole('textbox', { name: /^Street address/ }).fill('105 Johnson Dr');
  expect(await page.evaluate(() => window.customerWizardFixture.submissions)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const addressAudit = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(addressAudit.violations.filter((issue) => issue.impact === 'serious' || issue.impact === 'critical')).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('customer-address.png'), fullPage: true });
  await advanceToReview(page);
  await expect(page.locator('address')).toContainText('105 Johnson Dr');
  await expect(page.locator('address')).toContainText('Suite 2');
  await expect(page.locator('address')).toContainText('Somerville, TN 38068');
  await expect(page.getByText('Blank order guide. Products can be added later.', { exact: true })).toBeVisible();
  await expect(page.getByText('QuickBooks invoices will use this address and buyer@example.test.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('customer-review.png'), fullPage: true });
});

test('locks customer creation immediately and posts the complete address only once', async ({ page }) => {
  await openFixture(page);
  await fillLogin(page);
  await fillAddress(page);
  await advanceToReview(page);
  await page.getByRole('button', { name: 'Create customer & send welcome', exact: true }).dblclick();
  await expect(page.getByRole('button', { name: 'Creating & linking customer…', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
  await page.locator('form').evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
    (form as HTMLFormElement).requestSubmit();
  });
  const submissions = await page.evaluate(() => window.customerWizardFixture.submissions);
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({ center_name: 'New Customer', login_email: 'buyer@example.test', address1: '105 Johnson Dr', address2: 'Suite 2', city: 'Somerville', state: 'TN', zip: '38068', selected_json: '[]' });
  // Simulate restoring a native POST form from the browser's back/forward cache.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.getByRole('button', { name: 'Create customer & send welcome', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Create customer & send welcome', exact: true }).click();
  expect(await page.evaluate(() => window.customerWizardFixture.submissions.length)).toBe(2);
});
