import { spawnSync } from 'node:child_process';
import { writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Regenerate without truncating the checked-in file if the CLI or network fails.
const result = spawnSync('supabase', [
  'gen', 'types', 'typescript', '--project-id', 'ovrzooxvvernqqcotpkv', '--schema', 'public',
], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
if (result.error || result.status !== 0 || !result.stdout.includes('export type Database')) {
  console.error(result.error?.code === 'ENOENT'
    ? 'Install and authenticate the Supabase CLI before running npm run db:types.'
    : result.stderr || result.error?.message || 'Database type generation failed.');
  process.exit(1);
}
const destination = fileURLToPath(new URL('../lib/supabase/database.types.ts', import.meta.url));
const temporary = `${destination}.tmp`;
writeFileSync(temporary, '// Generated from the Sobrew Supabase schema. Regenerate with npm run db:types.\n' + result.stdout);
renameSync(temporary, destination);
