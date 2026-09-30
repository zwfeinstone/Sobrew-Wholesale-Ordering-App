import { resolve } from 'node:path';
import { build, type Plugin } from 'vite';

/** Bundle real checkout/receipt components and styles with no application server or order API. */
export async function buildCheckoutBrowserFixture() {
  const root = process.cwd();
  const browserStubs: Plugin = {
    name: 'checkout-fixture-browser-stubs',
    enforce: 'pre',
    resolveId(id) {
      if (id === 'next/link' || id === 'next/navigation' || id === '@/lib/analytics') return `\0checkout-fixture:${id}`;
      return null;
    },
    load(id) {
      if (id === '\0checkout-fixture:next/link') return `import {createElement} from 'react'; export default function Link({prefetch,replace,scroll,...props}) {return createElement('a',props)}`;
      if (id === '\0checkout-fixture:next/navigation') return `const router={push(href){location.assign(href)},replace(href){location.replace(href)},refresh(){location.reload()}};export function useRouter(){return router}export function usePathname(){return location.pathname}export function useSearchParams(){return new URLSearchParams(location.search)}`;
      if (id === '\0checkout-fixture:@/lib/analytics') return 'export function trackProductEvent() {}';
      return null;
    },
  };
  const result = await build({
    configFile: false,
    root,
    logLevel: 'warn',
    plugins: [browserStubs],
    resolve: { alias: { '@': root } },
    define: { 'process.env.NODE_ENV': '"production"' },
    oxc: { jsx: { runtime: 'automatic' } },
    build: { write: false, minify: false, lib: { entry: resolve(root, 'tests/fixtures/checkout.fixture.tsx'), formats: ['iife'], name: 'CheckoutFixture' } },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as unknown as { output: { type: string; code?: string; fileName: string; source?: string | Uint8Array }[] }[];
  const files = outputs.flatMap((item) => item.output);
  const javascript = files.filter((item) => item.type === 'chunk').map((item) => item.code || '').join('\n');
  const css = files.filter((item) => item.fileName.endsWith('.css')).map((item) => String(item.source || '')).join('\n');
  if (!javascript || !css) throw new Error('Checkout fixture must include real components and application styles.');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sobrew order confirmation · isolated QA fixture</title><style>:root{--font-sans:Arial,sans-serif}${css}</style></head><body><div id="fixture-root"></div><script>${javascript.replaceAll('</script', '<\\/script')}</script></body></html>`;
}
