import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateVAPIDKeys } from 'web-push';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(projectRoot, '.env');
let lines = [];
try {
  lines = (await readFile(envPath, 'utf8')).split(/\r?\n/).filter(Boolean);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const getValue = name => lines.find(line => line.startsWith(`${name}=`))?.slice(name.length + 1).trim() || '';
const values = new Map();
if (!getValue('VAPID_PUBLIC_KEY') || !getValue('VAPID_PRIVATE_KEY')) {
  const keys = generateVAPIDKeys();
  values.set('VAPID_PUBLIC_KEY', keys.publicKey);
  values.set('VAPID_PRIVATE_KEY', keys.privateKey);
}
if (!getValue('VAPID_SUBJECT')) values.set('VAPID_SUBJECT', 'mailto:you@example.com');
if (!getValue('MANAGER_SESSION_SECRET') || getValue('MANAGER_SESSION_SECRET').length < 32) {
  values.set('MANAGER_SESSION_SECRET', randomBytes(32).toString('base64url'));
}
if (!getValue('UMUKOMITE_PASSWORD')) {
  values.set('UMUKOMITE_PASSWORD', randomBytes(24).toString('base64url'));
}
for (const [name, value] of values) {
  const index = lines.findIndex(line => line.startsWith(`${name}=`));
  const setting = `${name}=${value}`;
  if (index < 0) lines.push(setting);
  else lines[index] = setting;
}
await writeFile(envPath, `${lines.join('\n')}\n`, 'utf8');
console.log('Local push and manager credentials are ready in the ignored .env file. Existing keys were preserved; no secret values were printed.');
