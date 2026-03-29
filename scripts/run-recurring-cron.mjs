import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && !process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.resolve('.env.local'));

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
const cronSecret = process.env.CRON_SECRET;

if (!cronSecret) {
  console.error('Missing CRON_SECRET. Add it to .env.local before running this script.');
  process.exit(1);
}

const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/cron/recurring-orders`, {
  method: 'POST',
  headers: {
    'x-cron-secret': cronSecret,
  },
});

const body = await response.text();

if (!response.ok) {
  console.error(`Recurring cron failed: ${response.status} ${response.statusText}`);
  console.error(body);
  process.exit(1);
}

console.log(body);
