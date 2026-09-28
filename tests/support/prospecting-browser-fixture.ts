import { resolve } from 'node:path';
import { build, type Plugin } from 'vite';

/** Bundle the actual editor, workspace shell and styles; only routing and server actions are fake. */
export async function buildProspectingBrowserFixture(entry = 'tests/fixtures/prospecting-record.fixture.tsx') {
  const root = process.cwd();
  const nextStubs: Plugin = {
    name: 'prospecting-fixture-next-stubs', enforce: 'pre',
    resolveId(id) { if (id === 'next/link' || id === 'next/navigation') return `\0fixture:${id}`; return null; },
    load(id) {
      if (id === '\0fixture:next/link') return `import {createElement} from 'react'; export default function Link({prefetch,replace,scroll,...props}) {return createElement('a',props)}`;
      if (id === '\0fixture:next/navigation') return `const router={push(href){window.prospectingFixture.navigation=href;window.prospectingFixture.navigate?.(href)},replace(href){window.prospectingFixture.navigation=href;window.prospectingFixture.navigate?.(href,true)},refresh(){window.prospectingFixture.refreshCount++;window.prospectingFixture.refreshRecord()}};export function useRouter(){return router}export function usePathname(){return location.pathname}export function useSearchParams(){return new URLSearchParams(location.search)}`;
      return null;
    },
  };
  const result = await build({ configFile: false, root, logLevel: 'warn', plugins: [nextStubs], resolve: { alias: { '@': root } }, define: { 'process.env.NODE_ENV': '"production"' }, oxc: { jsx: { runtime: 'automatic' } }, build: { write: false, minify: false, lib: { entry: resolve(root, entry), formats: ['iife'], name: 'ProspectingFixture' } } });
  const outputs = (Array.isArray(result) ? result : [result]) as unknown as { output: { type: string; code?: string; fileName: string; source?: string | Uint8Array }[] }[];
  const files = outputs.flatMap((item) => item.output);
  const javascript = files.filter((item) => item.type === 'chunk').map((item) => item.code || '').join('\n');
  const css = files.filter((item) => item.fileName.endsWith('.css')).map((item) => String(item.source || '')).join('\n');
  if (!javascript || !css) throw new Error('Editor fixture did not include its JavaScript and application styles.');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Prospecting editor · isolated QA fixture</title><style>:root{--font-sans:Arial,sans-serif}${css}</style></head><body><div id="fixture-root"></div><script>${javascript.replaceAll('</script', '<\\/script')}</script></body></html>`;
}
