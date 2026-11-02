import { resolve } from 'node:path';
import { build, type Plugin } from 'vite';

/** Real production form and styles; all actions and navigation stay in memory. */
export async function buildMaterialFallbackBrowserFixture() {
  const root = process.cwd();
  const nextStubs: Plugin = {
    name: 'material-fallback-fixture-next-stubs',
    enforce: 'pre',
    resolveId(id) { return id === 'next/link' ? '\0material-fallback-fixture:next/link' : null; },
    load(id) {
      if (id !== '\0material-fallback-fixture:next/link') return null;
      return `import{createElement}from'react';export default function Link({href,children,...props}){return createElement('a',{...props,href,onClick(event){event.preventDefault();window.materialFallbackFixture.navigation.push(href)}},children)}`;
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
      lib: { entry: resolve(root, 'tests/fixtures/material-fallback.fixture.tsx'), formats: ['iife'], name: 'MaterialFallbackFixture' },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as unknown as {
    output: { type: string; code?: string; fileName: string; source?: string | Uint8Array }[];
  }[];
  const files = outputs.flatMap((item) => item.output);
  const javascript = files.filter((item) => item.type === 'chunk').map((item) => item.code || '').join('\n');
  const css = files.filter((item) => item.fileName.endsWith('.css')).map((item) => String(item.source || '')).join('\n');
  if (!javascript || !css) throw new Error('Material fallback fixture must include the real production form and application styles.');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sobrew material fallbacks · isolated QA</title><style>:root{--font-sans:Arial,sans-serif}${css}</style></head><body><div id="fixture-root"></div><script>${javascript.replaceAll('</script', '<\\/script')}</script></body></html>`;
}
