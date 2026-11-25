const MAX_BODY_LENGTH = 12_000;

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
  if (!rawUrl || !serviceKey) {
    throw new Error('Contact message storage needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new Error('Contact message storage requires an HTTPS Supabase URL.');
  return { supabaseUrl: url.origin, serviceKey };
}

function isValidEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function insertContactMessage(config, message) {
  const authHeaders = config.serviceKey.startsWith('sb_secret_')
    ? {}
    : { Authorization: `Bearer ${config.serviceKey}` };
  const response = await fetch(`${config.supabaseUrl}/rest/v1/contact_messages`, {
    method: 'POST',
    headers: {
      apikey: config.serviceKey,
      ...authHeaders,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(message)
  });

  const text = await response.text();
  let result = null;
  try { result = text ? JSON.parse(text) : null; } catch { /* handled below */ }
  if (!response.ok) {
    const code = typeof result?.code === 'string' ? result.code : `HTTP ${response.status}`;
    console.error(`Supabase contact message insert failed (${code}).`);
    throw new Error('The message could not be saved. Please try again.');
  }
  return Array.isArray(result) ? result[0] : result;
}

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return json({ error: 'Send the contact form as JSON.' }, 415);
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_LENGTH) return json({ error: 'Your message is too long.' }, 413);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'The contact form request was not valid JSON.' }, 400); }

  // Quietly accept bot submissions that fill the hidden honeypot field.
  if (typeof body?.companyWebsite === 'string' && body.companyWebsite.trim()) {
    return json({ ok: true });
  }

  const name = typeof body?.name === 'string'
    ? body.name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
    : '';
  const email = typeof body?.email === 'string' && body.email.trim() ? body.email.trim() : null;
  const message = typeof body?.message === 'string' ? body.message.replace(/\u0000/g, '').trim() : '';

  if (!name || name.length > 80) return json({ error: 'Enter a name up to 80 characters long.' }, 400);
  if (email && !isValidEmail(email)) return json({ error: 'Enter a valid reply email address.' }, 400);
  if (!message || message.length > 5000) return json({ error: 'Enter a message of 1 to 5,000 characters.' }, 400);

  let config;
  try { config = getSupabaseConfig(); }
  catch (error) {
    console.error(error.message);
    return json({ error: 'Contact messages are not configured on the server yet.' }, 503);
  }

  try {
    const saved = await insertContactMessage(config, { name, email, message });
    return json({ ok: true, id: saved?.id || null, message: 'Your message was saved.' });
  } catch (error) {
    console.error('Contact form submission failed:', error.message);
    return json({ error: 'Your message could not be saved. Please try again.' }, 503);
  }
}
