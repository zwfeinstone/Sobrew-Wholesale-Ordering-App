import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { buildPasswordSafetyBrowserFixture } from '../support/password-safety-browser-fixture';

let fixture: string;
test.beforeAll(async () => { fixture = await buildPasswordSafetyBrowserFixture(); });
async function openFixture(page: Page) {
  await page.route('**/*', (route) => {
    if (route.request().url() === 'https://password-safety.test/' && route.request().method() === 'GET') {
      return route.fulfill({ contentType: 'text/html', body: fixture });
    }
    return route.abort('blockedbyclient');
  });
  await page.goto('https://password-safety.test/');
  await expect(page.getByRole('heading', { name: 'Customer logins' })).toBeVisible();
}
async function openReset(page: Page) {
  await page.locator('summary').click();
  return page.getByRole('form', { name: 'Reset password for buyer@example.test', exact: true });
}

test('saving a name cannot submit a password even when the reset fields are populated', async ({ page }, testInfo) => {
  await openFixture(page);
  const reset = await openReset(page);
  await reset.getByLabel('New password', { exact: true }).fill('Autofilled-password-123!');
  await reset.getByLabel('Confirm new password', { exact: true }).fill('Autofilled-password-123!');
  const edit = page.getByRole('form', { name: 'Edit login for buyer@example.test', exact: true });
  await expect(edit.locator('input[type=password]')).toHaveCount(0);
  await edit.getByLabel('Login name').fill('Updated Buyer');
  await edit.getByRole('button', { name: 'Save Login', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.passwordSafetyFixture.submissions)).toEqual([
    { action: 'save', values: { center_id: 'center-1', member_id: 'user-1', full_name: 'Updated Buyer', is_active: 'on' } },
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const { violations } = await new AxeBuilder({ page }).include('main').analyze();
  expect(violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('separate-password-reset.png'), fullPage: true });
});

test('enter in a profile field saves only the profile while a password reset is filled', async ({ page }) => {
  await openFixture(page);
  const reset = await openReset(page);
  await reset.getByLabel('New password', { exact: true }).fill('Autofilled-password-123!');
  await reset.getByLabel('Confirm new password', { exact: true }).fill('Autofilled-password-123!');
  await page.getByLabel('Login name').fill('Keyboard Buyer');
  await page.getByLabel('Login name').press('Enter');
  await expect.poll(() => page.evaluate(() => window.passwordSafetyFixture.submissions.map((entry) => entry.action))).toEqual(['save']);
  expect(await page.evaluate(() => 'password' in window.passwordSafetyFixture.submissions[0].values)).toBe(false);
});

test('reset requires confirmation and preserves exact password characters', async ({ page }) => {
  await openFixture(page);
  const reset = await openReset(page);
  const password = '  Spaces  <&>☃123!  ';
  await reset.getByLabel('New password', { exact: true }).fill(password);
  await reset.getByRole('button', { name: 'Reset Password', exact: true }).click();
  expect(await page.evaluate(() => window.passwordSafetyFixture.submissions)).toEqual([]);
  expect(await reset.getByLabel('Confirm new password', { exact: true }).evaluate((element) => (element as HTMLInputElement).validity.valueMissing)).toBe(true);
  await reset.getByLabel('Confirm new password', { exact: true }).fill(password);
  await reset.getByRole('button', { name: 'Reset Password', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.passwordSafetyFixture.submissions)).toEqual([
    { action: 'reset', values: { center_id: 'center-1', member_id: 'user-1', password, confirm_password: password } },
  ]);
});
