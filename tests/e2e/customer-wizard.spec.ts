import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { buildCustomerWizardBrowserFixture } from '../support/customer-wizard-browser-fixture';

let fixture: string;
// PLAYWRIGHT_BASE_URL=https://customer-wizard.test disables the app server.
// The fixture prevents every native POST; all other traffic is intercepted.
test.beforeAll(async () => { fixture = await buildCustomerWizardBrowserFixture(); });

async function openFixture(page: Page, catalog = false) {
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === 'https://customer-wizard.test' && route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: fixture });
    }
    return route.abort('blockedbyclient');
  });
  await page.goto(`https://customer-wizard.test/admin/users/new${catalog ? '?catalog=1' : ''}`);
  await expect(page.getByRole('heading', { name: 'Step 1: Create center + first login', exact: true })).toBeVisible();
}

test('organizes pack sizes and preserves filtered selections and prices through customer creation', async ({ page }, testInfo) => {
  await openFixture(page, true);
  await fillLogin(page);
  await fillInvoiceEmail(page);
  await fillAddress(page);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const fractionCategory = page.getByRole('button', { name: /^Fraction Packs/ });
  await expect(fractionCategory).toHaveAttribute('aria-expanded', 'false');
  await fractionCategory.click();
  await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption('fraction_packs');
  await page.getByRole('combobox', { name: 'Roast', exact: true }).selectOption({ label: 'Medium Roast' });
  const packNames = [
    'Meeting Medium Roast Fraction Pack 100 x 1.5 oz',
    'Meeting Medium Roast Fraction Pack 100 x 1.5 oz with Filters',
    'Meeting Medium Roast Fraction Pack 100 x 2 oz',
  ];
  await expect(page.locator('[id^="assign-category-"] input[type="checkbox"]:visible')).toHaveCount(3);
  expect(await page.locator('[id^="assign-category-"] input[type="checkbox"]:visible').evaluateAll((inputs) => inputs.map((input) => input.getAttribute('aria-label')))).toEqual(packNames);
  await page.getByRole('checkbox', { name: packNames[0], exact: true }).check();
  await page.getByRole('checkbox', { name: packNames[2], exact: true }).check();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search products', exact: true }).fill('DARK-FILTER');
  await page.getByRole('checkbox', { name: 'Meeting Dark Roast Filter Pack 40 x 1.5 oz', exact: true }).check();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Selected only (3)', exact: true }).check();
  await expect(page.locator('[id^="assign-category-"] input[type="checkbox"]:visible')).toHaveCount(3);
  await expect(page.getByRole('button', { name: /^Fraction Packs/ })).toContainText('2 selected');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const audit = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(audit.violations.filter((issue) => issue.impact === 'serious' || issue.impact === 'critical')).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('customer-catalog-selection.png'), fullPage: true });

  await page.getByRole('button', { name: 'Next', exact: true }).click();
  expect(await page.getByRole('spinbutton').evaluateAll((inputs) => inputs.map((input) => input.getAttribute('name')))).toEqual(['price_medium-1-5', 'price_medium-2', 'price_dark-filter']);
  await page.getByRole('spinbutton', { name: `Price ($) for ${packNames[0]}`, exact: true }).fill('100.25');
  await page.getByRole('spinbutton', { name: `Price ($) for ${packNames[2]}`, exact: true }).fill('125.00');
  await page.getByRole('spinbutton', { name: 'Price ($) for Meeting Dark Roast Filter Pack 40 x 1.5 oz', exact: true }).fill('42.50');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: /^Fraction Packs/ }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: `Price ($) for ${packNames[0]}`, exact: true })).toHaveValue('100.25');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('listitem')).toHaveCount(3);
  await expect(page.getByRole('listitem').nth(0)).toContainText(packNames[0]);
  await expect(page.getByRole('listitem').nth(0)).toContainText('$100.25');
  await expect(page.getByRole('listitem').nth(2)).toContainText('Meeting Dark Roast Filter Pack 40 x 1.5 oz');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('customer-catalog-review.png'), fullPage: true });
  await page.getByRole('button', { name: 'Create customer & send welcome', exact: true }).click();
  expect(await page.evaluate(() => window.customerWizardFixture.submissions)).toEqual([expect.objectContaining({
    selected_json: '["medium-1-5","medium-2","dark-filter"]',
    'price_medium-1-5': '100.25',
    'price_medium-2': '125.00',
    'price_dark-filter': '42.50',
  })]);
});

async function fillLogin(page: Page) {
  await page.getByRole('textbox', { name: 'Center name', exact: true }).fill('New Customer');
  await page.getByRole('textbox', { name: 'First login name', exact: true }).fill('Buyer');
  await page.getByRole('textbox', { name: 'First login email', exact: true }).fill('buyer@example.test');
  await page.getByLabel('Temporary password', { exact: true }).fill('test-password-123');
}

async function fillInvoiceEmail(page: Page) {
  await page.getByRole('textbox', { name: 'Invoice email', exact: true }).fill('billing@example.test');
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

test('preserves an eight-character password including its surrounding spaces through review and submission', async ({ page }) => {
  await openFixture(page);
  await fillLogin(page);
  await fillInvoiceEmail(page);
  await fillAddress(page);
  const password = ' abcdef ';
  await page.getByLabel('Temporary password', { exact: true }).fill(password);
  await advanceToReview(page);
  await page.getByRole('button', { name: 'Create customer & send welcome', exact: true }).click();
  const submissions = await page.evaluate(() => window.customerWizardFixture.submissions);
  expect(submissions).toHaveLength(1);
  expect(submissions[0].password).toBe(password);
});

test('requires a complete address, preserves input, and shows billing/delivery details on review', async ({ page }, testInfo) => {
  await openFixture(page);
  await fillLogin(page);
  await fillInvoiceEmail(page);
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
  await expect(page.getByText('QuickBooks invoices will use this address.', { exact: true })).toBeVisible();
  await expect(page.getByText('billing@example.test', { exact: true })).toBeVisible();
  await expect(page.getByText('buyer@example.test', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('customer-review.png'), fullPage: true });
});

test('locks customer creation immediately and posts the complete address only once', async ({ page }) => {
  await openFixture(page);
  await fillLogin(page);
  await fillAddress(page);
  await fillInvoiceEmail(page);
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
  expect(submissions[0]).toMatchObject({ center_name: 'New Customer', login_email: 'buyer@example.test', billing_email: 'billing@example.test', billing_email_cc: '', address1: '105 Johnson Dr', address2: 'Suite 2', city: 'Somerville', state: 'TN', zip: '38068', selected_json: '[]' });
  // Simulate restoring a native POST form from the browser's back/forward cache.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.getByRole('button', { name: 'Create customer & send welcome', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Create customer & send welcome', exact: true }).click();
  expect(await page.evaluate(() => window.customerWizardFixture.submissions.length)).toBe(2);
});

test('validates optional invoice CC emails and keeps them through review and submission', async ({ page }, testInfo) => {
  await openFixture(page);
  await fillLogin(page);
  await fillAddress(page);
  await fillInvoiceEmail(page);
  const cc = page.getByRole('textbox', { name: 'Invoice CC emails (optional)', exact: true });
  await cc.fill('accounting@example.test, invalid-email');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid billing CC email address');
  await expect(cc).toHaveValue('accounting@example.test, invalid-email');
  expect(await page.evaluate(() => window.customerWizardFixture.submissions)).toEqual([]);

  const enteredCc = ' Accounting@Example.test; manager@example.test\nACCOUNTING@example.test ';
  await cc.fill(enteredCc);
  await advanceToReview(page);
  await expect(page.getByText('accounting@example.test, manager@example.test', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('customer-cc-review.png'), fullPage: true });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(cc).toHaveValue(enteredCc);
  const audit = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(audit.violations.filter((issue) => issue.impact === 'serious' || issue.impact === 'critical')).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('customer-cc-input.png'), fullPage: true });
  await advanceToReview(page);
  await page.getByRole('button', { name: 'Create customer & send welcome', exact: true }).click();
  const submissions = await page.evaluate(() => window.customerWizardFixture.submissions);
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({ billing_email: 'billing@example.test', billing_email_cc: enteredCc, login_email: 'buyer@example.test' });
});

test('requires an explicit invoice email independently of the login and preserves it through review', async ({ page }) => {
  await openFixture(page);
  await fillLogin(page);
  await fillAddress(page);
  const invoiceEmail = page.getByRole('textbox', { name: 'Invoice email', exact: true });
  await expect(invoiceEmail).toHaveValue('');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Step 1: Create center + first login', exact: true })).toBeVisible();
  expect(await invoiceEmail.evaluate((element) => (element as HTMLInputElement).validity.valueMissing)).toBe(true);

  await invoiceEmail.fill('invalid-email');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  expect(await invoiceEmail.evaluate((element) => (element as HTMLInputElement).validity.typeMismatch)).toBe(true);
  await invoiceEmail.fill('billing@local');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => window.customerWizardFixture.submissions)).toEqual([]);

  await invoiceEmail.fill('Billing@Example.test');
  await page.getByRole('textbox', { name: 'First login email', exact: true }).fill('other-buyer@example.test');
  await expect(invoiceEmail).toHaveValue('Billing@Example.test');
  await advanceToReview(page);
  await expect(page.getByText('billing@example.test', { exact: true })).toBeVisible();
  await expect(page.getByText('other-buyer@example.test', { exact: true })).toBeVisible();
  await expect(page.getByText('No CC recipients.', { exact: true })).toBeVisible();
  for (let step = 0; step < 3; step += 1) await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(invoiceEmail).toHaveValue('Billing@Example.test');
  await advanceToReview(page);
  await page.getByRole('button', { name: 'Create customer & send welcome', exact: true }).click();
  expect(await page.evaluate(() => window.customerWizardFixture.submissions)).toEqual([
    expect.objectContaining({ billing_email: 'Billing@Example.test', login_email: 'other-buyer@example.test', billing_email_cc: '' }),
  ]);
});
