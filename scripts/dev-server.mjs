import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tokenHandler from '../netlify/functions/livekit-token.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(projectRoot, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};
const blockedRoots = new Set(['.git', '.netlify', '.vscode', 'node_modules', 'netlify', 'scripts', 'supabase', 'test']);
const blockedFiles = new Set(['package.json', 'package-lock.json', '.gitignore', 'netlify.toml']);

async function serveFunction(request, response, handler) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const webRequest = new Request(`http://${request.headers.host}${request.url}`, {
    method: request.method,
    headers: request.headers,
    ...(body ? { body } : {})
  });
  const webResponse = await handler(webRequest);
  response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers.entries()));
  response.end(Buffer.from(await webResponse.arrayBuffer()));
}

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const functionMatch = pathname.match(/^\/.netlify\/functions\/(contact-submit|contact-messages|gallery-media-delete|livekit-token|livekit-status|livekit-moderate|manager-login|push-config|push-subscribe|push-unsubscribe|contributions|site-admin)$/);
    if (functionMatch) {
      const functionModule = functionMatch[1] === 'livekit-token'
        ? { default: tokenHandler }
        : await import(`../netlify/functions/${functionMatch[1]}.mjs`);
      await serveFunction(request, response, functionModule.default);
      return;
    }
    if (pathname === '/api/livekit-token') {
      await serveFunction(request, response, tokenHandler);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('Method not allowed');
      return;
    }

    const decodedPath = decodeURIComponent(pathname);
    const publicPath = decodedPath === '/' ? '/index.html' : decodedPath;
    const segments = publicPath.split(/[\\/]+/).filter(Boolean);
    const resolvedPath = path.resolve(projectRoot, `.${publicPath}`);
    const relativePath = path.relative(projectRoot, resolvedPath);
    if (segments.some(segment => blockedRoots.has(segment) || segment.startsWith('.')) ||
        blockedFiles.has(path.basename(resolvedPath).toLowerCase()) ||
        relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    const fileInfo = await stat(resolvedPath);
    if (!fileInfo.isFile()) throw Object.assign(new Error('Not found'), { code: 'ENOENT' });
    const contentType = contentTypes[path.extname(resolvedPath).toLowerCase()] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : await readFile(resolvedPath));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof URIError) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    console.error('Local dev server request failed:', error);
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Local server error');
  }
});

const port = Number(process.env.PORT || 8888);
server.listen(port, '127.0.0.1', () => {
  console.log(`Drama Team dev server: http://127.0.0.1:${port}`);
  console.log(`LiveKit config: ${process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET ? 'ready' : 'missing server variables (see .env.example)'}`);
});
