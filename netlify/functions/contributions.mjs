import { cleanString, config, db, json, manager, uuid, sitePaused, summarizeLedger, hashTreasurerPin, verifyTreasurerPin, uploadTreasurerPhoto } from '../contributions-api.mjs';

const activeEventQuery = new URLSearchParams({ select: '*', active: 'eq.true', order: 'created_at.desc', limit: '1' });

export default async function handler(request) {
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);
  let body = {};
  if (request.method === 'POST') {
    try { body = await request.json(); } catch { return json({ error: 'Request body must be valid JSON.' }, 400); }
  }
  let cfg;
  try { cfg = config(); } catch { return json({ error: 'Contributions are not configured.' }, 503); }
  try {
    if (await sitePaused(cfg) && !(body.action?.startsWith('developer-'))) return json({ error: 'Website temporarily paused.' }, 503);
    if (request.method === 'GET') {
      const [events, settings] = await Promise.all([
        db(cfg, 'contribution_events', new URLSearchParams({select:'id,title,description,start_date,end_date,treasurer_name,treasurer_phone,treasurer_photo_url,target_amount,active,created_at',active:'eq.true',order:'created_at.desc',limit:'1'}).toString()),
        db(cfg, 'site_settings', 'select=key,value&key=in.(whatsapp_group_url,site_paused)')
      ]);
      const event = Array.isArray(events) ? events[0] || null : null;
      if (!event) return json({ event: null, comments: [], whatsappUrl: getSetting(settings, 'whatsapp_group_url') });
      const { approval_pin_hash, approval_pin_salt, ...publicEvent } = event;
      const comments = await db(cfg, 'contribution_comments', new URLSearchParams({ select: 'id,member_name,comment,created_at', event_id: `eq.${event.id}`, order: 'created_at.asc', limit: '300' }).toString());
      return json({ event:publicEvent, comments: comments || [], whatsappUrl: getSetting(settings, 'whatsapp_group_url') });
    }
    if (body.action === 'submit-payment') {
      const event = (await db(cfg, 'contribution_events', activeEventQuery.toString()))?.[0];
      const name = cleanString(body.name, 80), phone = cleanString(body.phone, 16), amount = Number(body.amount);
      if (!event) return json({ error: 'There is no active contribution event.' }, 404);
      if (!name || !/^07[89]\d{7}$/.test(phone) || !Number.isSafeInteger(amount) || amount < 1 || amount > 100_000_000) return json({ error: 'Enter your name, a valid Rwanda MTN number, and a valid FRW amount.' }, 400);
      const rows = await db(cfg, 'contribution_payments', '', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ event_id: event.id, member_name: name, phone, claimed_amount: amount, transaction_id: cleanString(body.transactionId, 80) || null, status: 'pending' }) });
      return json({ ok: true, paymentId: rows?.[0]?.id || null, message: 'Your payment confirmation was submitted for treasurer verification.' }, 201);
    }
    if (body.action === 'comment') {
      const event = (await db(cfg, 'contribution_events', activeEventQuery.toString()))?.[0];
      const name = cleanString(body.name, 80), comment = cleanString(body.comment, 1000);
      if (!event) return json({ error: 'There is no active event for comments right now.' }, 404);
      if (!name || !comment) return json({ error: 'Enter your name and comment.' }, 400);
      await db(cfg, 'contribution_comments', '', { method: 'POST', body: JSON.stringify({ event_id: event.id, member_name: name, comment }) });
      return json({ ok: true }, 201);
    }
    const session = manager(request, body);
    if (!session) return json({ error: 'A valid Umukomite sign-in is required.' }, 401);
    if (body.action === 'save-event') {
      const title = cleanString(body.title), description = cleanString(body.description, 3000);
      const treasurer = cleanString(body.treasurerName, 80), phone = cleanString(body.treasurerPhone, 16);
      const target = Number(body.targetAmount);
      let pinFields; try { pinFields = hashTreasurerPin(body.approvalPin); } catch(error) { return json({error:error.message},400); }
      if (!title || !treasurer || !/^07[89]\d{7}$/.test(phone) || !Number.isSafeInteger(target) || target < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(body.startDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(body.endDate || '')) return json({ error: 'Complete all event fields with valid dates, target, and MTN number.' }, 400);
      const existing = (await db(cfg, 'contribution_events', activeEventQuery.toString()))?.[0];
      let treasurerPhotoUrl = existing?.treasurer_photo_url || null;
      if (body.treasurerPhotoData) {
        try { treasurerPhotoUrl = await uploadTreasurerPhoto(cfg, body.treasurerPhotoData); }
        catch (error) { return json({ error: `Treasurer photo upload failed: ${error.message}` }, 503); }
      }
      const event = { title, description, start_date: body.startDate, end_date: body.endDate, treasurer_name: treasurer, treasurer_phone: phone, treasurer_photo_url: treasurerPhotoUrl, target_amount: target, active: true, ...pinFields };
      if (existing?.id) await db(cfg, 'contribution_events', `id=eq.${existing.id}`, { method: 'PATCH', body: JSON.stringify(event) });
      else {
        await db(cfg, 'contribution_events', 'active=eq.true', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active: false }) });
        await db(cfg, 'contribution_events', '', { method: 'POST', body: JSON.stringify({ id: uuid(), ...event }) });
      }
      return json({ ok: true, title });
    }
    if (body.action === 'close-event') {
      const active = (await db(cfg, 'contribution_events', activeEventQuery.toString()))?.[0];
      if (!active) return json({ error: 'There is no active event to close.' }, 404);
      if (!verifyTreasurerPin(body.approvalPin,active.approval_pin_salt,active.approval_pin_hash)) return json({error:'Invalid Treasurer Approval PIN. Only the assigned treasurer can approve payments or close this event.'},401);
      await db(cfg, 'contribution_events', `id=eq.${active.id}`, { method:'PATCH', headers:{Prefer:'return=representation'}, body:JSON.stringify({active:false}) });
      return json({ok:true,eventTitle:active.title});
    }
    if (body.action === 'list-admin') {
      const [events, payments, requests] = await Promise.all([
        db(cfg, 'contribution_events', 'select=*&order=created_at.desc&limit=50'),
        db(cfg, 'contribution_payments', 'select=*&order=created_at.desc&limit=500'),
        db(cfg, 'treasurer_change_requests', 'select=*&status=eq.pending&order=created_at.desc&limit=100')
      ]);
      const activeEvent = events.find(item => item.active) || null;
      const eventPayments = activeEvent ? payments.filter(item => item.event_id === activeEvent.id) : [];
      const safeEvents=events.map(({approval_pin_hash,approval_pin_salt,...event})=>event);
      const {approval_pin_hash,approval_pin_salt,...safeActive}=activeEvent||{};
      return json({ events:safeEvents, activeEvent:activeEvent?safeActive:null, payments: eventPayments, requests, summary: summarizeLedger(activeEvent,eventPayments) });
    }
    if (body.action === 'manual_add_payment') {
      const name = cleanString(body.memberName, 80);
      const phone = cleanString(body.phone, 16);
      const amount = Number(body.amount);
      if (!name || !/^07[89]\d{7}$/.test(phone) || !Number.isSafeInteger(amount) || amount < 1 || amount > 100_000_000) {
        return json({ error: 'Enter a member name, valid MTN number, and positive FRW amount.' }, 400);
      }
      const active = (await db(cfg, 'contribution_events', activeEventQuery.toString()))?.[0];
      if (!active) return json({ error: 'There is no active contribution event.' }, 404);
      if (!verifyTreasurerPin(body.approvalPin, active.approval_pin_salt, active.approval_pin_hash)) {
        return json({ error: 'Invalid Treasurer Approval PIN.' }, 401);
      }
      const rows = await db(cfg, 'contribution_payments', '', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          event_id: active.id,
          member_name: name,
          phone,
          claimed_amount: amount,
          verified_amount: amount,
          status: 'approved',
          verified_by: session.name
        })
      });
      if (!rows?.length) return json({ error: 'The manual payment was not saved.' }, 503);
      return json({ ok: true, paymentId: rows[0].id, memberName: name, amount }, 201);
    }
    if (body.action === 'delete_payment') {
      const paymentId = cleanString(body.paymentId, 36);
      if (!/^[0-9a-f-]{36}$/i.test(paymentId)) return json({ error: 'Invalid payment.' }, 400);
      const active = (await db(cfg, 'contribution_events', activeEventQuery.toString()))?.[0];
      if (!active) return json({ error: 'There is no active contribution event.' }, 404);
      if (!verifyTreasurerPin(body.approvalPin, active.approval_pin_salt, active.approval_pin_hash)) {
        return json({ error: 'Invalid Treasurer Approval PIN.' }, 401);
      }
      const payment = (await db(cfg, 'contribution_payments', `id=eq.${paymentId}&event_id=eq.${active.id}&select=id,event_id,member_name,status`))?.[0];
      if (!payment || payment.status !== 'approved') return json({ error: 'Approved payment was not found in the active event.' }, 404);
      const removed = await db(cfg, 'contribution_payments', `id=eq.${paymentId}&event_id=eq.${active.id}&status=eq.approved`, {
        method: 'DELETE',
        headers: { Prefer: 'return=representation' }
      });
      if (!removed?.length) return json({ error: 'Approved payment was not removed.' }, 404);
      return json({ ok: true, memberName: payment.member_name });
    }
    if (body.action === 'approve-payment') {
      if (!/^[0-9a-f-]{36}$/i.test(body.paymentId || '')) return json({ error: 'Invalid payment.' }, 400);
      const amount = Number(body.verifiedAmount);
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100_000_000) return json({ error: 'Enter a valid verified amount.' }, 400);
      const active=(await db(cfg,'contribution_events',activeEventQuery.toString()))?.[0];
      if(!active || !verifyTreasurerPin(body.approvalPin,active.approval_pin_salt,active.approval_pin_hash)) return json({error:'Invalid Treasurer Approval PIN. Only the assigned treasurer can approve payments or close this event.'},401);
      const paymentRows=await db(cfg,'contribution_payments',`id=eq.${body.paymentId}&select=event_id`);
      if(!paymentRows?.length || paymentRows[0].event_id!==active.id) return json({error:'Payment does not belong to the active event.'},404);
      const result = await db(cfg, 'contribution_payments', `id=eq.${body.paymentId}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'approved', verified_amount: amount, verified_by: session.name }) });
      if (!result?.length) return json({ error: 'Payment was not found.' }, 404);
      const payment = result[0];
      return json({ ok: true, memberName: payment.member_name, verifiedAmount: amount });
    }
    if (body.action === 'reject-payment') {
      if (!/^[0-9a-f-]{36}$/i.test(body.paymentId || '')) return json({ error: 'Invalid payment.' }, 400);
      const active=(await db(cfg,'contribution_events',activeEventQuery.toString()))?.[0];
      if(!active || !verifyTreasurerPin(body.approvalPin,active.approval_pin_salt,active.approval_pin_hash)) return json({error:'Invalid Treasurer Approval PIN. Only the assigned treasurer can approve payments or close this event.'},401);
      const paymentRows=await db(cfg,'contribution_payments',`id=eq.${body.paymentId}&select=event_id`);
      if(!paymentRows?.length || paymentRows[0].event_id!==active.id) return json({error:'Payment does not belong to the active event.'},404);
      const result = await db(cfg, 'contribution_payments', `id=eq.${body.paymentId}`, { method:'PATCH', headers:{Prefer:'return=representation'}, body:JSON.stringify({status:'rejected',verified_by:session.name}) });
      if (!result?.length) return json({error:'Payment was not found.'},404);
      return json({ok:true,memberName:result[0].member_name});
    }
    if (body.action === 'request-phone-change') {
      const eventId = cleanString(body.eventId, 36), reason = cleanString(body.reason, 500);
      if (!/^[0-9a-f-]{36}$/i.test(eventId) || !reason) return json({ error: 'Provide the event and reason for the request.' }, 400);
      await db(cfg, 'treasurer_change_requests', '', { method: 'POST', body: JSON.stringify({ event_id: eventId, requested_by: session.name, reason }) });
      return json({ ok: true });
    }
    return json({ error: 'Unknown contribution action.' }, 400);
  } catch (error) {
    console.error('Contribution request failed:', error.message);
    return json({ error: error.message || 'The contribution request could not be completed.' }, 503);
  }
}

function getSetting(settings, key) {
  const row = Array.isArray(settings) ? settings.find(item => item.key === key) : null;
  const value = row?.value;
  return typeof value === 'string' && /^https:\/\//i.test(value) ? value : null;
}
