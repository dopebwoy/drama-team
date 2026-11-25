import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import handler from '../netlify/functions/livekit-token.mjs';
import { createManagerSession } from '../netlify/manager-session.mjs';

const envKeys = ['LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','LIVEKIT_ROOM_NAME','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','DEVICE_TOKEN_SECRET','MANAGER_SESSION_SECRET','UMUKOMITE_PASSWORD'];
const savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
let originalFetch;
const deviceId = 'b02d0cd9-6f12-4f85-bcf6-0e46a5c1fb70';
function deviceToken() { const exp=String(Math.floor(Date.now()/1000)+3600);return `${exp}.${createHmac('sha256',process.env.DEVICE_TOKEN_SECRET).update(`${deviceId}.${exp}`).digest('base64url')}`; }
function mockDevice({blocked=false,banned=false,paused=false}={}) {
  globalThis.fetch=async url=>{
    const u=String(url);
    if(u.includes('/site_settings')) return new Response(JSON.stringify([{value:paused}]),{status:200});
    if(u.includes('/device_registry')) return new Response(JSON.stringify([{is_blocked:blocked,is_banned_from_meet:banned}]),{status:200});
    throw new Error(`Unexpected fetch ${u}`);
  };
}
test.beforeEach(()=>{
  process.env.LIVEKIT_URL='wss://unit-test.livekit.cloud';process.env.LIVEKIT_API_KEY='test-api-key';process.env.LIVEKIT_API_SECRET='test-api-secret-that-is-long-enough';process.env.LIVEKIT_ROOM_NAME='test-room';
  process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test-key';process.env.DEVICE_TOKEN_SECRET='x'.repeat(40);process.env.MANAGER_SESSION_SECRET='y'.repeat(40);process.env.UMUKOMITE_PASSWORD='test-password-123'; originalFetch=globalThis.fetch;mockDevice();
});
test.after(()=>{globalThis.fetch=originalFetch;for(const key of envKeys){if(savedEnv[key]===undefined)delete process.env[key];else process.env[key]=savedEnv[key];}});

test('GET reports LiveKit config without exposing its secret',async()=>{const r=await handler(new Request('http://localhost/.netlify/functions/livekit-token'));const d=await r.json();assert.equal(r.status,200);assert.equal(d.configured,true);assert.equal(d.serverUrl,process.env.LIVEKIT_URL);assert.equal(d.roomName,'test-room');assert.equal(JSON.stringify(d).includes(process.env.LIVEKIT_API_SECRET),false);});
test('POST creates a room-scoped token for a registered authenticated device',async()=>{const r=await handler(new Request('http://localhost/.netlify/functions/livekit-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Test Guest',deviceId,deviceToken:deviceToken()})}));const d=await r.json();assert.equal(r.status,200);assert.equal(d.roomName,'test-room');const c=JSON.parse(Buffer.from(d.token.split('.')[1],'base64url').toString());assert.match(c.sub,/^member-Test_Guest-[a-f0-9]{8}$/);assert.equal(c.video.room,'test-room');assert.equal(c.video.roomJoin,true);assert.equal(c.video.canPublish,true);assert.equal(c.video.canSubscribe,true);});
test('POST rejects missing device credentials',async()=>{const r=await handler(new Request('http://localhost/.netlify/functions/livekit-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Guest'})}));assert.equal(r.status,401);});
test('Umukomite token requires signed manager session and authenticated device',async()=>{const r=await handler(new Request('http://localhost/.netlify/functions/livekit-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'umukomite',managerSessionToken:createManagerSession('Test Manager'),deviceId,deviceToken:deviceToken()})}));const d=await r.json();assert.equal(r.status,200);const c=JSON.parse(Buffer.from(d.token.split('.')[1],'base64url').toString());assert.match(c.sub,/^manager-Test_Manager-[a-f0-9]{8}$/);assert.equal(c.metadata,JSON.stringify({role:'umukomite'}));});
test('blocked and meeting-banned devices cannot mint a token',async()=>{for(const state of [{blocked:true},{banned:true}]){mockDevice(state);const r=await handler(new Request('http://localhost/.netlify/functions/livekit-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Guest',deviceId,deviceToken:deviceToken()})}));assert.equal(r.status,403);}});
test('paused site and empty names are rejected',async()=>{mockDevice({paused:true});let r=await handler(new Request('http://localhost/.netlify/functions/livekit-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Guest',deviceId,deviceToken:deviceToken()})}));assert.equal(r.status,403);mockDevice();r=await handler(new Request('http://localhost/.netlify/functions/livekit-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'  ',deviceId,deviceToken:deviceToken()})}));assert.equal(r.status,400);});
test('missing LiveKit credentials fail the health check safely',async()=>{delete process.env.LIVEKIT_API_SECRET;const r=await handler(new Request('http://localhost/.netlify/functions/livekit-token'));assert.equal(r.status,503);assert.equal((await r.json()).configured,false);});
