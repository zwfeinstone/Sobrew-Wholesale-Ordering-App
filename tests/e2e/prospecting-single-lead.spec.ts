import { expect, test, type Page } from '@playwright/test';
import { buildProspectingBrowserFixture } from '../support/prospecting-browser-fixture';

let fixture: string;
// Every request is intercepted. PLAYWRIGHT_BASE_URL disables the application server.
test.beforeAll(async () => { fixture = await buildProspectingBrowserFixture('tests/fixtures/prospecting-single-lead.fixture.tsx'); });

async function openFixture(page: Page, query = '') {
  await page.route('https://single-lead.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
  await page.goto(`https://single-lead.test/admin/sales/prospecting/admin?tab=add&${query}`);
  await expect(page.getByRole('heading', { name: 'Add one prospect', exact: true })).toBeVisible();
}

async function fillLead(page: Page) {
  await page.getByLabel('Company name', { exact: true }).fill('Lakeview Recovery');
  await page.getByLabel('Phone', { exact: true }).fill('312-555-0101');
  await page.getByLabel('Contact name', { exact: true }).fill('Taylor Buyer');
  await page.getByLabel('Contact email', { exact: true }).fill('taylor@example.test');
  await page.getByRole('combobox', { name: 'Assigned rep', exact: true }).selectOption('rep-1');
  await page.getByRole('combobox', { name: 'Stage', exact: true }).selectOption('sample_requested');
  await page.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('high');
  await page.getByRole('combobox', { name: 'Or add to existing list', exact: true }).selectOption('list-1');
  await page.getByLabel('Notes', { exact: true }).fill('Keep this prospect and the requested samples.');
}

async function calls(page: Page) { return page.evaluate(() => window.singleLeadFixture.calls); }

test('requires a sample contact before submitting and preserves the entered company', async ({ page }) => {
  await openFixture(page);
  await page.getByLabel('Company name', { exact: true }).fill('Lakeview Recovery');
  await page.getByRole('combobox', { name: 'Stage', exact: true }).selectOption('sample_requested');
  await page.getByLabel('Contact email', { exact: true }).fill('taylor@example.test');
  await page.getByRole('button', { name: 'Add Lead', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('contact name and valid email');
  await expect(page.getByRole('alert')).toBeFocused();
  expect(await calls(page)).toHaveLength(0);
  await expect(page.getByLabel('Company name', { exact: true })).toHaveValue('Lakeview Recovery');
  await expect(page.getByRole('button', { name: 'Add Lead', exact: true })).toBeEnabled();
});

for (const [mode, message] of [['validation', 'eligible assigned rep'], ['connection', 'connection was interrupted']] as const) {
  test(`preserves the complete form after ${mode} failure`, async ({ page }) => {
    await openFixture(page, `mode=${mode}`);
    await fillLead(page);
    const before = await page.locator('form').evaluate((form) => Object.fromEntries(new FormData(form as HTMLFormElement).entries()));
    await page.getByRole('button', { name: 'Add Lead', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(message);
    await expect(page.getByRole('button', { name: 'Add Lead', exact: true })).toBeEnabled();
    expect(await page.locator('form').evaluate((form) => Object.fromEntries(new FormData(form as HTMLFormElement).entries()))).toEqual(before);
    expect(await calls(page)).toHaveLength(1);
    await expect(page.getByRole('link', { name: 'Check lead list (opens a new tab)', exact: true })).toHaveAttribute('target', '_blank');
  });
}

test('links partial saves to the saved record while keeping entered details', async ({ page }) => {
  await openFixture(page, 'mode=partial');
  await fillLead(page);
  await page.getByRole('button', { name: 'Add Lead', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('lead was saved');
  await expect(page.getByRole('link', { name: 'Review saved lead (opens a new tab)', exact: true })).toHaveAttribute('href', '/admin/sales/prospecting/00000000-0000-4000-8000-000000000001');
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue('Keep this prospect and the requested samples.');
});

test('guards duplicate submissions and completes without navigation before starting a fresh form', async ({ page }) => {
  await openFixture(page, 'mode=deferred');
  await fillLead(page);
  const originalUrl = page.url();
  await page.locator('form').evaluate((form) => {
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole('button', { name: 'Adding…', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Company name', { exact: true })).toBeDisabled();
  expect(await calls(page)).toHaveLength(1);
  expect((await calls(page))[0]).toMatchObject({ company_name: 'Lakeview Recovery', stage: 'sample_requested', contact_full_name: 'Taylor Buyer', contact_email: 'taylor@example.test' });
  await page.evaluate(() => window.singleLeadFixture.complete?.());
  await expect(page.getByRole('heading', { name: 'Lead saved', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toBeFocused();
  expect(page.url()).toBe(originalUrl);
  await expect(page.getByRole('status')).toContainText('choose the sample boxes and review the delivery details');
  await expect(page.getByRole('link', { name: 'Create sample order', exact: true })).toHaveAttribute('href', '/admin/sales/prospecting/sample-order?lead=00000000-0000-4000-8000-000000000001');
  await expect(page.getByRole('link', { name: 'View lead', exact: true })).toHaveAttribute('href', '/admin/sales/prospecting/00000000-0000-4000-8000-000000000001');
  await page.getByRole('button', { name: 'Add another lead', exact: true }).click();
  for (const label of ['Company name', 'Phone', 'Contact name', 'Contact email', 'Notes']) await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Country', { exact: true })).toHaveValue('US');
  await expect(page.getByRole('combobox', { name: 'Stage', exact: true })).toHaveValue('new');
  await expect(page.getByRole('combobox', { name: 'Priority', exact: true })).toHaveValue('normal');
  await expect(page.getByRole('button', { name: 'Add Lead', exact: true })).toBeEnabled();
});

test('keeps ordinary leads on the saved lead path without asking for a sample order', async ({ page }) => {
  await openFixture(page);
  await page.getByLabel('Company name', { exact: true }).fill('Lakeview Recovery');
  await page.getByRole('button', { name: 'Add Lead', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lead saved', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View lead', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create sample order', exact: true })).toHaveCount(0);
});

test('shows slow-save guidance and accepts the original late completion without retrying', async ({ page }) => {
  await openFixture(page, 'mode=deferred');
  await page.clock.install();
  await fillLead(page);
  await page.getByRole('button', { name: 'Add Lead', exact: true }).click();
  await page.clock.fastForward(25_001);
  await expect(page.getByRole('status')).toContainText('taking longer than expected');
  await expect(page.getByRole('button', { name: 'Checking save…', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Company name', { exact: true })).toHaveValue('Lakeview Recovery');
  await expect(page.getByRole('link', { name: 'Check lead list (opens a new tab)', exact: true })).toHaveAttribute('target', '_blank');
  await page.locator('form').evaluate((form) => form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true })));
  expect(await calls(page)).toHaveLength(1);
  await page.evaluate(() => window.singleLeadFixture.complete?.());
  await expect(page.getByRole('heading', { name: 'Lead saved', exact: true })).toBeVisible();
  await expect(page.getByText('taking longer than expected', { exact: false })).toHaveCount(0);
  expect(await calls(page)).toHaveLength(1);
});

test('read-only access prevents submission and editing', async ({ page }) => {
  await openFixture(page, 'readonly=1');
  await expect(page.getByRole('button', { name: 'No edit access', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Company name', { exact: true })).toBeDisabled();
  await page.locator('form').evaluate((form) => form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true })));
  expect(await calls(page)).toHaveLength(0);
});
