import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const defaultConnectionFile = resolve(fileURLToPath(new URL('../../../work/codex-bridge.json', import.meta.url)));
export async function callBeat(command, params = {}, connectionFile = process.env.BEAT_CONNECTION_FILE ?? defaultConnectionFile) {
  let connection;
  try { connection = JSON.parse(await readFile(connectionFile, 'utf8')); }
  catch { throw new Error('BEAT is not connected. Launch the updated app and enable its local Codex connection.'); }
  const url = new URL(connection.url);
  if (connection.protocol !== 1 || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !/^[a-f0-9]{64}$/.test(connection.token ?? '')) throw new Error('Invalid local BEAT connection descriptor.');
  let response;
  try { response = await fetch(`${url.origin}/v1/command`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connection.token}` }, body: JSON.stringify({ command, params }), redirect: 'error', signal: AbortSignal.timeout(30000) }); }
  catch { throw new Error('BEAT did not respond. Check the app and current document before retrying a change.'); }
  const packet = await response.json();
  if (!response.ok || !packet.ok) throw Object.assign(new Error(packet.error?.message ?? 'BEAT command failed.'), { code: packet.error?.code, status: response.status });
  return packet.result;
}
