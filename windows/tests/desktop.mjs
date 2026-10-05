import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import electron from 'electron';
await mkdir('work/desktop-test', { recursive: true });
const child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, BEAT_SMOKE_TEST: '1', BEAT_USER_DATA: resolve('work/desktop-test/user-data') } });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
