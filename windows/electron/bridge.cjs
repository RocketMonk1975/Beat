const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const MAX_BODY = 2 * 1024 * 1024;
function failure(code, message, status) { return Object.assign(new Error(message), { code, status }); }

async function createBridge({ connectionFile, onRequest }) {
  const token = randomBytes(32).toString('hex');
  const instanceId = randomUUID();
  let tail = Promise.resolve(), pending = 0, closed = false;
  const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
  const readBody = req => new Promise((resolve, reject) => {
    const chunks = []; let size = 0, exceeded = false;
    req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) { if (!exceeded) reject(failure('TOO_LARGE', 'Command body exceeds 2 MB.', 413)); exceeded = true; } else if (!exceeded) chunks.push(chunk); });
    req.on('error', reject);
    req.on('end', () => { if (exceeded) return; try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(failure('INVALID_JSON', 'Send a JSON command object.', 400)); } });
  });
  const server = http.createServer(async (req, res) => {
    try {
      if (closed) throw failure('UNAVAILABLE', 'The connection is paused.', 503);
      const expectedHost = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== expectedHost || req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined) throw failure('FORBIDDEN', 'Browser-origin requests are not allowed.', 403);
      const authorization = Buffer.from(req.headers.authorization ?? '');
      const expected = Buffer.from(`Bearer ${token}`);
      if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) throw failure('UNAUTHORIZED', 'A current local connection token is required.', 401);
      if (req.method === 'GET' && req.url === '/health') { json(res, 200, { ok: true, protocol: 1, version: '0.2.0', instanceId }); return; }
      if (req.method !== 'POST' || req.url !== '/v1/command') throw failure('NOT_FOUND', 'Unknown endpoint.', 404);
      if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw failure('INVALID_CONTENT_TYPE', 'Use application/json.', 415);
      if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) { req.resume(); throw failure('TOO_LARGE', 'Command body exceeds 2 MB.', 413); }
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.command !== 'string' || (body.params !== undefined && (!body.params || typeof body.params !== 'object' || Array.isArray(body.params)))) throw failure('INVALID_COMMAND', 'Provide command and an optional params object.', 400);
      if (pending >= 16) throw failure('BUSY', 'Too many queued commands.', 429);
      pending++;
      try {
        const result = tail.then(() => { if (closed) throw failure('UNAVAILABLE', 'The connection is paused.', 503); return onRequest(body.command, body.params ?? {}); });
        tail = result.catch(() => {});
        json(res, 200, { ok: true, result: await result });
      } finally { pending--; }
    } catch (error) { if (!res.headersSent) json(res, error.status ?? 500, { ok: false, error: { code: typeof error.code === 'string' ? error.code : 'INTERNAL_ERROR', message: error.message } }); }
  });
  server.headersTimeout = 10000; server.requestTimeout = 15000; server.maxConnections = 32;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  server.on('error', () => {});
  const descriptor = { protocol: 1, instanceId, pid: process.pid, url: `http://127.0.0.1:${server.address().port}`, token, startedAt: new Date().toISOString() };
  try { await fs.mkdir(path.dirname(connectionFile), { recursive: true }); await fs.writeFile(connectionFile, JSON.stringify(descriptor), { encoding: 'utf8', mode: 0o600 }); }
  catch (error) { server.close(); throw error; }
  return {
    connectionFile, instanceId,
    async close() {
      if (closed) return; closed = true;
      await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
      try { const latest = JSON.parse(await fs.readFile(connectionFile, 'utf8')); if (latest.instanceId === instanceId) await fs.unlink(connectionFile); } catch {}
    }
  };
}
module.exports = { createBridge };
