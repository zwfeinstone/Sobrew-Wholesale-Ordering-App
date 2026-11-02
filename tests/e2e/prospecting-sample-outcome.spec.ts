import { expect, test, type Page } from '@playwright/test';
import { buildProspectingBrowserFixture } from '../support/prospecting-browser-fixture';

const firstLead = '00000000-0000-4000-8000-000000000001';
const secondLead = '00000000-0000-4000-8000-000000000002';
const firstCompany = 'Better Choice Treatment Center - Las Vegas, NV';
const secondCompany = 'Lakeview Recovery';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let fixture: string;

test.beforeAll(async () => { fixture = await buildProspectingBrowserFixture('tests/fixtures/prospecting-sample-outcome.fixture.tsx'); });

function card(page: Page, companyName = firstCompany) {
  return page.getByRole('article').filter({ has: page.getByRole('heading', { name: companyName, exact: true }) });
}
async function calls(page: Page) { return page.evaluate(() => window.sampleOutcomeFixture.calls); }
async function openFixture(page: Page, query = '') {
  await page.route('https://sample-outcome.test/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
  await page.goto(`https://sample-outcome.test/admin/sales/prospecting/admin?tab=samples&${query}`);
  await expect(card(page)).toBeVisible();
  await expect(card(page, secondCompany)).toBeVisible();
}

test('removes saved outcomes despite a stale refresh and lets the next lead be closed', async ({ page }) => {
  await openFixture(page);
  await card(page).getByLabel('Outcome note', { exact: true }).fill('too expensive');
  await card(page).getByRole('button', { name: 'Mark Lost', exact: true }).click();

  await expect(card(page)).toHaveCount(0);
  await expect(card(page, secondCompany)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.prospectingFixture.refreshCount)).toBe(1);
  const [lost] = await calls(page);
  expect(lost).toEqual({ lead_id: firstLead, outcome: 'lost', outcome_note: 'too expensive', expected_updated_at: '2026-09-30T12:00:00Z', submission_id: expect.stringMatching(uuid) });

  await page.evaluate(() => window.sampleOutcomeFixture.rerender());
  await expect(card(page)).toHaveCount(0);
  await card(page, secondCompany).getByLabel('Outcome note', { exact: true }).fill('Ready to order');
  await card(page, secondCompany).getByRole('button', { name: 'Mark Won', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.prospectingFixture.refreshCount)).toBe(2);
  const [, won] = await calls(page);
  expect(won).toEqual({ lead_id: secondLead, outcome: 'converted', outcome_note: 'Ready to order', expected_updated_at: '2026-09-30T13:00:00Z', submission_id: expect.stringMatching(uuid) });
  expect(won.submission_id).not.toBe(lost.submission_id);
});

for (const outcome of ['lost', 'won'] as const) {
  test(`blocks duplicate ${outcome} submissions while showing progress`, async ({ page }) => {
    await openFixture(page, 'mode=deferred');
    const lead = card(page);
    await lead.getByLabel('Outcome note', { exact: true }).fill('Outcome recorded');
    await lead.getByRole('button', { name: outcome === 'lost' ? 'Mark Lost' : 'Mark Won', exact: true }).evaluate(button => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect(lead.getByRole('button', { name: `Marking ${outcome}…`, exact: true })).toBeDisabled();
    await expect(lead.getByRole('button', { name: outcome === 'lost' ? 'Mark Won' : 'Mark Lost', exact: true })).toBeDisabled();
    await expect(lead.getByLabel('Outcome note', { exact: true })).toBeDisabled();
    await expect(lead).toBeVisible();
    await expect(card(page, secondCompany).getByRole('button', { name: 'Mark Lost', exact: true })).toBeEnabled();
    expect(await calls(page)).toHaveLength(1);
    expect((await calls(page))[0].outcome).toBe(outcome === 'won' ? 'converted' : 'lost');
    expect(await page.evaluate(() => window.prospectingFixture.refreshCount)).toBe(0);
    await page.evaluate(id => window.sampleOutcomeFixture.complete[id](), firstLead);
    await expect(lead).toHaveCount(0);
    expect(await calls(page)).toHaveLength(1);
  });
}

test('explains a slow save while keeping the lead visible until confirmation', async ({ page }) => {
  await openFixture(page, 'mode=deferred');
  await page.clock.install();
  const lead = card(page);
  await lead.getByRole('button', { name: 'Mark Lost', exact: true }).click();
  await expect(lead.getByRole('status')).toHaveText('Saving outcome…');
  await page.clock.fastForward(15_001);
  await expect(lead.getByRole('status')).toHaveText('Still saving. Keep this page open; the lead will leave this list once confirmed.');
  await expect(lead.getByRole('button', { name: 'Marking lost…', exact: true })).toBeDisabled();
  await expect(lead).toBeVisible();
  expect(await calls(page)).toHaveLength(1);
  expect(await page.evaluate(() => window.prospectingFixture.refreshCount)).toBe(0);
  await page.evaluate(id => window.sampleOutcomeFixture.complete[id](), firstLead);
  await expect(lead).toHaveCount(0);
});

test('keeps a failed outcome and note visible and reuses the submission ID when retried', async ({ page }) => {
  await openFixture(page, 'mode=validation');
  const lead = card(page);
  await lead.getByLabel('Outcome note', { exact: true }).fill('too expensive');
  await lead.getByRole('button', { name: 'Mark Lost', exact: true }).click();
  await expect(lead.getByRole('alert')).toHaveText('The lead changed. Refresh the record and try again.');
  await expect(lead.getByLabel('Outcome note', { exact: true })).toHaveValue('too expensive');
  await expect(lead.getByRole('button', { name: 'Mark Lost', exact: true })).toBeEnabled();
  await expect(lead.getByRole('button', { name: 'Mark Won', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.prospectingFixture.refreshCount)).toBe(0);
  const [original] = await calls(page);
  expect(original.submission_id).toMatch(uuid);
  await page.evaluate(() => { window.sampleOutcomeFixture.mode = 'success'; });
  await lead.getByRole('button', { name: 'Mark Lost', exact: true }).click();
  await expect(lead).toHaveCount(0);
  expect(await calls(page)).toEqual([original, original]);
});

test('retains the draft after a disconnected response and safely retries the same outcome', async ({ page }) => {
  await openFixture(page, 'mode=connection');
  const lead = card(page);
  await lead.getByLabel('Outcome note', { exact: true }).fill('Budget does not fit');
  await lead.getByRole('button', { name: 'Mark Lost', exact: true }).click();
  await expect(lead.getByRole('alert')).toBeVisible();
  await expect(lead.getByLabel('Outcome note', { exact: true })).toHaveValue('Budget does not fit');
  await expect(lead.getByRole('button', { name: 'Mark Lost', exact: true })).toBeEnabled();
  const [original] = await calls(page);
  await page.evaluate(() => { window.sampleOutcomeFixture.mode = 'success'; });
  await lead.getByRole('button', { name: 'Mark Lost', exact: true }).click();
  await expect(lead).toHaveCount(0);
  expect(await calls(page)).toEqual([original, original]);
});

test('uses a new submission ID when a failed outcome draft changes', async ({ page }) => {
  await openFixture(page, 'mode=validation');
  const lead = card(page);
  await lead.getByLabel('Outcome note', { exact: true }).fill('too expensive');
  await lead.getByRole('button', { name: 'Mark Lost', exact: true }).click();
  await expect(lead.getByRole('alert')).toBeVisible();
  const [original] = await calls(page);
  await lead.getByLabel('Outcome note', { exact: true }).fill('Approved a revised quote');
  await page.evaluate(() => { window.sampleOutcomeFixture.mode = 'success'; });
  await lead.getByRole('button', { name: 'Mark Won', exact: true }).click();
  await expect(lead).toHaveCount(0);
  const [, revised] = await calls(page);
  expect(revised.outcome).toBe('converted');
  expect(revised.outcome_note).toBe('Approved a revised quote');
  expect(revised.submission_id).toMatch(uuid);
  expect(revised.submission_id).not.toBe(original.submission_id);
});

test('read-only users cannot submit either outcome', async ({ page }) => {
  await openFixture(page, 'readonly=1');
  const lead = card(page);
  await expect(lead.getByRole('button', { name: 'Mark Lost', exact: true })).toBeDisabled();
  await expect(lead.getByRole('button', { name: 'Mark Won', exact: true })).toBeDisabled();
  await lead.locator('form').evaluate(form => {
    for (const button of form.querySelectorAll('button')) {
      form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: button }));
    }
  });
  expect(await calls(page)).toHaveLength(0);
  await expect(lead).toBeVisible();
  expect(await page.evaluate(() => window.prospectingFixture.refreshCount)).toBe(0);
});
