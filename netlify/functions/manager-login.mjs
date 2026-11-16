import { createManagerSession, isManagerPasswordValid } from '../manager-session.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Request body must be valid JSON.' }, 400); }

  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : '';
  if (!name || !isManagerPasswordValid(body?.password)) {
    return json({ error: 'Incorrect Umukomite name or password.' }, 401);
  }

  try {
    return json({ sessionToken: createManagerSession(name), expiresIn: 8 * 60 * 60 });
  } catch (error) {
    console.error('Could not issue manager session:', error.message);
    return json({ error: 'Manager sign-in could not be completed.' }, 503);
  }
}
