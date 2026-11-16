export const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

export function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    throw new Error('Push storage is not configured on the server.');
  }
  return { url: url.replace(/\/$/, ''), serviceKey };
}

export function supabaseRestUrl(path, query = {}) {
  const { url } = getSupabaseConfig();
  const result = new URL(`${url}/rest/v1/${path}`);
  for (const [key, value] of Object.entries(query)) result.searchParams.set(key, value);
  return result;
}

export async function supabaseRequest(path, { query, method = 'GET', body } = {}) {
  const { serviceKey } = getSupabaseConfig();
  const response = await fetch(supabaseRestUrl(path, query), {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!response.ok) throw new Error(`Supabase push storage returned HTTP ${response.status}.`);
  if (response.status === 204 || method === 'DELETE' || method === 'PATCH' || method === 'POST') return null;
  return response.json();
}

export function addCalendarMonths(date, amount) {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + amount);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}
