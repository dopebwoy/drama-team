import test from 'node:test';
import assert from 'node:assert/strict';
import siteAdmin from '../netlify/functions/site-admin.mjs';
import managerLogin from '../netlify/functions/manager-login.mjs';

const keys=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','DEV_MASTER_KEY','DEVICE_TOKEN_SECRET','MANAGER_SESSION_SECRET','UMUKOMITE_PASSWORD'];
const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
let previousFetch;
const settings=new Map([['site_paused',false]]);

test('developer password update in site_settings is accepted by manager login',async()=>{
  process.env.SUPABASE_URL='https://password-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY='test-service-key';
  process.env.DEV_MASTER_KEY='local-test-developer-key';
  process.env.DEVICE_TOKEN_SECRET='device-test-secret-value-with-32-chars';
  process.env.MANAGER_SESSION_SECRET='session-test-secret-value-with-32-chars';
  process.env.UMUKOMITE_PASSWORD='initial-fallback-password';
  previousFetch=globalThis.fetch;
  globalThis.fetch=async(url,options={})=>{
    const parsed=new URL(String(url));
    assert.match(parsed.pathname,/\/rest\/v1\/site_settings$/);
    if(options.method==='POST'){
      const row=JSON.parse(options.body);settings.set(row.key,row.value);
      return new Response(JSON.stringify([{key:row.key,value:row.value}]),{status:201});
    }
    const key=parsed.searchParams.get('key')?.match(/eq\.(.+)/)?.[1];
    return new Response(JSON.stringify(settings.has(key)?[{value:settings.get(key)}]:[]),{status:200});
  };
  try {
    const login=await siteAdmin(new Request('http://localhost/.netlify/functions/site-admin',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer placeholder'},body:JSON.stringify({action:'developer-login',developerKey:process.env.DEV_MASTER_KEY})}));
    const {token}=await login.json();
    const updated=await siteAdmin(new Request('http://localhost/.netlify/functions/site-admin',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action:'developer-setting',key:'umukomite_password',value:'new-custom-password-2026'})}));
    assert.equal(updated.status,200);
    const response=await managerLogin(new Request('http://localhost/.netlify/functions/manager-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Any committee member name',password:'new-custom-password-2026'})}));
    assert.equal(response.status,200);
    const invalid=await managerLogin(new Request('http://localhost/.netlify/functions/manager-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Another member',password:'initial-fallback-password'})}));
    assert.equal(invalid.status,401);
  } finally {
    globalThis.fetch=previousFetch;
    for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
  }
});
