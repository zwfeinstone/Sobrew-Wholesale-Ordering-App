import { resolve } from 'node:path';
import { build } from 'vite';

export async function buildPasswordSafetyBrowserFixture() {
  const root = process.cwd();
  const result = await build({
    configFile: false, root, logLevel: 'warn',
    resolve: { alias: { '@': root } },
    define: { 'process.env.NODE_ENV': '"production"' },
    oxc: { jsx: { runtime: 'automatic' } },
    build: { write: false, minify: false, lib: { entry: resolve(root, 'tests/fixtures/password-safety.fixture.tsx'), formats: ['iife'], name: 'PasswordSafetyFixture' } },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as unknown as { output: { type: string; code?: string; fileName: string; source?: string | Uint8Array }[] }[];
  const files = outputs.flatMap((item) => item.output);
  const javascript = files.filter((item) => item.type === 'chunk').map((item) => item.code || '').join('\n');
  const css = files.filter((item) => item.fileName.endsWith('.css')).map((item) => String(item.source || '')).join('\n');
  if (!javascript || !css) throw new Error('Password fixture must include real forms and styles.');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Password safety QA</title><style>:root{--font-sans:Arial,sans-serif}${css}</style></head><body><div id="fixture-root"></div><script>${javascript.replaceAll('</script', '<\\/script')}</script></body></html>`;
}
