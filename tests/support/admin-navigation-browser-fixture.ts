import { resolve } from 'node:path';
import { build, type Plugin } from 'vite';

/** Actual navigation components and styles; routing, latency and preloads stay in memory. */
export async function buildAdminNavigationBrowserFixture() {
  const root = process.cwd();
  const nextStubs: Plugin = {
    name: 'admin-navigation-fixture-next-stubs',
    enforce: 'pre',
    resolveId(id) { return id === 'next/link' || id === 'next/navigation' ? `\0navigation-fixture:${id}` : null; },
    load(id) {
      if (id === '\0navigation-fixture:next/link') return `
        import {createElement} from 'react';
        export default function Link({prefetch,replace,scroll,onNavigate,onClick,href,...props}) {
          return createElement('a',{...props,href,onClick(event){
            onClick?.(event);
            if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey||props.download||props.target&&props.target!=='_self')return;
            if(new URL(href,location.href).origin!==location.origin)return;
            let prevented=false;
            onNavigate?.({preventDefault(){prevented=true}});
            event.preventDefault();
            if(!prevented)window.adminNavigationFixture.navigate(href,replace?'replace':'push');
          }},props.children);
        }`;
      if (id === '\0navigation-fixture:next/navigation') return `
        import {useSyncExternalStore} from 'react';
        const router={push(href){window.adminNavigationFixture.navigate(href,'push')},replace(href){window.adminNavigationFixture.navigate(href,'replace')},refresh(){window.adminNavigationFixture.retry()}};
        const subscribe=(listener)=>window.adminNavigationFixture.subscribe(listener);
        const snapshot=()=>window.adminNavigationFixture.renderedHref;
        export function useRouter(){return router}
        export function usePathname(){return new URL(useSyncExternalStore(subscribe,snapshot,snapshot),location.href).pathname}
        export function useSearchParams(){return new URL(useSyncExternalStore(subscribe,snapshot,snapshot),location.href).searchParams}`;
      return null;
    },
  };
  const result = await build({
    configFile: false, root, logLevel: 'warn', plugins: [nextStubs],
    resolve: { alias: { '@': root } }, define: { 'process.env.NODE_ENV': '"production"' },
    // Vitest sets NODE_ENV=test; match the explicitly bundled production React.
    oxc: { jsx: { runtime: 'automatic', development: false } },
    build: { write: false, minify: false, lib: { entry: resolve(root, 'tests/fixtures/admin-navigation.fixture.tsx'), formats: ['iife'], name: 'AdminNavigationFixture' } },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as unknown as { output: { type: string; code?: string; fileName: string; source?: string | Uint8Array }[] }[];
  const files = outputs.flatMap((item) => item.output);
  const javascript = files.filter((item) => item.type === 'chunk').map((item) => item.code || '').join('\n');
  const css = files.filter((item) => item.fileName.endsWith('.css')).map((item) => String(item.source || '')).join('\n');
  if (!javascript || !css) throw new Error('Navigation fixture must include actual navigation components and application styles.');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Admin navigation · isolated QA fixture</title><style>:root{--font-sans:Arial,sans-serif}${css}</style></head><body><div id="fixture-root"></div><script>${javascript.replaceAll('</script', '<\\/script')}</script></body></html>`;
}
