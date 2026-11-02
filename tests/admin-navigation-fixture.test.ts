import { writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildAdminNavigationBrowserFixture } from './support/admin-navigation-browser-fixture';

describe('isolated admin navigation browser fixture', () => {
  it('bundles the actual navigation components with simulated responses and browser controls', async () => {
    const html = await buildAdminNavigationBrowserFixture();
    expect(html).toContain('data-navigation-fixture-json');
    expect(html).toContain('Current results remain visible until the next page is ready.');
    expect(html).toContain('Release pending requests');
    expect(html).not.toContain('import_jsx_dev_runtime.jsxDEV');
    if (process.env.GENERATE_NAVIGATION_FIXTURE_PATH) await writeFile(process.env.GENERATE_NAVIGATION_FIXTURE_PATH, html);
  }, 30_000);
});
