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
  await page.getByLabel('Greeting name', { exact: true }).fill('Ron and Lisa');
  await page.getByLabel('Tracking number', { exact: true }).fill('1Z0751H30305695303');
  const boxes = page.getByRole('checkbox');
  await boxes.first().check();
  for (let index = 1; index < await boxes.count(); index++) await boxes.nth(index).uncheck();
  await page.getByRole('spinbutton').first().fill('35.00');
}

async function calls(page: Page) { return page.evaluate(() => window.sampleQuoteFixture.calls); }

async function expectEmailTypography(page: Page) {
  const preview = page.getByTestId('sample-quote-email-preview');
  await expect(preview.locator('[data-email-title]')).toHaveText('Samples, pricing & simple ordering.');
  const typography = await preview.evaluate(container => {
    const read = (element: Element) => {
      const style = getComputedStyle(element);
      return { fontFamily: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight };
    };
    return {
      title: read(container.querySelector('[data-email-title]')!),
      greeting: read(container.querySelector('[data-email-greeting]')!),
      categories: [...container.querySelectorAll('[data-email-category-title]')].map(read),
      headerColor: getComputedStyle(container.querySelector('[data-email-section="header"]')!).backgroundColor,
    };
  });
  expect(typography.title.fontFamily).toContain('Georgia');
  expect(typography.title.fontSize).toBe('31px');
  expect(typography.title.lineHeight).toBe('37px');
  expect(typography.headerColor).toBe('rgb(35, 68, 53)');
  expect(typography.greeting.fontFamily).toContain('Arial');
  expect(typography.greeting.fontSize).toBe('15px');
  expect(typography.greeting.lineHeight).toBe('24px');
  expect(typography.categories.length).toBeGreaterThan(0);
  for (const style of typography.categories) {
    expect(style.fontFamily).toContain('Arial');
    expect(style.fontSize).toBe('16px');
    expect(style.lineHeight).toBe('23px');
  }
}

test('requires tracking, previews only the selected custom quote, and fits the screen', async ({ page }) => {
  await openFixture(page);
  await expect(page.getByRole('button', { name: 'Send samples & pricing email', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Greeting name', { exact: true })).toHaveValue('Ron');
  await expect(page.getByLabel('Greeting name', { exact: true })).toHaveAttribute('maxlength', '120');
  expect(await page.getByRole('checkbox', { checked: true }).count()).toBe(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByLabel('Tracking number', { exact: true }).fill('1Z0751H30305695303');
  await expect(page.getByRole('button', { name: 'Send samples & pricing email', exact: true })).toBeDisabled();
  await bulkQuote(page);
  const preview = page.getByRole('region', { name: 'Email preview', exact: true });
  await expect(preview).toContainText('$35.00 per bag ($7.00/lb)');
  await expect(preview).toContainText('Haskins <haskins@sobrew.com>');
  await expect(preview).toContainText('Ron Smith <ron@example.test>');
  await expect(preview).toContainText('Hi Ron and Lisa!');
  await expect(preview).toContainText('1Z0751H30305695303');
  await expect(preview).not.toContainText('Fraction Pack');
  await expect(preview).not.toContainText('Decaf Dark Roast');
  await expect(preview).not.toContainText('K Cups');
  await expectEmailTypography(page);
  await expect(page.getByRole('button', { name: 'Send samples & pricing email', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await test.info().attach('bulk-only-email-preview', { body: await preview.screenshot(), contentType: 'image/png' });

  const boxes = page.getByRole('checkbox');
  for (let index = 0; index < await boxes.count(); index++) await boxes.nth(index).check();
  expect(await page.getByRole('checkbox', { checked: true }).count()).toBe(11);
  for (const category of ['Bulk Coffee (5lb bags)', 'Fraction Pack', 'Filter Pack', 'K Cups']) await expect(preview).toContainText(category);
  await expect(preview).toContainText('Specialty Fourth Dimension Medium Roast');
  const specialty = preview.locator('[data-email-quote-item="k-cups-fourth-dimension"]');
  await expect(specialty.locator('td').first()).toHaveText('50ct');
  await expect(specialty.locator('td').last()).toHaveText('$50.00');
  await expectEmailTypography(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await preview.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await test.info().attach('full-catalog-email-preview', { body: await preview.screenshot(), contentType: 'image/png' });

  await page.getByLabel('Greeting name', { exact: true }).fill('W'.repeat(120));
  await page.getByLabel('Tracking number', { exact: true }).fill(`1Z${'A'.repeat(118)}`);
  const prices = page.getByRole('spinbutton');
  for (let index = 0; index < await prices.count(); index++) await prices.nth(index).fill('99999.99');
  await expect(page.getByRole('button', { name: 'Send samples & pricing email', exact: true })).toBeEnabled();
  const clippedText = await page.getByTestId('sample-quote-email-preview').evaluate(container => {
    const bounds = container.getBoundingClientRect();
    const failures: Array<{ text: string; left: number; right: number; availableWidth: number }> = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (node.textContent?.trim() && !node.parentElement?.closest('style, script')) {
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1) failures.push({ text: node.textContent.trim().slice(0, 50), left: rect.left - bounds.left, right: rect.right - bounds.left, availableWidth: bounds.width });
        }
      }
      node = walker.nextNode();
    }
    return failures;
  });
  expect(clippedText).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await test.info().attach('maximum-length-email-preview', { body: await preview.screenshot(), contentType: 'image/png' });
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
  await expect(page.getByLabel('Greeting name', { exact: true })).toHaveValue('Ron and Lisa');
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
  await expect(page.getByLabel('Greeting name', { exact: true })).toBeDisabled();
  await expect(page.getByRole('spinbutton').first()).toBeDisabled();
  await expect(page.getByRole('checkbox').first()).toBeDisabled();
  const original = (await calls(page))[0];
  expect(original.greetingName).toBe('Ron and Lisa');
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
  expect(await calls(page)).toEqual([{ orderId: 'sample-order-1', greetingName: 'Ron and Lisa', trackingNumber: '1Z0751H30305695303', lines: [{ id: 'bulk-regular', priceCents: 3500 }] }]);
  await page.evaluate(() => window.sampleQuoteFixture.complete?.());
  await expect(page.getByRole('heading', { name: 'Samples and pricing email sent', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Send samples & pricing email', exact: true })).toHaveCount(0);
  await page.locator('form').evaluate(form => form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true })));
  expect(await calls(page)).toHaveLength(1);
});

test('requires a valid greeting name before sending a selected quote', async ({ page }) => {
  await openFixture(page);
  await bulkQuote(page);
  const greeting = page.getByLabel('Greeting name', { exact: true });
  const send = page.getByRole('button', { name: 'Send samples & pricing email', exact: true });
  await greeting.fill('');
  await expect(greeting).toHaveAttribute('aria-invalid', 'true');
  await expect(send).toBeDisabled();
  await expect(page.getByTestId('sample-quote-email-preview')).toHaveCount(0);
  await greeting.fill('   ');
  await expect(send).toBeDisabled();
  await page.locator('form').evaluate(form => form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true })));
  expect(await calls(page)).toHaveLength(0);
  await greeting.fill('  Ron and Lisa  ');
  await expect(page.getByTestId('sample-quote-email-preview')).toContainText('Hi Ron and Lisa!');
  await send.click();
  await expect(page.getByRole('heading', { name: 'Samples and pricing email sent', exact: true })).toBeVisible();
  expect((await calls(page))[0].greetingName).toBe('Ron and Lisa');
});

test('restores older drafts without a greeting field and preserves an uncertain send', async ({ page }) => {
  await openFixture(page);
  await bulkQuote(page);
  const removeGreetingFromStoredDraft = async () => page.evaluate(() => {
    const key = 'prospecting-sample-quote-v1:sample-order-1';
    const stored = JSON.parse(sessionStorage.getItem(key)!);
    delete stored.greetingName;
    sessionStorage.setItem(key, JSON.stringify(stored));
  });
  page.on('dialog', dialog => dialog.accept());
  await removeGreetingFromStoredDraft();
  await page.reload();
  await expect(page.getByText('Your tracking and pricing draft was restored.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Greeting name', { exact: true })).toHaveValue('Ron');
  await expect(page.getByLabel('Greeting name', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Tracking number', { exact: true })).toHaveValue('1Z0751H30305695303');
  await expect(page.getByRole('spinbutton').first()).toHaveValue('35.00');
  expect(await page.getByRole('checkbox', { checked: true }).count()).toBe(1);
  await page.evaluate(() => { window.sampleQuoteFixture.mode = 'connection'; });
  await page.getByRole('button', { name: 'Send samples & pricing email', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('response was interrupted');
  await removeGreetingFromStoredDraft();
  await page.reload();
  await expect(page.getByLabel('Greeting name', { exact: true })).toHaveValue('Ron');
  await expect(page.getByLabel('Greeting name', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Tracking number', { exact: true })).toBeDisabled();
  await expect(page.getByRole('spinbutton').first()).toHaveValue('35.00');
  await page.getByRole('button', { name: 'Check / retry email send', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Samples and pricing email sent', exact: true })).toBeVisible();
  expect(await calls(page)).toEqual([{ orderId: 'sample-order-1', greetingName: 'Ron', trackingNumber: '1Z0751H30305695303', lines: [{ id: 'bulk-regular', priceCents: 3500 }] }]);
});
