import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/livekit-token.mjs';
import { createManagerSession } from '../netlify/manager-session.mjs';

const envKeys = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'LIVEKIT_ROOM_NAME'];
const savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

test.beforeEach(() => {
  process.env.LIVEKIT_URL = 'wss://unit-test.livekit.cloud';
  process.env.LIVEKIT_API_KEY = 'test-api-key';
  process.env.LIVEKIT_API_SECRET = 'test-api-secret-that-is-long-enough';
  process.env.LIVEKIT_ROOM_NAME = 'test-room';
});

test.after(() => {
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

test('GET reports server-side LiveKit configuration without exposing the secret', async () => {
  const response = await handler(new Request('http://localhost/.netlify/functions/livekit-token'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.configured, true);
  assert.equal(body.serverUrl, 'wss://unit-test.livekit.cloud');
  assert.equal(body.roomName, 'test-room');
  assert.equal(JSON.stringify(body).includes(process.env.LIVEKIT_API_SECRET), false);
});

test('POST creates a short-lived token scoped to the configured room', async () => {
  const response = await handler(new Request('http://localhost/.netlify/functions/livekit-token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test Guest' })
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.serverUrl, 'wss://unit-test.livekit.cloud');
  assert.equal(body.roomName, 'test-room');
  const claims = JSON.parse(Buffer.from(body.token.split('.')[1], 'base64url').toString('utf8'));
  assert.match(claims.sub, /^member-Test_Guest-[a-f0-9]{8}$/);
  assert.equal(claims.name, 'Test Guest');
  assert.equal(claims.video.room, 'test-room');
  assert.equal(claims.video.roomJoin, true);
  assert.equal(claims.video.canPublish, true);
  assert.equal(claims.video.canSubscribe, true);
  assert.ok(claims.exp > Math.floor(Date.now() / 1000));
});

test('Umukomite token requires and carries a verified manager role', async () => {
  const sessionToken = createManagerSession('Test Manager');
  const response = await handler(new Request('http://localhost/.netlify/functions/livekit-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'umukomite', managerSessionToken: sessionToken })
  }));
  const body = await response.json();
  const claims = JSON.parse(Buffer.from(body.token.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(response.status, 200);
  assert.match(claims.sub, /^manager-Test_Manager-[a-f0-9]{8}$/);
  assert.equal(claims.metadata, JSON.stringify({ role: 'umukomite' }));
  assert.equal(claims.video.roomAdmin, undefined);
});

test('Umukomite role without a valid session cannot mint a manager token', async () => {
  for (const body of [{ role: 'umukomite' }, { role: 'umukomite', managerSessionToken: 'a.b.c' }]) {
    const response = await handler(new Request('http://localhost/.netlify/functions/livekit-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }));
    assert.equal(response.status, 401);
  }
});

test('POST rejects an empty participant name', async () => {
  const response = await handler(new Request('http://localhost/.netlify/functions/livekit-token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '  ' })
  }));
  assert.equal(response.status, 400);
});

test('missing server credentials fail the config check safely', async () => {
  delete process.env.LIVEKIT_API_SECRET;
  const response = await handler(new Request('http://localhost/.netlify/functions/livekit-token'));
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.configured, false);
});
