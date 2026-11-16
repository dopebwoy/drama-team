import { jsonResponse } from '../push-utils.mjs';

export default async function handler(request) {
  if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed.' }, 405);
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  if (!publicKey) return jsonResponse({ error: 'Push notifications are not configured yet.' }, 503);
  return jsonResponse({ publicKey });
}
