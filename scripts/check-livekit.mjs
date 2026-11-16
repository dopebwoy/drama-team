import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(projectRoot, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const { LIVEKIT_URL: serverUrl, LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret } = process.env;
if (!serverUrl || !apiKey || !apiSecret) {
  console.error('LiveKit check failed: set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET in .env.');
  process.exit(1);
}

try {
  const { RoomServiceClient } = await import('livekit-server-sdk');
  const rooms = await new RoomServiceClient(serverUrl, apiKey, apiSecret).listRooms();
  console.log(`LiveKit credentials accepted; API reachable; ${rooms.length} active room(s).`);
} catch (error) {
  console.error(`LiveKit check failed: ${error.message}`);
  process.exit(1);
}
