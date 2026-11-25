import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/contributions.mjs';
import { hashTreasurerPin } from '../netlify/contributions-api.mjs';
import { createManagerSession } from '../netlify/manager-session.mjs';

const saved={SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY,MANAGER_SESSION_SECRET:process.env.MANAGER_SESSION_SECRET};
const paymentId='11111111-1111-4111-8111-111111111111';
const eventId='22222222-2222-4222-8222-222222222222';
const pin='Treasurer-Secret-123';
const pinHash=hashTreasurerPin(pin);
const event={id:eventId,title:'Family gathering',active:true,target_amount:10000,...pinHash};
let originalFetch;
let paymentUpdates=0,eventUpdates=0,paymentInserts=0,paymentDeletes=0;

function mockSupabase(){
  paymentUpdates=0;eventUpdates=0;paymentInserts=0;paymentDeletes=0;
  globalThis.fetch=async(url,options={})=>{
    const parsed=new URL(String(url));const table=parsed.pathname.split('/').at(-1);const method=options.method||'GET';
    if(table==='site_settings')return new Response(JSON.stringify([{value:false}]),{status:200});
    if(table==='contribution_events'){
      if(method==='GET')return new Response(JSON.stringify([event]),{status:200});
      if(method==='PATCH'){eventUpdates++;return new Response(JSON.stringify([{...event,active:false}]),{status:200});}
    }
    if(table==='contribution_payments'){
      if(method==='GET')return new Response(JSON.stringify([{id:paymentId,event_id:eventId,member_name:'Member',status:'approved'}]),{status:200});
      if(method==='POST'){paymentInserts++;const row=JSON.parse(options.body);return new Response(JSON.stringify([{id:paymentId,...row}]),{status:201});}
      if(method==='DELETE'){paymentDeletes++;return new Response(JSON.stringify([{id:paymentId,event_id:eventId,member_name:'Member',status:'approved'}]),{status:200});}
      if(method==='PATCH'){paymentUpdates++;return new Response(JSON.stringify([{id:paymentId,member_name:'Member',status:'approved'}]),{status:200});}
    }
    throw new Error(`Unexpected Supabase request ${method} ${parsed.pathname}`);
  };
}
function request(action,extra={}){return new Request('http://localhost/.netlify/functions/contributions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,sessionToken:createManagerSession('Manager'),...extra})});}

test.beforeEach(()=>{process.env.SUPABASE_URL='https://pin-test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test-service-key';process.env.MANAGER_SESSION_SECRET='pin-test-signing-secret-with-at-least-32-chars';originalFetch=globalThis.fetch;mockSupabase();});
test.after(()=>{globalThis.fetch=originalFetch;for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});

test('payment approval rejects missing and incorrect treasurer PIN, succeeds with correct PIN',async()=>{
  const base={paymentId,verifiedAmount:500};
  let response=await handler(request('approve-payment',base));assert.equal(response.status,401);assert.equal(paymentUpdates,0);
  response=await handler(request('approve-payment',{...base,approvalPin:'wrong pin'}));assert.equal(response.status,401);assert.equal(paymentUpdates,0);
  response=await handler(request('approve-payment',{...base,approvalPin:pin}));assert.equal(response.status,200);assert.equal(paymentUpdates,1);
});

test('event closure rejects missing and incorrect treasurer PIN, succeeds with correct PIN',async()=>{
  let response=await handler(request('close-event'));assert.equal(response.status,401);assert.equal(eventUpdates,0);
  response=await handler(request('close-event',{approvalPin:'wrong pin'}));assert.equal(response.status,401);assert.equal(eventUpdates,0);
  response=await handler(request('close-event',{approvalPin:pin}));assert.equal(response.status,200);assert.equal(eventUpdates,1);
});

test('manual payment creation rejects missing and incorrect treasurer PIN, then adds an approved payment',async()=>{
  const base={memberName:'Offline Member',phone:'0781234567',amount:2500};
  let response=await handler(request('manual_add_payment',base));assert.equal(response.status,401);assert.equal(paymentInserts,0);
  response=await handler(request('manual_add_payment',{...base,approvalPin:'wrong pin'}));assert.equal(response.status,401);assert.equal(paymentInserts,0);
  response=await handler(request('manual_add_payment',{...base,approvalPin:pin}));assert.equal(response.status,201);assert.equal(paymentInserts,1);
  const result=await response.json();assert.equal(result.memberName,'Offline Member');assert.equal(result.amount,2500);
});

test('approved payment deletion rejects missing and incorrect treasurer PIN, then deletes the row',async()=>{
  const base={paymentId};
  let response=await handler(request('delete_payment',base));assert.equal(response.status,401);assert.equal(paymentDeletes,0);
  response=await handler(request('delete_payment',{...base,approvalPin:'wrong pin'}));assert.equal(response.status,401);assert.equal(paymentDeletes,0);
  response=await handler(request('delete_payment',{...base,approvalPin:pin}));assert.equal(response.status,200);assert.equal(paymentDeletes,1);
  const result=await response.json();assert.equal(result.memberName,'Member');
});
