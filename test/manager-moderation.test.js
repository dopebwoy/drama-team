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

test('manager sessions are signed, expire, and reject tampering', () => {
  const token = createManagerSession('Test manager');
  assert.equal(verifyManagerSession(token)?.name, 'Test manager');
  assert.equal(verifyManagerSession(`${token.slice(0, -1)}x`), null);
  assert.equal(verifyManagerSession(createManagerSession('Expired', 0)), null);
  assert.equal(isManagerPasswordValid('umu7.2026'), true);
  assert.equal(isManagerPasswordValid('incorrect'), false);
});

test('Umukomite can sign in without manager environment variables', async () => {
  const priorPassword = process.env.UMUKOMITE_PASSWORD;
  const priorSecret = process.env.MANAGER_SESSION_SECRET;
  try {
    delete process.env.UMUKOMITE_PASSWORD;
    delete process.env.MANAGER_SESSION_SECRET;
    const response = await managerLogin(new Request('http://localhost/.netlify/functions/manager-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test manager', password: 'umu7.2026' })
    }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(verifyManagerSession(body.sessionToken)?.name, 'Test manager');
  } finally {
    if (priorPassword === undefined) delete process.env.UMUKOMITE_PASSWORD;
    else process.env.UMUKOMITE_PASSWORD = priorPassword;
    if (priorSecret === undefined) delete process.env.MANAGER_SESSION_SECRET;
    else process.env.MANAGER_SESSION_SECRET = priorSecret;
  }
});
