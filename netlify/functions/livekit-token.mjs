import { AccessToken } from 'livekit-server-sdk';
import { randomUUID } from 'node:crypto';
import { verifyManagerSession } from '../manager-session.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }
});

function getConfig() {
  const serverUrl = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
  const roomName = process.env.LIVEKIT_ROOM_NAME?.trim() || 'drama-team-family';
  let validServerUrl = false;
  try {
    const parsed = new URL(serverUrl);
    validServerUrl = parsed.protocol === 'wss:' || parsed.protocol === 'https:';
  } catch { /* Report invalid configuration through the health response. */ }
  return { serverUrl, apiKey, apiSecret, roomName, validServerUrl };
}

export default async function handler(request) {
  const config = getConfig();
  const configured = Boolean(config.validServerUrl && config.apiKey && config.apiSecret);

  if (request.method === 'GET') {
    return json({
      ok: configured,
      configured,
      serverUrl: config.serverUrl || null,
      roomName: config.roomName,
      message: configured ? 'LiveKit environment is configured.' : 'Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET on the server.'
    }, configured ? 200 : 503);
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  if (!configured) {
    return json({ error: 'LiveKit is not configured on the server. Add the LIVEKIT environment variables and restart the site.' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400);
  }

  const requestedRole = body?.role === 'umukomite' ? 'umukomite' : 'umufamiliye';
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : '';
  const deviceToken = typeof body?.deviceToken === 'string' ? body.deviceToken : '';
  if (!/^[0-9a-f-]{36}$/i.test(deviceId) || !deviceToken) return json({ error: 'This device is not registered. Refresh and try again.' }, 401);
  let deviceState;
  try {
    const admin = (await import('./site-admin.mjs')).default;
    const check = await admin(new Request('http://localhost/.netlify/functions/site-admin', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'device-state', deviceId, deviceToken }) }));
    deviceState = await check.json();
    if (!check.ok) return json({ error: deviceState.error || 'Device access denied.' }, check.status);
  } catch { return json({ error: 'Could not verify device access.' }, 503); }
  if (deviceState.paused || deviceState.blocked) return json({ error: deviceState.paused ? 'Website temporarily paused.' : 'This device is blocked.' }, 403);
  if (deviceState.bannedFromMeet) return json({ error: 'This device is permanently banned from live meetings.' }, 403);
  let managerSession = null;
  if (requestedRole === 'umukomite') {
    try { managerSession = verifyManagerSession(body?.managerSessionToken); }
    catch { return json({ error: 'Manager sign-in is not configured on the server.' }, 503); }
  }
  if (requestedRole === 'umukomite' && !managerSession) {
    return json({ error: 'Manager sign-in has expired. Sign in again to join as Umukomite.' }, 401);
  }

  const name = requestedRole === 'umukomite'
    ? String(managerSession.name || '').trim().slice(0, 80)
    : typeof body?.name === 'string' ? body.name.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80) : '';
  if (!name) return json({ error: 'Enter your name before joining.' }, 400);

  try {
    const role = requestedRole;
    const prefix = role === 'umukomite' ? 'manager' : 'member';
    const identity = `${prefix}-${name.replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 50) || 'guest'}-${randomUUID().slice(0, 8)}`;
    const accessToken = new AccessToken(config.apiKey, config.apiSecret, {
      identity,
      name,
      metadata: JSON.stringify({ role }),
      ttl: '10m'
    });
    accessToken.addGrant({
      roomJoin: true,
      room: config.roomName,
      canPublish: true,
      canSubscribe: true
    });
    const token = await accessToken.toJwt();
    return json({ token, serverUrl: config.serverUrl, roomName: config.roomName });
  } catch (error) {
    console.error('LiveKit token creation failed:', error);
    return json({ error: 'The server could not create a LiveKit room token. Check the server-side API credentials.' }, 500);
  }
}
