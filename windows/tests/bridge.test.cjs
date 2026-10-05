const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createBridge } = require('../electron/bridge.cjs');

async function fixture(t, onRequest = async (command, params) => ({ command, params })) {
  await fs.mkdir('work/bridge-tests', { recursive: true });
  const folder = await fs.mkdtemp(path.resolve('work/bridge-tests/session-'));
  const file = path.join(folder, 'connection.json');
  const bridge = await createBridge({ connectionFile: file, onRequest });
  t.after(() => bridge.close());
  const connection = JSON.parse(await fs.readFile(file, 'utf8'));
  const request = (body = { command: 'get-document' }, headers = {}) => fetch(`${connection.url}/v1/command`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connection.token}`, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { bridge, connection, file, request };
}
test('local bridge binds to loopback and authenticates every endpoint', async t => {
  const { connection, request } = await fixture(t);
  assert.equal(new URL(connection.url).hostname, '127.0.0.1');
  assert.equal((await fetch(`${connection.url}/health`)).status, 401);
  assert.equal((await request({}, { Authorization: 'Bearer invalid' })).status, 401);
  const health = await fetch(`${connection.url}/health`, { headers: { Authorization: `Bearer ${connection.token}` } });
  assert.equal((await health.json()).instanceId, connection.instanceId);
  assert.equal((await request()).status, 200);
});
test('browser origins, cross-site headers and forged hosts are rejected', async t => {
  const { request, connection } = await fixture(t);
  for (const headers of [{ Origin: 'https://example.com' }, { 'Sec-Fetch-Site': 'same-origin' }]) assert.equal((await request(undefined, headers)).status, 403, JSON.stringify(headers));
  // fetch owns the Host header; a raw request is needed to test a forged one.
  const forged = await new Promise((resolve, reject) => {
    const req = require('node:http').request(`${connection.url}/health`, { headers: { Host: 'example.com', Authorization: `Bearer ${connection.token}` } }, response => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(forged, 403);
});
test('invalid JSON, command shape, content type and oversized requests are rejected', async t => {
  const { request } = await fixture(t);
  assert.equal((await request('{broken')).status, 400);
  assert.equal((await request([])).status, 400);
  assert.equal((await request({ command: 'edit', params: [] })).status, 400);
  assert.equal((await request({}, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await request(JSON.stringify({ command: 'edit', params: { text: 'x'.repeat(2 * 1024 * 1024) } }))).status, 413);
});
test('concurrent commands execute serially and semantic errors are reported', async t => {
  let active = 0, peak = 0;
  const { request } = await fixture(t, async command => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 15)); active--;
    if (command === 'conflict') throw Object.assign(new Error('Changed'), { code: 'CONFLICT', status: 409 });
    return command;
  });
  const responses = await Promise.all([request({ command: 'one' }), request({ command: 'two' })]);
  assert.equal(peak, 1); assert.deepEqual(await Promise.all(responses.map(response => response.json().then(packet => packet.result))), ['one', 'two']);
  const error = await request({ command: 'conflict' }); assert.equal(error.status, 409); assert.equal((await error.json()).error.code, 'CONFLICT');
});
test('pausing removes its descriptor and does not remove a newer instance descriptor', async t => {
  const first = await fixture(t); await first.bridge.close(); await assert.rejects(fs.readFile(first.file), /ENOENT/);
  const second = await fixture(t); await fs.writeFile(second.file, JSON.stringify({ instanceId: 'newer-instance' })); await second.bridge.close();
  assert.equal(JSON.parse(await fs.readFile(second.file)).instanceId, 'newer-instance');
});
test('CLI client discovers fresh connection tokens and rejects non-local descriptors', async t => {
  const { callBeat } = await import('../automation/client.mjs');
  const { file } = await fixture(t);
  assert.equal((await callBeat('get-outline', { query: 'room' }, file)).command, 'get-outline');
  await fs.writeFile(file, JSON.stringify({ protocol: 1, url: 'https://example.com/', token: 'a'.repeat(64) }));
  await assert.rejects(callBeat('get-document', {}, file), /Invalid local/);
});
test('MCP client can discover tools, read and edit through the adapter', async () => {
  const { createBeatMcp } = await import('../automation/mcp.mjs');
  const { Client, InMemoryTransport } = require('@modelcontextprotocol/client');
  const calls = [];
  const server = createBeatMcp(async (command, params) => { calls.push({ command, params }); return { documentId: 'test', revision: 1 }; });
  const client = new Client({ name: 'beat-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const listed = await client.listTools(); assert.equal(listed.tools.length, 11);
    await client.callTool({ name: 'beat_get_document', arguments: {} });
    await client.callTool({ name: 'beat_apply_edits', arguments: { documentId: 'test', revision: 1, edits: [{ from: 0, to: 0, insert: 'Hello', expectedText: '' }] } });
    assert.equal(calls[0].command, 'get-document'); assert.equal(calls[1].command, 'edit');
    const invalid = await client.callTool({ name: 'beat_apply_edits', arguments: { edits: [] } });
    assert.equal(invalid.isError, true); assert.equal(calls.length, 2);
  } finally { await client.close(); await server.close(); }
});
