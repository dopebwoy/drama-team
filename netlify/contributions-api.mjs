import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { verifyManagerSession } from './manager-session.mjs';

export const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

export function config() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error('Supabase is not configured.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Supabase must use HTTPS.');
  return { url: parsed.origin, key };
}

export async function db(cfg, table, query = '', options = {}) {
  const response = await fetch(`${cfg.url}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    ...options,
    headers: {
      apikey: cfg.key,
      ...(cfg.key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${cfg.key}` }),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const code = typeof payload?.code === 'string' ? ` ${payload.code}` : '';
    const detail = typeof payload?.message === 'string' ? payload.message : typeof payload?.hint === 'string' ? payload.hint : 'Request was rejected.';
    throw new Error(`Supabase ${table} request failed (${response.status}${code}): ${detail}`);
  }
  return payload;
}

const TREASURER_PHOTO_BUCKET = 'treasurer-photos';
const TREASURER_PHOTO_MAX_BYTES = 512 * 1024;

function storageHeaders(cfg, extra = {}) {
  return {
    apikey: cfg.key,
    ...(cfg.key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${cfg.key}` }),
    ...extra
  };
}

async function storageError(response) {
  let detail = 'Request was rejected.';
  try {
    const payload = await response.json();
    detail = payload?.message || payload?.error || payload?.statusCode || detail;
  } catch {}
  return new Error(`Supabase Storage request failed (${response.status}): ${String(detail).slice(0, 220)}`);
}

async function ensureTreasurerPhotoBucket(cfg) {
  const endpoint = `${cfg.url}/storage/v1/bucket/${TREASURER_PHOTO_BUCKET}`;
  const existingResponse = await fetch(endpoint, { headers: storageHeaders(cfg) });
  if (existingResponse.ok) {
    const existing = await existingResponse.json();
    if (existing?.public === true) return;
    const updated = await fetch(endpoint, {
      method: 'PUT',
      headers: storageHeaders(cfg, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ public: true, file_size_limit: TREASURER_PHOTO_MAX_BYTES, allowed_mime_types: ['image/jpeg', 'image/webp'] })
    });
    if (!updated.ok) throw await storageError(updated);
    return;
  }
  if (existingResponse.status !== 404) throw await storageError(existingResponse);

  const created = await fetch(`${cfg.url}/storage/v1/bucket`, {
    method: 'POST',
    headers: storageHeaders(cfg, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      id: TREASURER_PHOTO_BUCKET,
      name: TREASURER_PHOTO_BUCKET,
      public: true,
      file_size_limit: TREASURER_PHOTO_MAX_BYTES,
      allowed_mime_types: ['image/jpeg', 'image/webp']
    })
  });
  if (created.ok) return;
  // Another simultaneous upload may have created the dedicated bucket first.
  if (created.status === 409) {
    const afterCreate = await fetch(endpoint, { headers: storageHeaders(cfg) });
    if (afterCreate.ok && (await afterCreate.json())?.public === true) return;
  }
  throw await storageError(created);
}

export async function uploadTreasurerPhoto(cfg, dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > 760_000) {
    throw new Error('Choose a smaller treasurer photo (maximum 512 KB after compression).');
  }
  const match = /^data:image\/(jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error('Treasurer photo must be a compressed JPEG or WebP image.');
  const mime = `image/${match[1]}`;
  const bytes = Buffer.from(match[2], 'base64');
  const isJpeg = mime === 'image/jpeg' && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp = mime === 'image/webp' && bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!bytes.length || bytes.length > TREASURER_PHOTO_MAX_BYTES || (!isJpeg && !isWebp)) {
    throw new Error('Treasurer photo must be a valid JPEG or WebP no larger than 512 KB.');
  }

  await ensureTreasurerPhotoBucket(cfg);
  const extension = mime === 'image/jpeg' ? 'jpg' : 'webp';
  const objectName = `${randomUUID()}.${extension}`;
  const uploaded = await fetch(`${cfg.url}/storage/v1/object/${TREASURER_PHOTO_BUCKET}/${objectName}`, {
    method: 'POST',
    headers: storageHeaders(cfg, {
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'x-upsert': 'true'
    }),
    body: bytes
  });
  if (!uploaded.ok) throw await storageError(uploaded);
  return `${cfg.url}/storage/v1/object/public/${TREASURER_PHOTO_BUCKET}/${objectName}`;
}

export function manager(request, body) {
  return verifyManagerSession(body?.sessionToken || request.headers.get('authorization')?.replace(/^Bearer\s+/i, ''));
}

export async function sitePaused(cfg) {
  const rows = await db(cfg, 'site_settings', 'select=value&key=eq.site_paused&limit=1');
  return rows?.[0]?.value === true || rows?.[0]?.value === 'true';
}

export function verifyDeviceToken(deviceId, token) {
  const key = process.env.DEVICE_TOKEN_SECRET?.trim();
  if (!key || key.length < 32 || typeof token !== 'string') return false;
  const [expires, signature, extra] = token.split('.');
  if (extra || !/^\d+$/.test(expires) || Number(expires) <= Date.now() / 1000 || Number(expires) > Date.now() / 1000 + 31 * 86400) return false;
  const expected = createHmac('sha256', key).update(`${deviceId}.${expires}`).digest('base64url');
  const a = Buffer.from(signature || ''), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function enforceRequest(request) {
  let cfg;
  try { cfg = config(); } catch { return { error: json({ error: 'Site enforcement is not configured.' }, 503) }; }
  let paused;
  try { paused = await sitePaused(cfg); } catch { return { error: json({ error: 'Site status is unavailable; requests are paused until it can be checked.' }, 503) }; }
  if (paused) return { error: json({ error: 'Website temporarily paused.' }, 503) };
  const deviceId = request.headers.get('x-dtf-device-id');
  if (!deviceId) return { cfg };
  if (!/^[0-9a-f-]{36}$/i.test(deviceId) || !verifyDeviceToken(deviceId, request.headers.get('x-dtf-device-token'))) {
    return { error: json({ error: 'A valid registered device is required.' }, 401) };
  }
  const rows = await db(cfg, 'device_registry', `select=is_blocked,is_banned_from_meet&device_id=eq.${deviceId}&limit=1`);
  if (!rows?.length) return { error: json({ error: 'Device is not registered.' }, 401) };
  const device = rows[0];
  if (device.is_blocked) return { error: json({ error: 'This device is blocked.' }, 403) };
  if (device.is_banned_from_meet && new URL(request.url).pathname.endsWith('/livekit-token')) return { error: json({ error: 'This device is banned from meetings.' }, 403) };
  return { cfg, device, deviceId };
}

export function cleanString(value, max = 255) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
}

export function uuid() { return randomUUID(); }

export function summarizeLedger(event, payments = []) {
  const rows = Array.isArray(payments) ? payments : [];
  const approvedTotal = rows.filter(row => row.status === 'approved')
    .reduce((total, row) => total + Number(row.verified_amount || 0), 0);
  const pendingTotal = rows.filter(row => row.status === 'pending')
    .reduce((total, row) => total + Number(row.claimed_amount || 0), 0);
  const targetAmount = Number(event?.target_amount || 0);
  return { approvedTotal, pendingTotal, targetAmount, remaining: Math.max(0, targetAmount - approvedTotal) };
}

export function hashTreasurerPin(pin) {
  if (typeof pin !== 'string' || pin.length < 6 || pin.length > 128) throw new Error('Treasurer Approval PIN must be 6 to 128 characters.');
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pin, salt, 64).toString('hex');
  return { approval_pin_salt: salt, approval_pin_hash: hash };
}

export function verifyTreasurerPin(pin, salt, hash) {
  if (typeof pin !== 'string' || typeof salt !== 'string' || typeof hash !== 'string' || !/^[0-9a-f]{32}$/.test(salt) || !/^[0-9a-f]{128}$/.test(hash)) return false;
  const actual = scryptSync(pin, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
