import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/contributions.mjs';
import siteAdmin from '../netlify/functions/site-admin.mjs';
import { createManagerSession } from '../netlify/manager-session.mjs';

const savedEnv = Object.fromEntries(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MANAGER_SESSION_SECRET', 'DEV_MASTER_KEY', 'DEVICE_TOKEN_SECRET'].map(key => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

test.after(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('event setup uploads the optional treasurer photo and saves its public URL', async () => {
  process.env.SUPABASE_URL = 'https://photo-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.MANAGER_SESSION_SECRET = 'photo-test-manager-signing-secret-at-least-32-chars';

  let savedEvent;
  let bucketCreated = false;
  let objectUploaded = false;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/rest/v1/site_settings') return new Response('[{"value":false}]', { status: 200 });
    if (url.pathname === '/rest/v1/contribution_events') {
      if ((options.method || 'GET') === 'GET') return new Response('[]', { status: 200 });
      if (options.method === 'PATCH') return new Response('[]', { status: 200 });
      if (options.method === 'POST') {
        savedEvent = JSON.parse(options.body);
        return new Response('[]', { status: 201 });
      }
    }
    if (url.pathname === '/storage/v1/bucket/treasurer-photos' && !options.method) {
      return new Response('{}', { status: 404 });
    }
    if (url.pathname === '/storage/v1/bucket' && options.method === 'POST') {
      bucketCreated = JSON.parse(options.body).public === true;
      return new Response('{}', { status: 200 });
    }
    if (/^\/storage\/v1\/object\/treasurer-photos\/[0-9a-f-]+\.jpg$/i.test(url.pathname) && options.method === 'POST') {
      objectUploaded = options.headers['Content-Type'] === 'image/jpeg' && Buffer.from(options.body).length === 4;
      return new Response('{}', { status: 200 });
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url.pathname}`);
  };

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
  const payload = {
    action: 'save-event',
    sessionToken: createManagerSession('Manager'),
    title: 'Family gathering',
    description: 'Together in Kigali',
    startDate: '2026-10-20',
    endDate: '2026-10-20',
    targetAmount: 10000,
    treasurerName: 'Treasurer Name',
    treasurerPhone: '0781234567',
    approvalPin: 'valid-pin-123',
    treasurerPhotoData: `data:image/jpeg;base64,${jpeg}`
  };
  const response = await handler(new Request('http://localhost/.netlify/functions/contributions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }));
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(bucketCreated, true);
  assert.equal(objectUploaded, true);
  assert.match(savedEvent.treasurer_photo_url, /^https:\/\/photo-test\.supabase\.co\/storage\/v1\/object\/public\/treasurer-photos\/[0-9a-f-]+\.jpg$/i);
  assert.deepEqual(result, { ok: true, title: 'Family gathering' });
});

test('authenticated developer can replace the active event treasurer photo', async () => {
  process.env.SUPABASE_URL = 'https://photo-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.DEV_MASTER_KEY = 'local-developer-master-key';
  process.env.DEVICE_TOKEN_SECRET = 'photo-test-device-signing-secret-at-least-32-chars';

  let updatedUrl;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/rest/v1/contribution_events' && !options.method) {
      return new Response('[{"id":"22222222-2222-4222-8222-222222222222","active":true}]', { status: 200 });
    }
    if (url.pathname === '/rest/v1/contribution_events' && options.method === 'PATCH') {
      updatedUrl = JSON.parse(options.body).treasurer_photo_url;
      return new Response(JSON.stringify([{ id: '22222222-2222-4222-8222-222222222222', treasurer_photo_url: updatedUrl }]), { status: 200 });
    }
    if (url.pathname === '/storage/v1/bucket/treasurer-photos' && !options.method) return new Response('{}', { status: 404 });
    if (url.pathname === '/storage/v1/bucket' && options.method === 'POST') return new Response('{}', { status: 200 });
    if (/^\/storage\/v1\/object\/treasurer-photos\/[0-9a-f-]+\.jpg$/i.test(url.pathname) && options.method === 'POST') return new Response('{}', { status: 200 });
    throw new Error(`Unexpected developer photo request: ${options.method || 'GET'} ${url.pathname}`);
  };

  const loginResponse = await siteAdmin(new Request('http://localhost/.netlify/functions/site-admin', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'developer-login', developerKey: process.env.DEV_MASTER_KEY })
  }));
  const { token } = await loginResponse.json();
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
  const response = await siteAdmin(new Request('http://localhost/.netlify/functions/site-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      action: 'developer-treasurer-photo',
      eventId: '22222222-2222-4222-8222-222222222222',
      treasurerPhotoData: `data:image/jpeg;base64,${jpeg}`
    })
  }));
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.photoUrl, updatedUrl);
  assert.match(updatedUrl, /\/storage\/v1\/object\/public\/treasurer-photos\//);
});
