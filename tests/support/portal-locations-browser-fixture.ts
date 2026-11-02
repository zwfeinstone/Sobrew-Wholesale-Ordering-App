import { resolve } from 'node:path';
import { build, type Plugin } from 'vite';

/** Bundle the real location form and application styles without a server or customer API. */
export async function buildPortalLocationsBrowserFixture() {
  const root = process.cwd();
  const nextStubs: Plugin = {
    name: 'portal-locations-fixture-next-stubs',
    enforce: 'pre',
    resolveId(id) {
      if (id === 'next/navigation') return '\0portal-locations-fixture:next/navigation';
      return null;
    },
    load(id) {
      if (id !== '\0portal-locations-fixture:next/navigation') return null;
      return `const router={refresh(){window.portalLocationsFixture.refreshCount++;window.portalLocationsFixture.rerender()},push(href){window.portalLocationsFixture.navigation.push(href)},replace(href){window.portalLocationsFixture.navigation.push(href)}};export function useRouter(){return router}`;
    },
  };
  const result = await build({
    configFile: false,
    root,
    logLevel: 'warn',
    plugins: [nextStubs],
    resolve: { alias: { '@': root } },
    define: { 'process.env.NODE_ENV': '"production"' },
    oxc: { jsx: { runtime: 'automatic' } },
    build: {
      write: false,
      minify: false,
      lib: { entry: resolve(root, 'tests/fixtures/portal-locations.fixture.tsx'), formats: ['iife'], name: 'PortalLocationsFixture' },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as unknown as {
    output: { type: string; code?: string; fileName: string; source?: string | Uint8Array }[];
  }[];
  const files = outputs.flatMap((item) => item.output);
  const javascript = files.filter((item) => item.type === 'chunk').map((item) => item.code || '').join('\n');
  const css = files.filter((item) => item.fileName.endsWith('.css')).map((item) => String(item.source || '')).join('\n');
  if (!javascript || !css) throw new Error('Location fixture must include real components and application styles.');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sobrew customer locations · isolated QA fixture</title><style>:root{--font-sans:Arial,sans-serif}${css}</style></head><body><div id="fixture-root"></div><script>${javascript.replaceAll('</script', '<\\/script')}</script></body></html>`;
}
