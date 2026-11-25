import { createManagerSession } from '../manager-session.mjs';
import { config, db } from '../contributions-api.mjs';
import { timingSafeEqual } from 'node:crypto';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Request body must be valid JSON.' }, 400); }

  const name = typeof body?.name === 'string' ? body.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  let expectedPassword = null;
  try {
    const cfg = config();
    const rows = await db(cfg, 'site_settings', 'select=value&key=eq.umukomite_password&limit=1');
    const stored = rows?.[0]?.value;
    if (typeof stored === 'string' && stored.trim()) expectedPassword = stored;
  } catch (error) {
    if (process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      console.error('Could not read the configured Umukomite password:', error.message);
      return json({ error: 'Manager password settings could not be read from Supabase.' }, 503);
    }
  }
  if (expectedPassword === null) expectedPassword = process.env.UMUKOMITE_PASSWORD?.trim() || null;
  const expectedBytes = expectedPassword === null ? Buffer.alloc(0) : Buffer.from(expectedPassword);
  const suppliedBytes = Buffer.from(password);
  const passwordValid = expectedPassword !== null && suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
  if (!name || !passwordValid) {
    return json({ error: 'Incorrect Umukomite name or password.' }, 401);
  }

  try {
    return json({ sessionToken: createManagerSession(name), expiresIn: 8 * 60 * 60 });
  } catch (error) {
    console.error('Could not issue manager session:', error.message);
    return json({ error: 'Manager sign-in could not be completed.' }, 503);
  }
}
