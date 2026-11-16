import { getSupabaseConfig, jsonResponse, supabaseRequest } from '../push-utils.mjs';

export default async function handler(request) {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);
  try {
    getSupabaseConfig();
    const body = await request.json();
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
    if (!endpoint || new URL(endpoint).protocol !== 'https:') {
      return jsonResponse({ error: 'A valid browser subscription endpoint is required.' }, 400);
    }
    await supabaseRequest('push_subscriptions', {
      method: 'DELETE',
      query: { endpoint: `eq.${endpoint}` }
    });
    return jsonResponse({ ok: true });
  } catch (error) {
    console.error('Could not remove push subscription:', error.message);
    return jsonResponse({ error: 'Could not remove the reminder from the server.' }, 503);
  }
}
