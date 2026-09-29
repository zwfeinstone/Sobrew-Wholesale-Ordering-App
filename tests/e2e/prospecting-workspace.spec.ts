import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { buildProspectingBrowserFixture } from '../support/prospecting-browser-fixture';

let fixture: string;
// No application server is needed: run with PLAYWRIGHT_BASE_URL=http://fixture.invalid.
// Each project gets its real configured viewport; every request stays intercepted.
test.describe.configure({ mode: 'default' });
test.beforeAll(async () => { fixture = await buildProspectingBrowserFixture(); });
async function openFixture(page: Page, query = '') {
  await page.route('https://prospecting.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
  const params = new URLSearchParams(query.includes('workspace=1') ? 'workspace=1&view=today&origin=rep&lead=00000000-0000-4000-8000-000000000001' : '');
  for (const [name, value] of new URLSearchParams(query)) params.set(name, value);
  const path = query.includes('workspace=1') ? '/admin/sales/prospecting' : '/admin/sales/prospecting/00000000-0000-4000-8000-000000000001';
  await page.goto(`https://prospecting.test${path}?${params}`);
  await expect(page.getByRole('heading', { name: 'Lakeview Recovery', exact: true })).toBeVisible();
}
async function calls(page: Page) { return page.evaluate(() => window.prospectingFixture.calls); }
async function beginSample(page: Page) {
  await page.getByRole('button', { name: 'Request samples', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sample handoff' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  return dialog;
}

test('logs outreach with Keep follow-up and advances only after success', async ({ page }) => {
  await openFixture(page);
  await page.getByRole('button', { name: 'Log call', exact: true }).click();
  await page.getByRole('combobox', { name: 'Outcome', exact: true }).selectOption('No answer');
  await page.getByRole('textbox', { name: 'What happened?', exact: true }).fill('Left a concise message for purchasing.');
  await page.getByRole('button', { name: 'Save and next', exact: true }).click();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  const [input] = await calls(page);
  expect(input.draft.activity).toMatchObject({ type: 'call', result: 'No answer', body: 'Left a concise message for purchasing.' });
  expect(input.draft.followUp).toEqual({ mode: 'keep', date: '2026-09-24' });
  await expect.poll(() => page.evaluate(() => window.prospectingFixture.navigation)).toContain('next-lead');
});

test('clears incompatible outcomes when switching channels without losing notes', async ({ page }) => {
  await openFixture(page);
  await page.getByRole('button', { name: 'Log call', exact: true }).click();
  await page.getByRole('combobox', { name: 'Outcome', exact: true }).selectOption('Interested');
  await page.getByRole('textbox', { name: 'What happened?', exact: true }).fill('Buyer asked for more information.');
  await page.getByRole('button', { name: 'Log email', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Outcome', exact: true })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'What happened?', exact: true })).toHaveValue('Buyer asked for more information.');
  await page.getByRole('combobox', { name: 'Outcome', exact: true }).selectOption('Intro sent');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  expect((await calls(page))[0].draft.activity).toMatchObject({ type: 'email', result: 'Intro sent' });
});

test('retains a failed draft across reload and retries an interrupted submission with its original identity', async ({ page }) => {
  await openFixture(page, 'mode=connection');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Draft survives interruption.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('response was interrupted');
  const first = (await calls(page))[0];
  await page.evaluate(() => { window.prospectingFixture.mode = 'success'; });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await calls(page)).length).toBe(2);
  expect((await calls(page))[1].submissionId).toBe(first.submissionId);
  await expect.poll(() => page.evaluate(() => window.prospectingFixture.refreshCount)).toBe(1);
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('A second unsaved draft.');
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole('status')).toContainText('restored');
  await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('A second unsaved draft.');
});

test('guards keyboard navigation and links conflict recovery to the actual prospect route', async ({ page }) => {
  await openFixture(page, 'origin=leads&mode=stale');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Review before leaving.');
  await page.getByRole('link', { name: 'Next', exact: true }).click();
  const guard = page.getByRole('dialog', { name: 'Save your changes?' });
  await expect(guard).toBeVisible();
  await expect(guard.getByRole('button', { name: 'Stay here', exact: true })).toBeFocused();
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    const focus = await guard.evaluate((element) => ({
      documentFocused: document.hasFocus(),
      modal: element.matches(':modal'),
      insideDialog: element.contains(document.activeElement),
    }));
    expect(focus.modal).toBe(true);
    // Native modal tabbing can visit browser chrome; document focus must stay in the dialog.
    if (focus.documentFocused) expect(focus.insideDialog).toBe(true);
  }
  await page.keyboard.press('Escape'); await expect(guard).not.toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Review saved record and draft', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open latest record', exact: true })).toHaveAttribute('href', /^\/admin\/sales\/prospecting\/00000000-0000-4000-8000-000000000001\?/);
});

test('preserves alternate shipping when stepping back and submits corrected sample data after validation fails', async ({ page }) => {
  await openFixture(page, 'mode=sample_validation_once');
  const dialog = await beginSample(page);
  await dialog.getByRole('textbox', { name: 'Shipping address 1', exact: true }).fill('99 Alternate Avenue');
  await dialog.getByRole('spinbutton', { name: 'Coffee sample box', exact: true }).fill('2');
  await dialog.getByRole('textbox', { name: 'Fulfillment notes', exact: true }).fill('First attempt notes');
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Shipping address 1', exact: true })).toHaveValue('99 Alternate Avenue');
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.getByRole('button', { name: 'Submit sample order', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('shipment notes');
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Fulfillment notes', exact: true }).fill('Corrected shipment notes');
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.getByRole('button', { name: 'Submit sample order', exact: true }).click();
  await expect.poll(async () => (await calls(page)).length).toBe(2);
  const inputs = await calls(page);
  expect(inputs[1].sample?.notes).toBe('Corrected shipment notes');
  expect(inputs[1].submissionId).not.toBe(inputs[0].submissionId);
  await expect(page.getByRole('dialog', { name: 'Sample order created' })).toBeVisible();
});

test('canceling sample handoff makes no request and sample-only drafts persist', async ({ page }) => {
  await openFixture(page, 'stage=sample_requested');
  const dialog = await beginSample(page);
  await dialog.getByRole('textbox', { name: 'Fulfillment notes', exact: true }).fill('Keep this sample-only draft');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible(); expect(await calls(page)).toHaveLength(0);
  page.once('dialog', (event) => event.accept()); await page.reload();
  await expect(page.getByRole('status')).toContainText('restored');
  await beginSample(page);
  await expect(page.getByRole('dialog', { name: 'Sample handoff' }).getByRole('textbox', { name: 'Fulfillment notes', exact: true })).toHaveValue('Keep this sample-only draft');
});

test('reveals an invalid field inside collapsed company details and preserves the edit', async ({ page }) => {
  await openFixture(page);
  await page.getByText('Company details & ownership', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Company email', exact: true }).fill('invalid email');
  await page.getByText('Company details & ownership', { exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Company email', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Company email', exact: true })).toHaveValue('invalid email');
  expect(await calls(page)).toHaveLength(0);
});

test('read-only access exposes the record without enabling writes', async ({ page }) => {
  await openFixture(page, 'readonly=1');
  await expect(page.getByText('You have read-only access to this record.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Request samples', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Log call', exact: true })).toBeDisabled();
  expect(await calls(page)).toHaveLength(0);
});

test('fits each viewport and passes serious accessibility checks, including the sample dialog', async ({ page }) => {
  await openFixture(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const pageAudit = await new AxeBuilder({ page }).include('[data-testid="prospecting-record-editor"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(pageAudit.violations.filter((issue) => issue.impact === 'serious' || issue.impact === 'critical')).toEqual([]);
  const dialog = await beginSample(page);
  const bounds = await dialog.boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  const dialogAudit = await new AxeBuilder({ page }).include('dialog[open]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(dialogAudit.violations.filter((issue) => issue.impact === 'serious' || issue.impact === 'critical')).toEqual([]);
});

test.describe('lead pane navigation', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(page.viewportSize()!.width < 1280, 'The persistent queue rail is a desktop layout.');
    await openFixture(page, 'workspace=1');
  });

  test('keeps the queue DOM, search, filters and scroll while only the lead pane loads', async ({ page }) => {
    const rail = page.locator('[data-prospecting-rail]');
    const originalRail = await rail.elementHandle();
    const pane = page.getByRole('region', { name: 'Lead details' });
    await rail.getByRole('textbox', { name: 'Search leads', exact: true }).fill('unsent search');
    await rail.getByText('Filters', { exact: true }).click();
    await rail.getByRole('combobox', { name: 'Queue priority', exact: true }).selectOption('high');
    await rail.evaluate((element) => { element.scrollTop = 100; });
    await page.evaluate(() => { window.prospectingFixture.navigationDelay = 900; });
    await pane.getByRole('link', { name: 'Next', exact: true }).click();
    await expect(pane).toHaveAttribute('aria-busy', 'true');
    await expect(pane.getByRole('status')).toHaveText('Loading lead…');
    await expect(rail).not.toHaveAttribute('aria-busy', 'true');
    await expect(pane.getByRole('heading', { name: 'Riverside Recovery', exact: true })).toBeVisible();
    await expect(pane).toHaveAttribute('aria-busy', 'false');
    expect(await originalRail!.evaluate((element) => element === document.querySelector('[data-prospecting-rail]'))).toBe(true);
    await expect(rail.getByRole('textbox', { name: 'Search leads', exact: true })).toHaveValue('unsent search');
    await expect(rail.getByTestId('queue-filters')).toHaveAttribute('open', '');
    await expect(rail.getByRole('combobox', { name: 'Queue priority', exact: true })).toHaveValue('high');
    expect(await rail.evaluate((element) => element.scrollTop)).toBe(100);

    await pane.locator(':scope > div').first().evaluate((element) => { element.scrollTop = 150; });
    await rail.getByRole('link', { name: 'Oakwood Recovery', exact: true }).click();
    await expect(pane).toHaveAttribute('aria-busy', 'true');
    await expect(pane.getByRole('heading', { name: 'Oakwood Recovery', exact: true })).toBeVisible();
    expect(await rail.evaluate((element) => element.scrollTop)).toBe(100);
    expect(await originalRail!.evaluate((element) => element.isConnected)).toBe(true);
    expect(await pane.locator(':scope > div').first().evaluate((element) => element.scrollTop)).toBe(0);
    await expect(rail.getByRole('link', { name: 'Oakwood Recovery', exact: true })).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(1);
  });

  test('guards rail selection with stay, discard, and save before continuing', async ({ page }) => {
    const rail = page.locator('[data-prospecting-rail]');
    const pane = page.getByRole('region', { name: 'Lead details' });
    const guard = page.getByRole('dialog', { name: 'Save your changes?' });
    await pane.getByRole('button', { name: 'Add note', exact: true }).click();
    await pane.getByRole('textbox', { name: 'Note', exact: true }).fill('Keep until I decide.');
    await rail.getByRole('link', { name: 'Riverside Recovery', exact: true }).click();
    await expect(guard).toBeVisible();
    await expect(pane).toHaveAttribute('aria-busy', 'false');
    expect(await calls(page)).toHaveLength(0);
    await guard.getByRole('button', { name: 'Stay here', exact: true }).click();
    await expect(pane.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('Keep until I decide.');
    await expect(pane.getByRole('heading', { name: 'Lakeview Recovery', exact: true })).toBeVisible();

    await rail.getByRole('link', { name: 'Riverside Recovery', exact: true }).click();
    await guard.getByRole('button', { name: 'Discard and leave', exact: true }).click();
    await expect(pane.getByRole('heading', { name: 'Riverside Recovery', exact: true })).toBeVisible();
    expect(await calls(page)).toHaveLength(0);
    await pane.getByRole('button', { name: 'Add note', exact: true }).click();
    await pane.getByRole('textbox', { name: 'Note', exact: true }).fill('Save Riverside before changing leads.');
    await rail.getByRole('link', { name: 'Oakwood Recovery', exact: true }).click();
    await guard.getByRole('button', { name: 'Save and leave', exact: true }).click();
    await expect(pane.getByRole('heading', { name: 'Oakwood Recovery', exact: true })).toBeVisible();
    const inputs = await calls(page);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ leadId: '00000000-0000-4000-8000-000000000002', draft: { activity: { type: 'note', body: 'Save Riverside before changing leads.' } } });
    await rail.getByRole('link', { name: 'Lakeview Recovery', exact: true }).click();
    await expect(pane.getByRole('heading', { name: 'Lakeview Recovery', exact: true })).toBeVisible();
    await expect(pane.getByText('No unsaved changes', { exact: true })).toBeVisible();
  });

  test('supports Back and Forward and keeps the most recently selected lead during overlapping loads', async ({ page }) => {
    const rail = page.locator('[data-prospecting-rail]');
    const originalRail = await rail.elementHandle();
    const pane = page.getByRole('region', { name: 'Lead details' });
    await pane.getByRole('link', { name: 'Next', exact: true }).click();
    await expect(pane.getByRole('heading', { name: 'Riverside Recovery', exact: true })).toBeVisible();
    await page.goBack();
    await expect(pane.getByRole('heading', { name: 'Lakeview Recovery', exact: true })).toBeVisible();
    await page.goForward();
    await expect(pane.getByRole('heading', { name: 'Riverside Recovery', exact: true })).toBeVisible();
    await page.evaluate(() => { window.prospectingFixture.navigationDelay = 900; });
    await rail.getByRole('link', { name: 'Oakwood Recovery', exact: true }).click();
    await expect(pane).toHaveAttribute('aria-busy', 'true');
    await rail.getByRole('link', { name: 'Lakeview Recovery', exact: true }).click();
    await expect(pane).toHaveAttribute('aria-busy', 'false');
    await expect(pane.getByRole('heading', { name: 'Lakeview Recovery', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/lead=00000000-0000-4000-8000-000000000001/);
    expect(await originalRail!.evaluate((element) => element.isConnected)).toBe(true);
  });

  test('selecting the already displayed lead does not refresh or navigate', async ({ page }) => {
    const pane = page.getByRole('region', { name: 'Lead details' });
    const originalUrl = page.url();
    await page.locator('[data-prospecting-rail]').getByRole('link', { name: 'Lakeview Recovery', exact: true }).click();
    await expect(pane).toHaveAttribute('aria-busy', 'false');
    await expect(pane.getByRole('heading', { name: 'Lakeview Recovery', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.prospectingFixture.refreshCount)).toBe(0);
    expect(await page.evaluate(() => window.prospectingFixture.navigationCalls)).toEqual([]);
    expect(page.url()).toBe(originalUrl);
  });

  test('returns to the displayed lead during B then C loads without queuing a refresh', async ({ page }) => {
    const rail = page.locator('[data-prospecting-rail]');
    const pane = page.getByRole('region', { name: 'Lead details' });
    const originalUrl = page.url();
    await page.evaluate(() => { window.prospectingFixture.stalledLeadIds = ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003']; });
    await rail.getByRole('link', { name: 'Riverside Recovery', exact: true }).click();
    await expect(pane).toHaveAttribute('aria-busy', 'true');
    expect(page.url()).toBe(originalUrl);
    await rail.getByRole('link', { name: 'Oakwood Recovery', exact: true }).click();
    expect(page.url()).toBe(originalUrl);
    await rail.getByRole('link', { name: 'Lakeview Recovery', exact: true }).click();
    await expect(pane).toHaveAttribute('aria-busy', 'false');
    expect(await page.evaluate(() => window.prospectingFixture.navigationCalls.map((href) => new URL(href, location.href).searchParams.get('lead')))).toEqual([
      '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001',
    ]);
    expect(await page.evaluate(() => window.prospectingFixture.refreshCount)).toBe(0);
    await page.evaluate(() => window.prospectingFixture.completeLoads());
    await expect(pane.getByRole('heading', { name: 'Lakeview Recovery', exact: true })).toBeVisible();
    await expect(pane).toHaveAttribute('aria-busy', 'false');
    expect(page.url()).toBe(originalUrl);
  });

  test('ignores a duplicate selection of the pending destination', async ({ page }) => {
    const rail = page.locator('[data-prospecting-rail]');
    const pane = page.getByRole('region', { name: 'Lead details' });
    await page.evaluate(() => { window.prospectingFixture.stalledLeadIds = ['00000000-0000-4000-8000-000000000002']; });
    await rail.getByRole('link', { name: 'Riverside Recovery', exact: true }).click();
    await expect(pane).toHaveAttribute('aria-busy', 'true');
    await rail.getByRole('link', { name: 'Riverside Recovery', exact: true }).click();
    expect(await page.evaluate(() => window.prospectingFixture.navigationCalls)).toHaveLength(1);
    expect(await page.evaluate(() => window.prospectingFixture.refreshCount)).toBe(0);
    await page.evaluate(() => window.prospectingFixture.completeLoads());
    await expect(pane.getByRole('heading', { name: 'Riverside Recovery', exact: true })).toBeVisible();
    await expect(pane).toHaveAttribute('aria-busy', 'false');
  });

  test('offers a usable hard reload of the latest destination when navigation stalls', async ({ page }) => {
    const rail = page.locator('[data-prospecting-rail]');
    const pane = page.getByRole('region', { name: 'Lead details' });
    await page.clock.install();
    await page.evaluate(() => { window.prospectingFixture.stalledLeadIds = ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003']; });
    await rail.getByRole('link', { name: 'Riverside Recovery', exact: true }).click();
    await expect(pane).toHaveAttribute('aria-busy', 'true');
    await rail.getByRole('link', { name: 'Oakwood Recovery', exact: true }).click();
    await page.clock.fastForward(10_001);
    const reload = page.getByRole('button', { name: 'Reload lead', exact: true });
    await expect(reload).toBeVisible();
    await expect(reload).toBeEnabled();
    expect(await reload.evaluate((button) => Boolean(button.closest('[inert]')))).toBe(false);
    const [request] = await Promise.all([
      page.waitForEvent('request', { predicate: (request) => request.isNavigationRequest() && request.resourceType() === 'document' }),
      reload.click(),
    ]);
    expect(new URL(request.url()).searchParams.get('lead')).toBe('00000000-0000-4000-8000-000000000003');
    await expect(pane.getByRole('heading', { name: 'Oakwood Recovery', exact: true })).toBeVisible();
    await expect(pane).toHaveAttribute('aria-busy', 'false');
  });

  test('coalesces explicit refresh requests until the latest navigation commits', async ({ page }) => {
    const rail = page.locator('[data-prospecting-rail]');
    const pane = page.getByRole('region', { name: 'Lead details' });
    await page.evaluate(() => { window.prospectingFixture.stalledLeadIds = ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003']; window.prospectingFixture.refreshDelay = 250; });
    await rail.getByRole('link', { name: 'Riverside Recovery', exact: true }).click();
    await expect(pane).toHaveAttribute('aria-busy', 'true');
    await rail.getByRole('link', { name: 'Oakwood Recovery', exact: true }).click();
    await rail.getByRole('button', { name: 'Refresh fixture record', exact: true }).click();
    await rail.getByRole('button', { name: 'Refresh fixture record', exact: true }).click();
    expect(await page.evaluate(() => window.prospectingFixture.refreshCount)).toBe(0);
    await page.evaluate(() => window.prospectingFixture.completeLoads());
    await expect.poll(() => page.evaluate(() => window.prospectingFixture.refreshCount)).toBe(1);
    await expect(pane).toHaveAttribute('aria-busy', 'false');
    await expect(pane.getByRole('heading', { name: 'Oakwood Recovery', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.prospectingFixture.navigationCalls)).toHaveLength(2);
  });

  test('handles same-lead history anchors without refreshing or losing an unsaved draft', async ({ page }) => {
    const pane = page.getByRole('region', { name: 'Lead details' });
    await pane.getByRole('button', { name: 'Add note', exact: true }).click();
    await pane.getByRole('textbox', { name: 'Note', exact: true }).fill('Keep this draft while viewing history.');
    await pane.getByRole('link', { name: 'Jump to activity history', exact: true }).click();
    await expect(page).toHaveURL(/#activity-history$/);
    await expect(pane).toHaveAttribute('aria-busy', 'false');
    await expect(pane.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('Keep this draft while viewing history.');
    await expect(page.getByRole('dialog', { name: 'Save your changes?' })).not.toBeVisible();
    expect(await page.evaluate(() => window.prospectingFixture.refreshCount)).toBe(0);
    expect(await calls(page)).toHaveLength(0);
  });

  test('ordinary Save refreshes the current record and leaves it editable for the next save', async ({ page }) => {
    const pane = page.getByRole('region', { name: 'Lead details' });
    const originalUrl = page.url();
    await page.evaluate(() => { window.prospectingFixture.refreshDelay = 300; });
    await pane.getByRole('button', { name: 'Add note', exact: true }).click();
    await pane.getByRole('textbox', { name: 'Note', exact: true }).fill('Save in place.');
    await pane.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.prospectingFixture.refreshCount)).toBe(1);
    await expect(pane).toHaveAttribute('aria-busy', 'false');
    await expect(pane.getByText('No unsaved changes', { exact: true })).toBeVisible();
    await pane.getByRole('button', { name: 'Add note', exact: true }).click();
    await pane.getByRole('textbox', { name: 'Note', exact: true }).fill('A second independent note.');
    await expect(pane.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    await pane.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.prospectingFixture.refreshCount)).toBe(2);
    await expect(pane).toHaveAttribute('aria-busy', 'false');
    expect(await calls(page)).toHaveLength(2);
    expect(page.url()).toBe(originalUrl);
  });

  test('Save and next navigates once after saving without refreshing the old lead', async ({ page }) => {
    const pane = page.getByRole('region', { name: 'Lead details' });
    await pane.getByRole('button', { name: 'Log call', exact: true }).click();
    await pane.getByRole('combobox', { name: 'Outcome', exact: true }).selectOption('Left voicemail');
    await pane.getByRole('textbox', { name: 'What happened?', exact: true }).fill('Follow up next week.');
    await pane.getByRole('button', { name: 'Save and next', exact: true }).click();
    await expect(pane.getByRole('heading', { name: 'Riverside Recovery', exact: true })).toBeVisible();
    await expect(pane).toHaveAttribute('aria-busy', 'false');
    expect(await calls(page)).toHaveLength(1);
    expect(await page.evaluate(() => window.prospectingFixture.navigationCalls)).toHaveLength(1);
    expect(await page.evaluate(() => window.prospectingFixture.refreshCount)).toBe(0);
  });

  test('Save and leave to the current lead refreshes it instead of leaving a committed editor disabled', async ({ page }) => {
    const pane = page.getByRole('region', { name: 'Lead details' });
    await pane.getByRole('button', { name: 'Add note', exact: true }).click();
    await pane.getByRole('textbox', { name: 'Note', exact: true }).fill('Save before returning to this same lead.');
    await page.locator('[data-prospecting-rail]').getByRole('link', { name: 'Lakeview Recovery', exact: true }).click();
    await page.getByRole('dialog', { name: 'Save your changes?' }).getByRole('button', { name: 'Save and leave', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.prospectingFixture.refreshCount)).toBe(1);
    await expect(pane).toHaveAttribute('aria-busy', 'false');
    await expect(pane.getByText('No unsaved changes', { exact: true })).toBeVisible();
    await pane.getByRole('button', { name: 'Add note', exact: true }).click();
    await pane.getByRole('textbox', { name: 'Note', exact: true }).fill('Ready for more edits.');
    await expect(pane.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    expect(await calls(page)).toHaveLength(1);
  });
});
