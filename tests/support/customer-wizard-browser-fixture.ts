import { resolve } from 'node:path';
import { build } from 'vite';

/** Bundle the real wizard and styles without a running app or live customer API. */
export async function buildCustomerWizardBrowserFixture() {
  const root = process.cwd();
  const result = await build({
    configFile: false,
    root,
    logLevel: 'warn',
    resolve: { alias: { '@': root } },
    define: { 'process.env.NODE_ENV': '"production"' },
    oxc: { jsx: { runtime: 'automatic' } },
    build: { write: false, minify: false, lib: { entry: resolve(root, 'tests/fixtures/customer-wizard.fixture.tsx'), formats: ['iife'], name: 'CustomerWizardFixture' } },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as unknown as { output: { type: string; code?: string; fileName: string; source?: string | Uint8Array }[] }[];
  const files = outputs.flatMap((item) => item.output);
  const javascript = files.filter((item) => item.type === 'chunk').map((item) => item.code || '').join('\n');
  const css = files.filter((item) => item.fileName.endsWith('.css')).map((item) => String(item.source || '')).join('\n');
  if (!javascript || !css) throw new Error('Customer wizard fixture must include real components and application styles.');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sobrew customer creation · isolated QA fixture</title><style>:root{--font-sans:Arial,sans-serif}${css}</style></head><body><div id="fixture-root"></div><script>${javascript.replaceAll('</script', '<\\/script')}</script></body></html>`;
}
