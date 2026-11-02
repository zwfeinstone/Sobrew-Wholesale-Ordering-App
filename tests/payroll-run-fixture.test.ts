import { writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildPayrollRunBrowserFixture } from './support/payroll-run-browser-fixture';

describe('payroll interaction browser fixture', () => {
  it('bundles the real payroll component with isolated actions and application styles', async () => {
    const html = await buildPayrollRunBrowserFixture();
    expect(html).toContain('Review & pay your team');
    expect(html).toContain('data-payroll-fixture-log');
    expect(html).toContain('payroll-run-columns');
    expect(html).toContain('alex-shift-1');
    if (process.env.GENERATE_PAYROLL_FIXTURE_PATH) await writeFile(process.env.GENERATE_PAYROLL_FIXTURE_PATH, html);
  }, 30000);
});
