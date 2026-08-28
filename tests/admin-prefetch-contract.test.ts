import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const activeNavLink = readFileSync(
  fileURLToPath(new URL('../components/active-nav-link.tsx', import.meta.url)),
  'utf8'
);
const adminShell = readFileSync(
  fileURLToPath(new URL('../components/admin-shell.tsx', import.meta.url)),
  'utf8'
);

describe('admin navigation prefetch contract', () => {
  it('disables automatic prefetch for the large protected admin sidebar only', () => {
    expect(activeNavLink).toContain('prefetch?: boolean');
    expect(activeNavLink).toContain('prefetch={prefetch}');
    expect(adminShell).toMatch(/<ActiveNavLink[\s\S]*?href=\{href\}[\s\S]*?prefetch=\{false\}/u);
  });
});
