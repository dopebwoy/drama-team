import { addCalendarMonths, getSupabaseConfig, jsonResponse, supabaseRequest } from '../push-utils.mjs';

export default async function handler(request) {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);
  try {
    getSupabaseConfig();
    const body = await request.json();
    const subscription = body?.subscription;
    const endpoint = typeof subscription?.endpoint === 'string' ? subscription.endpoint : '';
    const keys = subscription?.keys;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return jsonResponse({ error: 'A valid browser push subscription is required.' }, 400);
    }
    const endpointUrl = new URL(endpoint);
    if (endpointUrl.protocol !== 'https:') return jsonResponse({ error: 'Invalid push subscription endpoint.' }, 400);

    const query = { select: 'endpoint', endpoint: `eq.${endpoint}`, limit: '1' };
    const existing = await supabaseRequest('push_subscriptions', { query });
    const now = new Date();
    if (existing?.length) {
      await supabaseRequest('push_subscriptions', {
        method: 'PATCH',
        query: { endpoint: `eq.${endpoint}` },
        body: {
          subscription,
          next_notification_at: addCalendarMonths(now, 3).toISOString(),
          updated_at: now.toISOString()
        }
      });
    } else {
      await supabaseRequest('push_subscriptions', {
        method: 'POST',
        body: {
          endpoint,
          subscription,
          next_notification_at: addCalendarMonths(now, 3).toISOString(),
          created_at: now.toISOString(),
          updated_at: now.toISOString()
        }
      });
    }
    return jsonResponse({ ok: true, message: 'Three-month reminders enabled on this device.' });
  } catch (error) {
    console.error('Could not save push subscription:', error.message);
    return jsonResponse({ error: 'Could not save the reminder on the server. Check the push setup.' }, 503);
  }
}
