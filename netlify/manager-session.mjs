import { createHmac, timingSafeEqual } from 'node:crypto';

function secret() {
  const value = process.env.MANAGER_SESSION_SECRET?.trim();
  if (!value || value.length < 32) throw new Error('Manager sessions are not configured on the server.');
  return value;
}

function sign(value) {
  return createHmac('sha256', secret()).update(value).digest('base64url');
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createManagerSession(name, lifetimeSeconds = 8 * 60 * 60) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role: 'umukomite', name, iat: now, exp: now + lifetimeSeconds })).toString('base64url');
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign(unsigned)}`;
}

export function verifyManagerSession(token) {
  if (typeof token !== 'string') return null;
  const [header, payload, signature, extra] = token.split('.');
  if (!header || !payload || !signature || extra !== undefined) return null;
  const unsigned = `${header}.${payload}`;
  if (!constantTimeEqual(signature, sign(unsigned))) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (claims.role !== 'umukomite' || typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

export function isManagerPasswordValid(candidate) {
  const expected = process.env.UMUKOMITE_PASSWORD;
  if (typeof candidate !== 'string' || !expected) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
