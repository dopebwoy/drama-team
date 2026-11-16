import test from 'node:test';
import assert from 'node:assert/strict';
import { canManagerRemoveParticipant, participantRole } from '../netlify/moderation-policy.mjs';
import { createManagerSession, verifyManagerSession } from '../netlify/manager-session.mjs';

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
  const originalSecret = process.env.MANAGER_SESSION_SECRET;
  process.env.MANAGER_SESSION_SECRET = 'test-only-manager-session-secret-32-bytes';
  try {
    const token = createManagerSession('Test manager');
    assert.equal(verifyManagerSession(token)?.name, 'Test manager');
    assert.equal(verifyManagerSession(`${token.slice(0, -1)}x`), null);
    assert.equal(verifyManagerSession(createManagerSession('Expired', 0)), null);
  } finally {
    if (originalSecret === undefined) delete process.env.MANAGER_SESSION_SECRET;
    else process.env.MANAGER_SESSION_SECRET = originalSecret;
  }
});
