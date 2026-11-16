import { RoomServiceClient } from 'livekit-server-sdk';
import { verifyManagerSession } from '../manager-session.mjs';
import { canManagerRemoveParticipant, participantRole } from '../moderation-policy.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

function getLiveKitConfig() {
  const serverUrl = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
  const roomName = process.env.LIVEKIT_ROOM_NAME?.trim() || 'drama-team-family';
  if (!serverUrl || !apiKey || !apiSecret) throw new Error('LiveKit server credentials are not configured.');
  return { serverUrl, apiKey, apiSecret, roomName };
}

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Request body must be valid JSON.' }, 400); }

  let managerSession;
  try { managerSession = verifyManagerSession(body?.sessionToken); }
  catch { return json({ error: 'Manager sign-in is not configured on the server.' }, 503); }
  if (!managerSession) return json({ error: 'A valid Umukomite sign-in is required.' }, 401);

  try {
    const config = getLiveKitConfig();
    const livekit = new RoomServiceClient(config.serverUrl, config.apiKey, config.apiSecret);
    const activeRooms = await livekit.listRooms([config.roomName]);
    const participants = activeRooms.length ? await livekit.listParticipants(config.roomName) : [];
    const visibleParticipants = participants.map(participant => {
      const role = participantRole(participant);
      return {
        identity: participant.identity,
        name: participant.name || participant.identity,
        role,
        canRemove: canManagerRemoveParticipant(participant)
      };
    });

    if (body.action === 'list') return json({ participants: visibleParticipants });
    if (body.action !== 'remove' || typeof body.identity !== 'string') {
      return json({ error: 'Choose a participant to remove.' }, 400);
    }

    const target = participants.find(participant => participant.identity === body.identity);
    if (!target) return json({ error: 'That participant is no longer in the meeting.' }, 404);
    if (!canManagerRemoveParticipant(target)) {
      return json({ error: 'Umukomite can remove Umufamiliye participants only.' }, 403);
    }

    await livekit.removeParticipant(config.roomName, target.identity);
    return json({ ok: true, removedIdentity: target.identity });
  } catch (error) {
    console.error('Live meeting moderation failed:', error.message);
    return json({ error: 'Could not manage the meeting. Check LiveKit server settings.' }, 503);
  }
}
