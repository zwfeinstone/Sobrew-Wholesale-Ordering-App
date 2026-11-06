import { resolve } from 'node:path';
import { build, type Plugin } from 'vite';

declare global {
  interface Window {
    centerCatalogFixture: { submissions: [string, string][][] };
  }
}

export const CENTER_CATALOG_FIXTURE_PRODUCTS = [
  { id: 'medium-10', name: 'Meeting Medium Roast Fraction Pack 20 x 10 oz', category: 'fraction_packs', assigned: false, price: 16000, complimentary: false },
  { id: 'filter-dark', name: 'Meeting Dark Roast Filter Pack 40 x 2 oz', category: 'Filter Packs', assigned: true, price: 0, complimentary: true },
  { id: 'medium-2', name: 'Meeting Medium Roast Fraction Pack 100 x 2 oz', category: 'fraction_packs', assigned: true, price: 12500, complimentary: false },
  { id: 'dark-2', name: 'Meeting Dark Roast Fraction Pack 96 x 2 oz', category: 'fraction_packs', assigned: true, price: 12000, complimentary: false },
  { id: 'medium-1-5-filters', name: 'Meeting Medium Roast Fraction Pack 100 x 1.5 oz with Filters', category: 'fraction_packs', assigned: false, price: 10500, complimentary: false },
  { id: 'medium-1-5-100', name: 'Meeting Medium Roast Fraction Pack 100 x 1.5 oz', category: 'fraction_packs', assigned: false, price: 10000, complimentary: false },
  { id: 'decaf', name: 'Meeting Decaf Dark Roast Fraction Pack 100 x 1.25 oz', category: 'fraction_packs', assigned: false, price: 13000, complimentary: false },
  { id: 'medium-1-5-72', name: 'Meeting Medium Roast Fraction Pack 72 x 1.5 oz', category: 'Fraction Packs', assigned: true, price: 8800, complimentary: false },
  { id: 'medium-sku', name: 'Meeting Medium Roast Special Case', sku: 'MTC-FP-MED-100X2.5OZ', category: 'fraction_packs', assigned: false, price: 14500, complimentary: false },
  { id: 'filter-medium', name: 'Meeting Medium Roast Filter Pack 40 x 1.4 oz', category: 'filter_packs', assigned: false, price: 4200, complimentary: false },
  { id: 'k-cups', name: 'Meeting K-Cups 50 count', category: 'K-Cups', assigned: true, price: 4200, complimentary: false },
  { id: 'unknown', name: 'Special Customer Product', category: 'Legacy category', assigned: false, price: null, complimentary: false },
];

/** Real editor and styles, with an in-memory action instead of any customer writes. */
export async function buildCenterCatalogBrowserFixture() {
  const root = process.cwd();
  const entryId = resolve(root, 'tests/support/center-catalog.virtual.js');
  const fixture: Plugin = {
    name: 'center-catalog-fixture',
    resolveId(id) { return id === entryId ? `\0${entryId}` : null; },
    load(id) {
      if (id !== `\0${entryId}`) return null;
      return `
        import { createElement } from 'react';
        import { createRoot } from 'react-dom/client';
        import CenterCatalogEditor from '@/components/center-catalog-editor';
        import '@/app/globals.css';
        import '@/app/workspace.css';
        window.centerCatalogFixture = { submissions: [] };
        async function capturePricing(form) {
          window.centerCatalogFixture.submissions.push(Array.from(form.entries(), ([name, value]) => [name, String(value)]));
        }
        const catalog = createElement(CenterCatalogEditor, { centerId: 'fixture-center', products: ${JSON.stringify(CENTER_CATALOG_FIXTURE_PRODUCTS)}, action: capturePricing });
        // Include the customer workspace's actual style wrappers, keeping the
        // isolated fixture focused on the catalog instead of navigation chrome.
        createRoot(document.getElementById('fixture-root')).render(
          createElement('main', { className: 'mx-auto max-w-5xl space-y-6 px-3 py-6 sm:px-6' },
            createElement('h1', { className: 'page-title' }, 'Customer account'),
            createElement('div', { className: 'customer-workspace' },
              createElement('div', { className: 'customer-tab-panel space-y-6' }, catalog)
            )
          )
        );`;
    },
  };
  const result = await build({
    configFile: false,
    root,
    logLevel: 'warn',
    plugins: [fixture],
    resolve: { alias: { '@': root } },
    define: { 'process.env.NODE_ENV': '"production"' },
    oxc: { jsx: { runtime: 'automatic', development: false } },
    build: { write: false, minify: false, lib: { entry: entryId, formats: ['iife'], name: 'CenterCatalogFixture' } },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as unknown as { output: { type: string; code?: string; fileName: string; source?: string | Uint8Array }[] }[];
  const files = outputs.flatMap(item => item.output);
  const javascript = files.filter(item => item.type === 'chunk').map(item => item.code || '').join('\n');
  const css = files.filter(item => item.fileName.endsWith('.css')).map(item => String(item.source || '')).join('\n');
  if (!javascript || !css) throw new Error('Center catalog fixture must include the real editor and application styles.');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sobrew customer catalog · isolated QA fixture</title><style>:root{--font-sans:Arial,sans-serif}${css}</style></head><body><div id="fixture-root"></div><script>${javascript.replaceAll('</script', '<\\/script')}</script></body></html>`;
}
