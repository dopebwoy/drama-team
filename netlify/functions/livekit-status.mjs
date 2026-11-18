import { RoomServiceClient } from 'livekit-server-sdk';

const json = (body, status = 200, cache = 'no-store') => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cache
  }
});

export default async function handler(request) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);

  const serverUrl = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
  const roomName = process.env.LIVEKIT_ROOM_NAME?.trim() || 'drama-team-family';
  if (!serverUrl || !apiKey || !apiSecret) {
    return json({ error: 'Live meeting status is not configured.' }, 503);
  }

  try {
    const livekit = new RoomServiceClient(serverUrl, apiKey, apiSecret);
    const rooms = await livekit.listRooms([roomName]);
    const participants = rooms.length ? await livekit.listParticipants(roomName) : [];
    const participantCount = participants.length;

    return json(
      { ongoing: participantCount > 0, participantCount },
      200,
      'public, max-age=5, s-maxage=5, stale-while-revalidate=5'
    );
  } catch (error) {
    console.error('Live meeting status lookup failed:', error.message);
    return json({ error: 'Could not check the live meeting status.' }, 503);
  }
}
