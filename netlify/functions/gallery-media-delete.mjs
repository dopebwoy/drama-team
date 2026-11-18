import { verifyManagerSession } from '../manager-session.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }
});

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Gallery deletion needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Netlify.');
  }

  const url = new URL(supabaseUrl);
  if (url.protocol !== 'https:') throw new Error('Supabase deletion endpoint must use HTTPS.');
  return { supabaseUrl: url.origin, serviceKey };
}

function getB2Config() {
  const config = {
    b2Endpoint: process.env.B2_ENDPOINT?.trim(),
    b2Region: process.env.B2_REGION?.trim(),
    b2Bucket: process.env.B2_BUCKET_NAME?.trim(),
    b2KeyId: process.env.B2_KEY_ID?.trim(),
    b2AppKey: process.env.B2_APP_KEY?.trim()
  };
  if (!config.b2Endpoint || !config.b2Region || !config.b2Bucket || !config.b2KeyId || !config.b2AppKey) {
    throw new Error('Video deletion needs the B2 endpoint, region, bucket, and a standard application key in Netlify.');
  }

  const b2Endpoint = new URL(config.b2Endpoint);
  if (b2Endpoint.protocol !== 'https:' || b2Endpoint.pathname !== '/') {
    throw new Error('B2 endpoint must be an HTTPS S3 service URL without a bucket path.');
  }
  return { ...config, b2Endpoint: b2Endpoint.origin };
}

function responseMessage(payload, fallback) {
  const detail = [payload?.message, payload?.error, payload?.msg]
    .find(value => typeof value === 'string' && value.trim());
  return detail || fallback;
}

async function supabaseRequest(config, pathname, options = {}) {
  const authHeaders = config.serviceKey.startsWith('sb_secret_')
    ? {}
    : { Authorization: `Bearer ${config.serviceKey}` };
  const response = await fetch(`${config.supabaseUrl}${pathname}`, {
    ...options,
    headers: {
      apikey: config.serviceKey,
      ...authHeaders,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const payload = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
  if (!response.ok) {
    const method = (options.method || 'GET').toUpperCase();
    const resource = pathname.split('?')[0];
    const code = typeof payload?.code === 'string' ? ` ${payload.code}` : '';
    const detail = responseMessage(payload, '');
    throw new Error(`${method} ${resource} failed (${response.status}${code})${detail ? `: ${detail}` : ''}.`);
  }
  return payload;
}

async function removePhotoStorage(config, paths) {
  if (!paths.length) return;
  const response = await supabaseRequest(config, '/storage/v1/object/photos', {
    method: 'DELETE',
    body: JSON.stringify({ prefixes: paths })
  });
  return response;
}

async function b2Request(apiUrl, path, token, body) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { /* handled below */ }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Backblaze denied permanent deletion. The Netlify B2 key needs listFiles and deleteFiles for the videos/ prefix.');
    }
    throw new Error(responseMessage(payload, `Backblaze request failed (${response.status}).`));
  }
  return payload;
}

async function authorizeB2(config, fileKey) {
  const basic = Buffer.from(`${config.b2KeyId}:${config.b2AppKey}`).toString('base64');
  const response = await fetch('https://api.backblazeb2.com/b2api/v4/b2_authorize_account', {
    headers: { Authorization: `Basic ${basic}` }
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { /* handled below */ }
  if (!response.ok) {
    throw new Error(responseMessage(payload, `Could not authorize the Backblaze key (${response.status}).`));
  }

  const storageApi = payload?.apiInfo?.storageApi;
  const allowed = storageApi?.allowed;
  const capabilities = allowed?.capabilities || [];
  if (!capabilities.includes('listFiles') || !capabilities.includes('deleteFiles')) {
    throw new Error('The Netlify B2 key needs listFiles and deleteFiles capabilities, scoped to the videos/ prefix.');
  }

  const allowedBuckets = Array.isArray(allowed.buckets) ? allowed.buckets : [];
  let bucket = allowedBuckets.find(item => item.name === config.b2Bucket);
  if (!bucket && allowedBuckets.length === 1 && !allowedBuckets[0].name) {
    // B2 can hide the restricted bucket's name when the key lacks listBuckets.
    bucket = allowedBuckets[0];
  }
  if (!bucket && capabilities.includes('listBuckets')) {
    const listed = await b2Request(storageApi.apiUrl, '/b2api/v4/b2_list_buckets', payload.authorizationToken, {
      accountId: payload.accountId,
      bucketName: config.b2Bucket
    });
    bucket = (listed.buckets || []).find(item => item.bucketName === config.b2Bucket);
  }
  if (!(bucket?.id || bucket?.bucketId)) {
    throw new Error('The Netlify B2 key must be scoped to the configured bucket, or include listBuckets so its bucket ID can be resolved.');
  }
  if (allowed.namePrefix && !fileKey.startsWith(allowed.namePrefix)) {
    throw new Error('The Netlify B2 key prefix does not allow this video file. Scope it to videos/ to manage the gallery.');
  }

  return {
    apiUrl: storageApi.apiUrl,
    token: payload.authorizationToken,
    bucketId: bucket.id || bucket.bucketId
  };
}

async function deleteB2FileVersions(config, fileKey) {
  const auth = await authorizeB2(config, fileKey);
  const versions = [];
  let startFileName = fileKey;
  let startFileId;
  const seenCursors = new Set();

  for (let page = 0; page < 100; page++) {
    const body = {
      bucketId: auth.bucketId,
      prefix: fileKey,
      startFileName,
      maxFileCount: 1000
    };
    if (startFileId) body.startFileId = startFileId;

    const listed = await b2Request(auth.apiUrl, '/b2api/v4/b2_list_file_versions', auth.token, body);
    for (const version of listed.files || []) {
      if (version.fileName === fileKey && version.fileId) versions.push(version);
    }

    if (!listed.nextFileName || listed.nextFileName !== fileKey || !listed.nextFileId) break;
    const cursor = `${listed.nextFileName}\n${listed.nextFileId}`;
    if (seenCursors.has(cursor)) throw new Error('Backblaze returned a repeated file-version cursor; deletion stopped safely.');
    seenCursors.add(cursor);
    startFileName = listed.nextFileName;
    startFileId = listed.nextFileId;
    if (page === 99) throw new Error('This B2 object has too many versions to safely delete in one request.');
  }

  for (const version of versions) {
    await b2Request(auth.apiUrl, '/b2api/v4/b2_delete_file_version', auth.token, {
      fileName: fileKey,
      fileId: version.fileId
    });
  }
}

async function deletePhoto(config, id, { skipStorage = false } = {}) {
  const query = new URLSearchParams({ select: 'id,storage_path', id: `eq.${id}` });
  const rows = await supabaseRequest(config, `/rest/v1/photos?${query}`);
  const photo = Array.isArray(rows) ? rows[0] : null;
  if (!photo) return;

  const paths = photo.storage_path
    ? [photo.storage_path, `${photo.storage_path}.thumb.webp`]
    : [];
  if (!skipStorage) await removePhotoStorage(config, paths);

  const deleteQuery = new URLSearchParams({ id: `eq.${id}`, select: 'id' });
  const deleted = await supabaseRequest(config, `/rest/v1/photos?${deleteQuery}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' }
  });
  if (!Array.isArray(deleted) || deleted.length === 0) {
    throw new Error('The photo record was not removed from Supabase. Refresh and retry.');
  }
}

async function deleteVideo(config, id) {
  const query = new URLSearchParams({ select: 'id,file_key,thumbnail_path', id: `eq.${id}` });
  const rows = await supabaseRequest(config, `/rest/v1/videos?${query}`);
  const video = Array.isArray(rows) ? rows[0] : null;
  if (!video) return;
  if (typeof video.file_key !== 'string' || !/^videos\/[0-9a-f-]{36}(?:\.[a-z0-9]{1,10})?$/i.test(video.file_key)) {
    throw new Error('The video has an invalid B2 file key; its record was kept.');
  }

  await deleteB2FileVersions(config, video.file_key);
  if (typeof video.thumbnail_path === 'string' && /^video-thumbnails\/[0-9a-f-]{36}\.jpg$/i.test(video.thumbnail_path)) {
    await removePhotoStorage(config, [video.thumbnail_path]);
  }

  const deleteQuery = new URLSearchParams({ id: `eq.${id}`, select: 'id' });
  const deleted = await supabaseRequest(config, `/rest/v1/videos?${deleteQuery}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' }
  });
  if (!Array.isArray(deleted) || deleted.length === 0) {
    throw new Error('The video file was removed, but its database record remains. Retry to finish cleanup.');
  }
}

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Request body must be valid JSON.' }, 400); }

  if (!verifyManagerSession(body?.sessionToken)) {
    return json({ error: 'A valid Umukomite sign-in is required.' }, 401);
  }

  const mediaType = body?.mediaType;
  const ids = Array.isArray(body?.ids)
    ? [...new Set(body.ids
        .map(id => typeof id === 'number' && Number.isSafeInteger(id) && id >= 0 ? String(id) : id)
        .filter(id => typeof id === 'string' && (/^[0-9a-f-]{36}$/i.test(id) || /^\d{1,20}$/.test(id))))]
    : [];
  if (!['photo', 'video'].includes(mediaType) || !ids.length || ids.length > 50) {
    return json({ error: 'Choose up to 50 valid gallery items to delete.' }, 400);
  }

  let config;
  try {
    config = getSupabaseConfig();
    if (mediaType === 'video') config = { ...config, ...getB2Config() };
  }
  catch (error) { return json({ error: error.message }, 503); }

  const deletedIds = [];
  const failed = [];
  for (const id of ids) {
    try {
      if (mediaType === 'photo') await deletePhoto(config, id, { skipStorage: body.skipStorage === true });
      else await deleteVideo(config, id);
      deletedIds.push(id);
    } catch (error) {
      console.error(`Gallery ${mediaType} deletion failed:`, error.message);
      failed.push({ id, error: error.message || 'Could not delete this item.' });
    }
  }

  return json({ deletedIds, failed });
}
