import { config, db, json, manager, cleanString, verifyDeviceToken, enforceRequest, summarizeLedger, hashTreasurerPin, uploadTreasurerPhoto } from '../contributions-api.mjs';
import { createHmac, timingSafeEqual } from 'node:crypto';

function developerOk(body) {
  const expected = process.env.DEV_MASTER_KEY?.trim();
  const supplied = body?.developerKey;
  if (!expected || typeof supplied !== 'string') return false;
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}
function issueDeviceToken(deviceId) {
  const key = process.env.DEVICE_TOKEN_SECRET?.trim();
  if (!key || key.length < 32) throw new Error('DEVICE_TOKEN_SECRET is missing or too short.');
  const expires = Math.floor(Date.now() / 1000) + 30 * 86400;
  const data = `${deviceId}.${expires}`;
  return `${expires}.${createHmac('sha256', key).update(data).digest('base64url')}`;
}

export default async function handler(request) {
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);
  let body = {};
  if (request.method === 'POST') try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const action = request.method === 'GET' ? new URL(request.url).searchParams.get('action') : body.action;
  let cfg;
  try { cfg = config(); } catch { return json({ error: 'Site controls are not configured.' }, 503); }
  try {
    if (!['status','register-device','developer-login','device-state'].includes(action) && !action?.startsWith('developer-')) {
      const gate = await enforceRequest(request);
      if (gate.error) return gate.error;
    }
    if (action === 'status') {
      const deviceId = request.method === 'GET' ? new URL(request.url).searchParams.get('deviceId') : body.deviceId;
      const rows = await db(cfg, 'site_settings', 'select=key,value&key=in.(site_paused,whatsapp_group_url)');
      const settings = Object.fromEntries((rows || []).map(row => [row.key, row.value]));
      if (deviceId && /^[0-9a-f-]{36}$/i.test(deviceId)) {
        const auth = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
        const registry = await db(cfg, 'device_registry', `select=is_blocked,is_banned_from_meet&device_id=eq.${deviceId}&limit=1`);
        const device = registry?.[0];
        if (!device && auth) return json({ error: 'Unknown device.' }, 401);
        if (device && !verifyDeviceToken(deviceId, auth)) return json({ error: 'Device authorization expired.' }, 401);
        if (device) return json({ paused: settings.site_paused === true || settings.site_paused === 'true', blocked: device.is_blocked === true, bannedFromMeet: device.is_banned_from_meet === true, whatsappUrl: sanitizeUrl(settings.whatsapp_group_url) });
      }
      return json({ paused: settings.site_paused === true || settings.site_paused === 'true', whatsappUrl: sanitizeUrl(settings.whatsapp_group_url) });
    }
    if (action === 'register-device') {
      if (!process.env.DEVICE_TOKEN_SECRET?.trim() || process.env.DEVICE_TOKEN_SECRET.trim().length < 32) {
        return json({ error: 'Device checks are not configured: set DEVICE_TOKEN_SECRET to at least 32 characters.' }, 503);
      }
      const deviceId = cleanString(body.deviceId, 36), name = cleanString(body.name, 80);
      if (!/^[0-9a-f-]{36}$/i.test(deviceId) || !name || !['member', 'umukomite'].includes(body.role)) return json({ error: 'Invalid device registration.' }, 400);
      const rows = await db(cfg, 'device_registry', `device_id=eq.${deviceId}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name, role: body.role, last_seen: new Date().toISOString() }) });
      if (!rows?.length) await db(cfg, 'device_registry', '', { method: 'POST', body: JSON.stringify({ device_id: deviceId, name, role: body.role, last_seen: new Date().toISOString() }) });
      const state = (await db(cfg, 'device_registry', `select=is_blocked,is_banned_from_meet&device_id=eq.${deviceId}&limit=1`))?.[0];
      return json({ token: issueDeviceToken(deviceId), blocked: state?.is_blocked === true, bannedFromMeet: state?.is_banned_from_meet === true });
    }
    if (action === 'developer-login') {
      if (!developerOk(body)) return json({ error: 'Developer key rejected.' }, 401);
      return json({ token: issueDeveloperToken() });
    }
    const devAuth = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || body.developerToken;
    if (action?.startsWith('developer-') && !validDeveloperToken(devAuth)) return json({ error: 'Developer authorization required.' }, 401);
    const managerAuth = action === 'manager-state' ? manager(request, body) : null;
    if (action === 'manager-state' && !managerAuth) return json({ error: 'Umukomite sign-in required.' }, 401);
    if (action === 'manager-state') {
      const rows = await db(cfg, 'site_settings', 'select=key,value&key=in.(site_paused,whatsapp_group_url)');
      return json({ paused: rows?.find(x => x.key === 'site_paused')?.value === true, whatsappUrl: sanitizeUrl(rows?.find(x => x.key === 'whatsapp_group_url')?.value) });
    }
    if (action === 'developer-ledger') {
      const [events,payments,requests] = await Promise.all([
        db(cfg,'contribution_events','select=id,title,description,start_date,end_date,treasurer_name,treasurer_phone,treasurer_photo_url,target_amount,active,created_at&order=created_at.desc&limit=500'),
        db(cfg,'contribution_payments','select=*&order=created_at.desc&limit=5000'),
        db(cfg,'treasurer_change_requests','select=*&status=eq.pending&order=created_at.desc&limit=100')
      ]);
      const activeEvent=events.find(item=>item.active)||null;
      const ledger=activeEvent?payments.filter(item=>item.event_id===activeEvent.id):[];
      return json({activeEvent,payments:ledger,requests,summary:summarizeLedger(activeEvent,ledger)});
    }
    if (action === 'developer-manual-add-payment') {
      const eventId = cleanString(body.eventId, 36);
      const name = cleanString(body.memberName, 80);
      const phone = cleanString(body.phone, 16);
      const amount = Number(body.amount);
      if (!/^[0-9a-f-]{36}$/i.test(eventId) || !name || !/^07[89]\d{7}$/.test(phone) || !Number.isSafeInteger(amount) || amount < 1 || amount > 100_000_000) {
        return json({ error: 'Enter a member name, valid MTN number, and positive FRW amount.' }, 400);
      }
      const active = (await db(cfg, 'contribution_events', `id=eq.${eventId}&active=eq.true&select=id&limit=1`))?.[0];
      if (!active) return json({ error: 'The active contribution event was not found.' }, 404);
      const rows = await db(cfg, 'contribution_payments', '', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ event_id: eventId, member_name: name, phone, claimed_amount: amount, verified_amount: amount, status: 'approved', verified_by: 'developer' })
      });
      if (!rows?.length) return json({ error: 'The manual payment was not saved.' }, 503);
      return json({ ok: true, memberName: name, amount }, 201);
    }
    if (action === 'developer-delete-payment') {
      const paymentId = cleanString(body.paymentId, 36);
      if (!/^[0-9a-f-]{36}$/i.test(paymentId)) return json({ error: 'Invalid payment.' }, 400);
      const active = (await db(cfg, 'contribution_events', 'select=id&active=eq.true&limit=1'))?.[0];
      if (!active) return json({ error: 'There is no active contribution event.' }, 404);
      const payment = (await db(cfg, 'contribution_payments', `id=eq.${paymentId}&event_id=eq.${active.id}&select=id,event_id,member_name,status`))?.[0];
      if (!payment || payment.status !== 'approved') return json({ error: 'Approved payment was not found in the active event.' }, 404);
      const removed = await db(cfg, 'contribution_payments', `id=eq.${paymentId}&event_id=eq.${active.id}&status=eq.approved`, {
        method: 'DELETE',
        headers: { Prefer: 'return=representation' }
      });
      if (!removed?.length) return json({ error: 'Approved payment was not removed.' }, 404);
      return json({ ok: true, memberName: payment.member_name });
    }
    if (action === 'developer-reset-event-pin') {
      const eventId=cleanString(body.eventId,36); if(!/^[0-9a-f-]{36}$/i.test(eventId)) return json({error:'Invalid event.'},400);
      let pinFields; try { pinFields=hashTreasurerPin(body.approvalPin); } catch(error) { return json({error:error.message},400); }
      const changed=await db(cfg,'contribution_events',`id=eq.${eventId}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(pinFields)});
      if(!changed?.length)return json({error:'Event was not found.'},404);
      return json({ok:true,eventTitle:changed[0].title});
    }
    if (action === 'developer-close-event') {
      const active=(await db(cfg,'contribution_events','select=id,title,active&active=eq.true&limit=1'))?.[0];
      if(!active)return json({error:'There is no active event to close.'},404);
      await db(cfg,'contribution_events',`id=eq.${active.id}`,{method:'PATCH',body:JSON.stringify({active:false})});
      return json({ok:true,eventTitle:active.title});
    }
    if (action === 'developer-treasurer-photo') {
      const eventId = cleanString(body.eventId, 36);
      if (!/^[0-9a-f-]{36}$/i.test(eventId) || typeof body.treasurerPhotoData !== 'string') return json({ error: 'Choose a treasurer photo for the active event.' }, 400);
      const active = (await db(cfg, 'contribution_events', `select=id,active&id=eq.${eventId}&active=eq.true&limit=1`))?.[0];
      if (!active) return json({ error: 'The active contribution event was not found.' }, 404);
      let photoUrl;
      try { photoUrl = await uploadTreasurerPhoto(cfg, body.treasurerPhotoData); }
      catch (error) { return json({ error: `Treasurer photo upload failed: ${error.message}` }, 503); }
      const updated = await db(cfg, 'contribution_events', `id=eq.${eventId}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ treasurer_photo_url: photoUrl })
      });
      if (!updated?.length) return json({ error: 'The treasurer photo URL was not saved.' }, 503);
      return json({ ok: true, photoUrl });
    }
    if (action === 'developer-approve-payment' || action === 'developer-reject-payment') {
      const paymentId=cleanString(body.paymentId,36);if(!/^[0-9a-f-]{36}$/i.test(paymentId))return json({error:'Invalid payment.'},400);
      const active=(await db(cfg,'contribution_events','select=id&active=eq.true&limit=1'))?.[0];
      const payment=(await db(cfg,'contribution_payments',`id=eq.${paymentId}&select=event_id,member_name`))?.[0];
      if(!active||!payment||payment.event_id!==active.id)return json({error:'Payment does not belong to the active event.'},404);
      const approved=action==='developer-approve-payment';
      const amount=approved?Number(body.verifiedAmount):null;
      if(approved&&(!Number.isSafeInteger(amount)||amount<1||amount>100_000_000))return json({error:'Enter a valid verified amount.'},400);
      await db(cfg,'contribution_payments',`id=eq.${paymentId}`,{method:'PATCH',body:JSON.stringify({status:approved?'approved':'rejected',verified_amount:amount,verified_by:'developer'})});
      return json({ok:true,memberName:payment.member_name});
    }
    if (action === 'developer-devices') return json({ devices: await db(cfg, 'device_registry', 'select=*&order=last_seen.desc&limit=1000') });
    if (action === 'developer-requests') return json({ requests: await db(cfg, 'treasurer_change_requests', 'select=*&status=eq.pending&order=created_at.desc&limit=100') });
    if (action === 'developer-setting') {
      const key = cleanString(body.key, 80);
      if (!['site_paused', 'whatsapp_group_url', 'umukomite_password'].includes(key)) return json({ error: 'Invalid setting.' }, 400);
      let value = body.value;
      if (key === 'site_paused') value = value === true;
      if (key === 'whatsapp_group_url') { value = sanitizeUrl(value); if (!value) return json({ error: 'WhatsApp link must be HTTPS.' }, 400); }
      if (key === 'umukomite_password') {
        value = cleanString(value, 200);
        if (value.length < 12) return json({ error: 'Use a password of at least 12 characters.' }, 400);
      }
      const saved = await db(cfg, 'site_settings', 'on_conflict=key&select=key,value', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ key, value }) });
      if (!Array.isArray(saved) || saved[0]?.key !== key) return json({ error: 'The setting was not saved in Supabase.' }, 503);
      return json({ ok: true });
    }
    if (action === 'developer-device') {
      const id = cleanString(body.deviceId, 36);
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Invalid device id.' }, 400);
      const fields = body.kind === 'block' ? { is_blocked: body.value === true } : body.kind === 'ban' ? { is_banned_from_meet: body.value === true } : null;
      if (!fields) return json({ error: 'Invalid device action.' }, 400);
      await db(cfg, 'device_registry', `device_id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
      return json({ ok: true });
    }
    if (action === 'developer-phone-request') {
      const id = cleanString(body.requestId, 36), phone = cleanString(body.phone, 16), name = cleanString(body.treasurerName, 80);
      if (!/^[0-9a-f-]{36}$/i.test(id) || !/^07[89]\d{7}$/.test(phone) || !name) return json({ error: 'Invalid event or MTN number.' }, 400);
      const req = (await db(cfg, 'treasurer_change_requests', `id=eq.${id}&select=event_id`))?.[0];
      if (!req) return json({ error: 'Change request was not found.' }, 404);
      await db(cfg, 'contribution_events', `id=eq.${req.event_id}`, { method: 'PATCH', body: JSON.stringify({ treasurer_phone: phone, treasurer_name: name }) });
      await db(cfg, 'treasurer_change_requests', `id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'approved' }) });
      return json({ ok: true });
    }
    if (action === 'device-state') {
      const deviceId = cleanString(body.deviceId, 36);
      if (!/^[0-9a-f-]{36}$/i.test(deviceId) || !verifyDeviceToken(deviceId, body.deviceToken)) return json({ error: 'Device authorization required.' }, 401);
      const device = (await db(cfg, 'device_registry', `select=is_blocked,is_banned_from_meet&device_id=eq.${deviceId}&limit=1`))?.[0];
      return json({ paused: (await db(cfg, 'site_settings', 'select=value&key=eq.site_paused'))?.[0]?.value === true, blocked: device?.is_blocked === true, bannedFromMeet: device?.is_banned_from_meet === true });
    }
    return json({ error: 'Unknown site action.' }, 400);
  } catch (error) {
    console.error('Site administration request failed:', error.message);
    return json({ error: 'The site action could not be completed.' }, 503);
  }
}

function sanitizeUrl(value) { return typeof value === 'string' && /^https:\/\//i.test(value) ? value : null; }
function issueDeveloperToken() {
  const key = process.env.DEV_MASTER_KEY?.trim();
  const secret = process.env.DEVICE_TOKEN_SECRET?.trim();
  if (!key || !secret || secret.length < 32) throw new Error('Developer configuration missing.');
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const sig = createHmac('sha256', secret).update(`developer.${expires}`).digest('base64url');
  return `${expires}.${sig}`;
}
function validDeveloperToken(token) {
  const secret = process.env.DEVICE_TOKEN_SECRET?.trim();
  if (!secret || typeof token !== 'string') return false;
  const [expires, sig, extra] = token.split('.');
  if (extra || !/^\d+$/.test(expires) || Number(expires) <= Date.now() / 1000) return false;
  const expected = createHmac('sha256', secret).update(`developer.${expires}`).digest('base64url');
  const a = Buffer.from(sig || ''), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
