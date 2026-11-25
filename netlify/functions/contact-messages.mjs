import { verifyManagerSession } from '../manager-session.mjs';

const PAGE_SIZE = 50;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function getSupabaseConfig() {
  const rawUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!rawUrl || !serviceKey) throw new Error('Supabase manager access is not configured.');

  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new Error('Supabase manager access requires HTTPS.');
  return { supabaseUrl: url.origin, serviceKey };
}

function supabaseHeaders(config, extra = {}) {
  return {
    apikey: config.serviceKey,
    ...(config.serviceKey.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${config.serviceKey}` }),
    ...extra
  };
}

async function supabaseRequest(config, pathname, options = {}) {
  const response = await fetch(`${config.supabaseUrl}${pathname}`, {
    ...options,
    headers: supabaseHeaders(config, {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    })
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { /* handled below */ }
  if (!response.ok) {
    const code = typeof payload?.code === 'string' ? payload.code : `HTTP ${response.status}`;
    console.error(`Supabase contact inbox request failed (${code}).`);
    throw new Error('Could not access the contact inbox.');
  }
  return payload;
}

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return json({ error: 'Send the manager request as JSON.' }, 415);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Request body must be valid JSON.' }, 400); }
  let managerSession = null;
  try { managerSession = verifyManagerSession(body?.sessionToken || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')); }
  catch { managerSession = null; }
  if (!managerSession) return json({ error: 'A valid Umukomite sign-in is required.' }, 401);

  let config;
  try { config = getSupabaseConfig(); }
  catch (error) {
    console.error(error.message);
    return json({ error: 'The contact inbox is not configured on the server yet.' }, 503);
  }

  try {
    if (body.action === 'list') {
      const offset = Number.isSafeInteger(body.offset) && body.offset >= 0 && body.offset <= 1_000_000
        ? body.offset
        : 0;
      const query = new URLSearchParams({
        select: 'id,name,message,created_at,read_at',
        order: 'created_at.desc',
        limit: String(PAGE_SIZE + 1),
        offset: String(offset)
      });
      const rows = await supabaseRequest(config, `/rest/v1/contact_messages?${query}`);
      const messages = Array.isArray(rows) ? rows : [];
      const hasMore = messages.length > PAGE_SIZE;
      return json({ messages: messages.slice(0, PAGE_SIZE), hasMore, offset });
    }

    if (body.action === 'mark-read') {
      const id = typeof body.id === 'string' ? body.id : '';
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Choose a valid contact message.' }, 400);
      const query = new URLSearchParams({ id: `eq.${id}`, select: 'id,read_at' });
      const rows = await supabaseRequest(config, `/rest/v1/contact_messages?${query}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ read_at: new Date().toISOString() })
      });
      if (!Array.isArray(rows) || !rows.length) return json({ error: 'That message no longer exists.' }, 404);
      return json({ ok: true, message: rows[0] });
    }

    return json({ error: 'Choose a valid contact inbox action.' }, 400);
  } catch (error) {
    console.error('Contact inbox request failed:', error.message);
    return json({ error: 'Could not access the contact inbox. Please try again.' }, 503);
  }
}
