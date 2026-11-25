import test from 'node:test';
import assert from 'node:assert/strict';
import { canManagerRemoveParticipant, participantRole } from '../netlify/moderation-policy.mjs';
import { createManagerSession, isManagerPasswordValid, verifyManagerSession } from '../netlify/manager-session.mjs';
import managerLogin from '../netlify/functions/manager-login.mjs';

test('only Umufamiliye participants can be removed by Umukomite', () => {
  const member = { identity: 'member-guest-1', metadata: '{"role":"umufamiliye"}' };
  const manager = { identity: 'manager-host-1', metadata: '{"role":"umukomite"}' };
  const unknown = { identity: 'legacy-guest' };

  assert.equal(canManagerRemoveParticipant(member), true);
  assert.equal(canManagerRemoveParticipant(manager), false);
  assert.equal(canManagerRemoveParticipant(unknown), false);
  assert.equal(participantRole({ identity: 'member-older-client' }), 'umufamiliye');
  assert.equal(participantRole({ identity: 'manager-older-client' }), 'umukomite');
});

test('manager sessions use configured signing and password secrets', () => {
  process.env.MANAGER_SESSION_SECRET='m'.repeat(40);
  process.env.UMUKOMITE_PASSWORD='private-manager-passphrase';
  const token = createManagerSession('Test manager');
  assert.equal(verifyManagerSession(token)?.name, 'Test manager');
  assert.equal(verifyManagerSession(`${token.slice(0, -1)}x`), null);
  assert.equal(verifyManagerSession(createManagerSession('Expired', 0)), null);
  assert.equal(isManagerPasswordValid('private-manager-passphrase'), true);
  assert.equal(isManagerPasswordValid('incorrect'), false);
});

test('Umukomite login requires the configured environment password', async () => {
  const priorPassword = process.env.UMUKOMITE_PASSWORD;
  const priorSecret = process.env.MANAGER_SESSION_SECRET;
  const priorFetch = globalThis.fetch;
  try {
    process.env.UMUKOMITE_PASSWORD='correct-manager-passphrase';
    process.env.MANAGER_SESSION_SECRET='s'.repeat(40);
    globalThis.fetch=async()=>new Response(JSON.stringify([]),{status:200});
    const response = await managerLogin(new Request('http://localhost/.netlify/functions/manager-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test manager', password: 'correct-manager-passphrase' })
    }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(verifyManagerSession(body.sessionToken)?.name, 'Test manager');
    const rejected=await managerLogin(new Request('http://localhost/.netlify/functions/manager-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Test manager',password:'wrong-password'})}));
    assert.equal(rejected.status,401);
  } finally {
    globalThis.fetch=priorFetch;
    if (priorPassword === undefined) delete process.env.UMUKOMITE_PASSWORD;
    else process.env.UMUKOMITE_PASSWORD = priorPassword;
    if (priorSecret === undefined) delete process.env.MANAGER_SESSION_SECRET;
    else process.env.MANAGER_SESSION_SECRET = priorSecret;
  }
});
