import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setVapidDetails } from 'web-push';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(projectRoot, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'];
const missing = required.filter(key => !process.env[key]?.trim());
if (missing.length) {
  console.error(`Push setup is incomplete. Missing local .env values: ${missing.join(', ')}`);
  process.exit(1);
}

try {
  setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const url = new URL('/rest/v1/push_subscriptions?select=endpoint&limit=0', process.env.SUPABASE_URL);
  const response = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  if (!response.ok) {
    console.error(`Push setup check failed against Supabase (HTTP ${response.status}). Check the service-role key and run supabase/push_subscriptions.sql.`);
    process.exit(1);
  }
  console.log('Push setup is ready: VAPID keys work and the Supabase subscription table is available.');
} catch (error) {
  console.error(`Push setup check failed: ${error.message}`);
  process.exit(1);
}
