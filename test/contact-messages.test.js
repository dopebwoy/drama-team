import test from 'node:test';
import assert from 'node:assert/strict';
import contactMessages from '../netlify/functions/contact-messages.mjs';
import { createManagerSession } from '../netlify/manager-session.mjs';

test('contact inbox requires a signed Umukomite session and lists messages without an inbox password', async () => {
  const envKeys = ['MANAGER_SESSION_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CONTACT_INBOX_PASSWORD'];
  const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  try {
    process.env.MANAGER_SESSION_SECRET = 'manager-session-secret-for-contact-inbox-test';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_contact_inbox_test';
    delete process.env.CONTACT_INBOX_PASSWORD;

    globalThis.fetch = async url => {
      assert.match(String(url), /^https:\/\/example\.supabase\.co\/rest\/v1\/contact_messages\?/);
      return new Response(JSON.stringify([{ id: 'message-1', name: 'Test Member', message: 'Hello', created_at: '2026-01-01T12:00:00Z', read_at: null }]), { status: 200 });
    };

    const unauthorized = await contactMessages(new Request('http://localhost/.netlify/functions/contact-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list' })
    }));
    assert.equal(unauthorized.status, 401);

    const response = await contactMessages(new Request('http://localhost/.netlify/functions/contact-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', sessionToken: createManagerSession('Test Umukomite') })
    }));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.messages[0].name, 'Test Member');
    assert.equal(result.messages[0].message, 'Hello');
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
});
