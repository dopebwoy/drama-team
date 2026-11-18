import { readFile } from 'node:fs/promises';
import { createHash, createHmac } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(projectRoot, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const keyId = (process.env.B2_CORS_KEY_ID || process.env.B2_KEY_ID)?.trim();
const appKey = (process.env.B2_CORS_APP_KEY || process.env.B2_APP_KEY)?.trim();
const bucketName = process.env.B2_BUCKET_NAME?.trim();
const s3Endpoint = process.env.B2_ENDPOINT?.trim();
const s3Region = process.env.B2_REGION?.trim();

if (!keyId || !appKey || !bucketName || !s3Endpoint || !s3Region || /YOUR_APP_KEY|your_bucket/i.test(appKey + bucketName)) {
  throw new Error('Set B2_KEY_ID, B2_APP_KEY, B2_BUCKET_NAME, B2_ENDPOINT, and B2_REGION in the local environment or .env.');
}

async function b2Request(url, { token, body } = {}) {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(token ? { Authorization: token } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Backblaze API request failed (${response.status}): ${result.message || result.code || 'unknown error'}`);
  }
  return result;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key, value, encoding) {
  return createHmac('sha256', key).update(value).digest(encoding);
}

function s3CorsUrl() {
  const endpoint = new URL(s3Endpoint);
  if (endpoint.protocol !== 'https:' || (endpoint.pathname && endpoint.pathname !== '/')) {
    throw new Error('B2_ENDPOINT must be the HTTPS S3 endpoint without a bucket path.');
  }
  endpoint.pathname = `/${bucketName}`;
  endpoint.search = 'cors=';
  endpoint.hash = '';
  return endpoint;
}

async function signedS3CorsRequest(method, body = '') {
  const url = s3CorsUrl();
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const contentType = 'application/xml';
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${url.host.toLowerCase()}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const canonicalRequest = [
    method,
    url.pathname,
    'cors=',
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  const credentialScope = `${dateStamp}/${s3Region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest)
  ].join('\n');
  const dateKey = hmac(`AWS4${appKey}`, dateStamp);
  const regionKey = hmac(dateKey, s3Region);
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = hmac(signingKey, stringToSign, 'hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${keyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: authorization,
      'Content-Type': contentType,
      'X-Amz-Content-Sha256': payloadHash,
      'X-Amz-Date': amzDate
    },
    ...(method === 'PUT' ? { body } : {})
  });
  const responseBody = await response.text();
  if (!response.ok && !(method === 'GET' && response.status === 404 && /NoSuchCORSConfiguration/i.test(responseBody))) {
    const code = responseBody.match(/<Code>([^<]+)<\/Code>/i)?.[1] || `HTTP ${response.status}`;
    const message = responseBody.match(/<Message>([^<]+)<\/Message>/i)?.[1] || 'S3-compatible CORS request failed.';
    throw new Error(`${code}: ${message}`);
  }
  return { response, responseBody };
}

function tagValues(xml, tagName) {
  const escapedName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...xml.matchAll(new RegExp(`<${escapedName}>([\\s\\S]*?)</${escapedName}>`, 'gi'))]
    .map(match => match[1].trim().replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
}

const requiredS3Origins = ['http://127.0.0.1:5500', 'https://*'];
const requiredS3Methods = ['PUT', 'GET', 'POST', 'HEAD'];

function hasRequiredS3CorsRule(xml) {
  const rules = [...xml.matchAll(/<CORSRule(?:\s[^>]*)?>([\s\S]*?)<\/CORSRule>/gi)].map(match => match[1]);
  return rules.some(rule => {
    const origins = tagValues(rule, 'AllowedOrigin');
    const methods = tagValues(rule, 'AllowedMethod').map(value => value.toUpperCase());
    const headers = tagValues(rule, 'AllowedHeader').map(value => value.toLowerCase());
    const exposed = tagValues(rule, 'ExposeHeader').map(value => value.toLowerCase());
    const maxAge = Number(tagValues(rule, 'MaxAgeSeconds')[0] || 0);
    return requiredS3Origins.every(origin => origins.includes(origin)) &&
      requiredS3Methods.every(method => methods.includes(method)) &&
      headers.includes('*') && exposed.includes('etag') && maxAge >= 3600;
  });
}

function buildS3CorsRule() {
  return '<CORSRule>' +
    requiredS3Origins.map(origin => `<AllowedOrigin>${origin}</AllowedOrigin>`).join('') +
    requiredS3Methods.map(method => `<AllowedMethod>${method}</AllowedMethod>`).join('') +
    '<AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds>' +
    '</CORSRule>';
}

function addS3CorsRule(existingXml) {
  const existingRules = [...existingXml.matchAll(/<CORSRule(?:\s[^>]*)?>[\s\S]*?<\/CORSRule>/gi)].map(match => match[0]);
  return `<?xml version="1.0" encoding="UTF-8"?><CORSConfiguration>${existingRules.join('')}${buildS3CorsRule()}</CORSConfiguration>`;
}

const basicAuth = Buffer.from(`${keyId}:${appKey}`).toString('base64');
const auth = await b2Request('https://api.backblazeb2.com/b2api/v4/b2_authorize_account', {
  token: `Basic ${basicAuth}`
});
const apiUrl = auth.apiInfo?.storageApi?.apiUrl;
if (!apiUrl || !auth.accountId || !auth.authorizationToken) {
  throw new Error('Backblaze authorization response was incomplete.');
}

const listed = await b2Request(`${apiUrl}/b2api/v4/b2_list_buckets`, {
  token: auth.authorizationToken,
  body: { accountId: auth.accountId, bucketName }
});
const bucket = listed.buckets?.find(item => item.bucketName === bucketName);
if (!bucket) throw new Error(`Bucket "${bucketName}" was not found or this key cannot list it.`);

const proposedRules = JSON.parse(await readFile(path.join(projectRoot, 'supabase', 'b2-cors-rules.json'), 'utf8'));
const corsRules = [...(bucket.corsRules || [])];
for (const proposed of proposedRules) {
  const index = corsRules.findIndex(rule => rule.corsRuleName === proposed.corsRuleName);
  if (index === -1) corsRules.push(proposed);
  else corsRules[index] = proposed;
}

function sameStringList(left = [], right = [], caseInsensitive = false) {
  const normalize = value => caseInsensitive ? value.toLowerCase() : value;
  return left.map(normalize).sort().join('\0') === right.map(normalize).sort().join('\0');
}

const ruleStates = proposedRules.map(proposed => {
  const current = (bucket.corsRules || []).find(rule => rule.corsRuleName === proposed.corsRuleName);
  const matches = Boolean(current) &&
    sameStringList(current.allowedOrigins, proposed.allowedOrigins) &&
    sameStringList(current.allowedHeaders, proposed.allowedHeaders, true) &&
    sameStringList(current.allowedOperations, proposed.allowedOperations) &&
    sameStringList(current.exposeHeaders, proposed.exposeHeaders, true) &&
    current.maxAgeSeconds === proposed.maxAgeSeconds;
  return { proposed, current, matches };
});

const s3Cors = await signedS3CorsRequest('GET');
const s3CorsMatches = hasRequiredS3CorsRule(s3Cors.responseBody);

const applying = process.argv.includes('--apply');
const nativeCorsMatches = ruleStates.every(rule => rule.matches);
if (!applying) {
  const existingNames = (bucket.corsRules || []).map(rule => rule.corsRuleName);
  for (const { proposed, current, matches } of ruleStates) {
    console.log(`${proposed.corsRuleName}: ${matches ? 'already matches' : 'will be added or updated'}.`);
    if (current && !matches) console.log(`Current rule: ${JSON.stringify(current)}`);
    if (!matches) console.log(`Requested rule: ${JSON.stringify(proposed)}`);
  }
  console.log(`Dry run for bucket "${bucketName}".`);
  console.log(`Existing CORS rules preserved: ${existingNames.length ? existingNames.join(', ') : 'none'}.`);
  console.log(`S3-compatible CORS: ${s3CorsMatches ? 'already matches' : 'will be added or updated'}; existing S3 rules will be preserved.`);
  if (nativeCorsMatches && s3CorsMatches) console.log('No update is needed.');
  else console.log('Run `npm run b2:cors -- --apply` to write the merged rules for both APIs.');
  process.exit(0);
}

const capabilities = auth.apiInfo?.storageApi?.allowed?.capabilities || [];
if (!capabilities.includes('all') && !capabilities.includes('writeBuckets')) {
  throw new Error('This key cannot update bucket settings. Use a Backblaze key with writeBuckets for this one-time change.');
}

let updatedCorsRules = bucket.corsRules || [];
if (!nativeCorsMatches) {
  const updated = await b2Request(`${apiUrl}/b2api/v4/b2_update_bucket`, {
    token: auth.authorizationToken,
    body: {
      accountId: auth.accountId,
      bucketId: bucket.bucketId,
      corsRules
    }
  });
  updatedCorsRules = updated.corsRules || corsRules;
}

if (!s3CorsMatches) {
  const updatedS3Cors = await signedS3CorsRequest('PUT', addS3CorsRule(s3Cors.responseBody));
  if (!updatedS3Cors.response.ok) throw new Error('Backblaze did not confirm the S3-compatible CORS update.');
}

console.log(`Updated CORS settings for bucket "${bucketName}".`);
console.log(`Native API CORS rules: ${updatedCorsRules.map(rule => rule.corsRuleName).join(', ') || 'none'}.`);
console.log(`S3-compatible CORS rule: ${s3CorsMatches ? 'already matched' : 'updated'}.`);
