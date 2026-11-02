import { writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { buildPortalLocationsBrowserFixture } from '../support/portal-locations-browser-fixture';

let fixture: string;
// Set PLAYWRIGHT_BASE_URL=https://portal-locations.test to disable the app server.
// All traffic is intercepted; actions operate only on the fixture's in-memory data.
test.beforeAll(async () => {
  fixture = await buildPortalLocationsBrowserFixture();
  await writeFile('/private/tmp/sobrew-portal-locations-fixture.html', fixture);
});

async function openFixture(page: Page, query = '') {
  await page.route('**/*', (route) => {
    const request = route.request();
    if (new URL(request.url()).origin === 'https://portal-locations.test' && request.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: fixture });
    }
    return route.abort('blockedbyclient');
  });
  await page.goto(`https://portal-locations.test/portal/settings?${query}`);
  await expect(page.getByRole('heading', { name: 'Delivery locations', exact: true })).toBeVisible();
}

function addForm(page: Page) { return page.getByRole('region', { name: 'Add delivery location', exact: true }); }
function savedLocation(page: Page, name = 'Main office') { return page.getByRole('article', { name, exact: true }); }
async function submissions(page: Page) { return page.evaluate(() => window.portalLocationsFixture.submissions); }

async function fillLocation(form: Locator, name = 'Warehouse') {
  await form.getByRole('textbox', { name: 'Location name', exact: true }).fill(name);
  await form.getByRole('textbox', { name: 'Street address', exact: true }).fill('470 Lake Concord Rd NE');
  await form.getByRole('textbox', { name: 'Apartment, suite, etc. (optional)', exact: true }).fill('Building B');
  await form.getByRole('textbox', { name: 'City', exact: true }).fill('Concord');
  await form.getByRole('combobox', { name: 'State', exact: true }).selectOption('NC');
  await form.getByRole('textbox', { name: 'ZIP code', exact: true }).fill('28025-1234');
}

test('adds a complete location, clears the successful draft, and keeps the saved address visible', async ({ page }, testInfo) => {
  await openFixture(page);
  const form = addForm(page);
  await fillLocation(form);
  await form.getByRole('button', { name: 'Add location', exact: true }).click();
  await expect(form.getByRole('status')).toContainText('Delivery location added');
  await expect(form.getByRole('textbox', { name: 'Location name', exact: true })).toHaveValue('');
  await expect(savedLocation(page, 'Warehouse').locator('address')).toContainText('470 Lake Concord Rd NE');
  await expect(savedLocation(page, 'Warehouse').locator('address')).toContainText('Building B');
  await expect(savedLocation(page, 'Warehouse').locator('address')).toContainText('Concord, NC 28025-1234');
  expect(await submissions(page)).toEqual([{ kind: 'add', fields: {
    location_name: 'Warehouse', address1: '470 Lake Concord Rd NE', address2: 'Building B', city: 'Concord', state: 'NC', zip: '28025-1234',
  } }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('portal-location-added.png'), fullPage: true });
});

test('edits an existing location with its stable ID and accepts an empty optional address line', async ({ page }, testInfo) => {
  await openFixture(page);
  const card = savedLocation(page);
  await card.getByText('Edit address', { exact: true }).click();
  await expect(card.getByRole('textbox', { name: 'Street address', exact: true })).toHaveValue('105 Johnson Dr');
  await expect(card.getByRole('textbox', { name: 'Apartment, suite, etc. (optional)', exact: true })).toHaveValue('Suite 2');
  await card.getByRole('textbox', { name: 'Street address', exact: true }).fill('107 Johnson Dr');
  await card.getByRole('textbox', { name: 'Apartment, suite, etc. (optional)', exact: true }).fill('');
  await card.getByRole('button', { name: 'Save address', exact: true }).click();
  await expect(card.getByRole('status')).toHaveText('Delivery address updated.');
  await expect(card.locator('address')).toContainText('107 Johnson Dr');
  await expect(card.locator('address')).not.toContainText('Suite 2');
  await expect(card.getByRole('textbox', { name: 'Street address', exact: true })).toHaveValue('107 Johnson Dr');
  expect(await submissions(page)).toEqual([{ kind: 'edit', fields: {
    location_id: '10000000-0000-4000-8000-000000000001', location_name: 'Main office',
    address1: '107 Johnson Dr', address2: '', city: 'Somerville', state: 'TN', zip: '38068',
  } }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('portal-location-edited.png'), fullPage: true });
});

test('blocks missing fields and invalid ZIP codes before submission and preserves a whitespace validation error', async ({ page }) => {
  await openFixture(page);
  const form = addForm(page);
  await form.getByRole('button', { name: 'Add location', exact: true }).click();
  expect(await form.getByRole('textbox', { name: 'Location name', exact: true }).evaluate(input => (input as HTMLInputElement).validity.valueMissing)).toBe(true);
  expect(await submissions(page)).toHaveLength(0);
  await fillLocation(form);
  await form.getByRole('textbox', { name: 'ZIP code', exact: true }).fill('123');
  await form.getByRole('button', { name: 'Add location', exact: true }).click();
  expect(await form.getByRole('textbox', { name: 'ZIP code', exact: true }).evaluate(input => (input as HTMLInputElement).validity.patternMismatch)).toBe(true);
  expect(await submissions(page)).toHaveLength(0);
  await form.getByRole('textbox', { name: 'ZIP code', exact: true }).fill('28025');
  await form.getByRole('textbox', { name: 'Street address', exact: true }).fill('   ');
  await form.getByRole('button', { name: 'Add location', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('Enter a location name, street address, city, state, and ZIP code.');
  await expect(form.getByRole('textbox', { name: 'Location name', exact: true })).toHaveValue('Warehouse');
  await expect(form.getByRole('textbox', { name: 'Street address', exact: true })).toHaveValue('   ');
  expect(await page.evaluate(() => window.portalLocationsFixture.locations)).toHaveLength(1);
});

for (const mode of ['add', 'edit'] as const) {
  test(`${mode} errors retain every entered value and permit a successful retry`, async ({ page }) => {
    await openFixture(page, 'mode=error');
    const form = mode === 'add' ? addForm(page) : savedLocation(page);
    if (mode === 'edit') await form.getByText('Edit address', { exact: true }).click();
    await fillLocation(form, mode === 'add' ? 'Warehouse' : 'Main office');
    const buttonName = mode === 'add' ? 'Add location' : 'Save address';
    await form.getByRole('button', { name: buttonName, exact: true }).click();
    await expect(form.getByRole('alert')).toContainText('We couldn’t save this location right now. Please try again.');
    await expect(form.getByRole('textbox', { name: 'Street address', exact: true })).toHaveValue('470 Lake Concord Rd NE');
    await expect(form.getByRole('textbox', { name: 'Apartment, suite, etc. (optional)', exact: true })).toHaveValue('Building B');
    await expect(form.getByRole('textbox', { name: 'City', exact: true })).toHaveValue('Concord');
    await expect(form.getByRole('combobox', { name: 'State', exact: true })).toHaveValue('NC');
    await expect(form.getByRole('textbox', { name: 'ZIP code', exact: true })).toHaveValue('28025-1234');
    await expect(form.getByRole('button', { name: buttonName, exact: true })).toBeEnabled();
    expect(await page.evaluate(() => window.portalLocationsFixture.locations[0].address1)).toBe('105 Johnson Dr');
    const [original] = await submissions(page);
    // A second failed attempt must preserve the same draft and unlock another retry.
    await form.getByRole('button', { name: buttonName, exact: true }).click();
    await expect.poll(async () => (await submissions(page)).length).toBe(2);
    await expect(form.getByRole('button', { name: buttonName, exact: true })).toBeEnabled();
    await expect(form.getByRole('alert')).toContainText('We couldn’t save this location right now. Please try again.');
    await expect(form.getByRole('textbox', { name: 'Location name', exact: true })).toHaveValue(mode === 'add' ? 'Warehouse' : 'Main office');
    await expect(form.getByRole('textbox', { name: 'Street address', exact: true })).toHaveValue('470 Lake Concord Rd NE');
    await expect(form.getByRole('textbox', { name: 'Apartment, suite, etc. (optional)', exact: true })).toHaveValue('Building B');
    await expect(form.getByRole('textbox', { name: 'City', exact: true })).toHaveValue('Concord');
    await expect(form.getByRole('combobox', { name: 'State', exact: true })).toHaveValue('NC');
    await expect(form.getByRole('textbox', { name: 'ZIP code', exact: true })).toHaveValue('28025-1234');
    await page.evaluate(() => { window.portalLocationsFixture.mode = 'success'; });
    await form.getByRole('button', { name: buttonName, exact: true }).click();
    await expect(form.getByRole('status')).toBeVisible();
    expect(await submissions(page)).toEqual([original, original, original]);
  });

  test(`${mode} prevents duplicate saves and disables the submitted form while pending`, async ({ page }) => {
    await openFixture(page, 'mode=deferred');
    const form = mode === 'add' ? addForm(page) : savedLocation(page);
    if (mode === 'edit') await form.getByText('Edit address', { exact: true }).click();
    await fillLocation(form, mode === 'add' ? 'Warehouse' : 'Main office');
    await form.getByRole('button', { name: mode === 'add' ? 'Add location' : 'Save address', exact: true }).evaluate(button => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect(form.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
    await expect(form.getByRole('textbox', { name: 'Location name', exact: true })).toBeDisabled();
    await expect(form.getByRole('combobox', { name: 'State', exact: true })).toBeDisabled();
    await form.locator('form').evaluate(element => {
      (element as HTMLFormElement).requestSubmit();
      (element as HTMLFormElement).requestSubmit();
    });
    expect(await submissions(page)).toHaveLength(1);
    expect(await page.evaluate(() => window.portalLocationsFixture.locations[0].address1)).toBe('105 Johnson Dr');
    const audit = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(audit.violations.filter(issue => issue.impact === 'serious' || issue.impact === 'critical')).toEqual([]);
    await page.evaluate(() => window.portalLocationsFixture.complete?.());
    await expect(form.getByRole('status')).toBeVisible();
    expect(await submissions(page)).toHaveLength(1);
    expect(await page.evaluate(() => window.portalLocationsFixture.locations.length)).toBe(mode === 'add' ? 2 : 1);
  });
}

test('keeps add, edit, and error states accessible and within the viewport', async ({ page }, testInfo) => {
  await openFixture(page, 'mode=error');
  await savedLocation(page).getByText('Edit address', { exact: true }).click();
  await fillLocation(addForm(page));
  await addForm(page).getByRole('button', { name: 'Add location', exact: true }).click();
  await expect(addForm(page).getByRole('alert')).toBeVisible();
  const audit = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(audit.violations.filter(issue => issue.impact === 'serious' || issue.impact === 'critical')).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('portal-locations-errors.png'), fullPage: true });
});
