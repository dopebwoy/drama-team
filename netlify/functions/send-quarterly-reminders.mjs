import { sendNotification, setVapidDetails } from 'web-push';
import { addCalendarMonths, getSupabaseConfig, supabaseRequest, supabaseRestUrl } from '../push-utils.mjs';

export const config = { schedule: '0 14 * * *' };

export default async function handler() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) throw new Error('VAPID push keys are missing.');
  getSupabaseConfig();
  setVapidDetails(subject, publicKey, privateKey);

  const now = new Date();
  const dueRows = await fetch(supabaseRestUrl('push_subscriptions', {
    select: 'endpoint,subscription',
    next_notification_at: `lte.${now.toISOString()}`,
    limit: '100'
  }), {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  }).then(async response => {
    if (!response.ok) throw new Error(`Supabase push storage returned HTTP ${response.status}.`);
    return response.json();
  });

  let sent = 0;
  let removed = 0;
  for (let offset = 0; offset < dueRows.length; offset += 10) {
    const batch = dueRows.slice(offset, offset + 10);
    const outcomes = await Promise.allSettled(batch.map(async row => {
      try {
        await sendNotification(row.subscription, JSON.stringify({
          title: 'Drama Team Family',
          body: 'There may be something new on the Drama Team Family website. Come and have a look!',
          url: '/index.html',
          tag: 'dtm-quarterly-reminder'
        }));
        await supabaseRequest('push_subscriptions', {
          method: 'PATCH',
          query: { endpoint: `eq.${row.endpoint}` },
          body: {
            last_sent_at: now.toISOString(),
            next_notification_at: addCalendarMonths(now, 3).toISOString(),
            updated_at: now.toISOString()
          }
        });
        return 'sent';
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          await supabaseRequest('push_subscriptions', {
            method: 'DELETE',
            query: { endpoint: `eq.${row.endpoint}` }
          });
          return 'removed';
        }
        console.error('A quarterly push could not be delivered:', error.message);
        return 'failed';
      }
    }));
    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled' && outcome.value === 'sent') sent++;
      if (outcome.status === 'fulfilled' && outcome.value === 'removed') removed++;
    }
  }
  console.log(`Quarterly reminders processed: ${sent} sent, ${removed} expired subscriptions removed.`);
}
