import { readFile } from 'node:fs/promises';
import { callBeat } from './client.mjs';
const [command = 'get-document', input] = process.argv.slice(2);
try {
  const params = input ? JSON.parse(input.startsWith('@') ? await readFile(input.slice(1), 'utf8') : input) : {};
  console.log(JSON.stringify(await callBeat(command, params), null, 2));
} catch (error) { console.error(JSON.stringify({ error: error.code ?? 'CONNECTION_ERROR', message: error.message })); process.exitCode = 1; }
