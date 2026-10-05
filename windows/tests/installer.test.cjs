const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const quote = value => "'" + value.replaceAll("'", "''") + "'";
async function fixture(t, entry) {
  const base = path.resolve('work'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'installer-test-'));
  t.after(async () => { assert.ok(root.startsWith(base + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  const payload = path.join(root, 'BEAT-Windows.zip');
  const command = `Add-Type -AssemblyName System.IO.Compression,System.IO.Compression.FileSystem; $beatZip=[System.IO.Compression.ZipFile]::Open(${quote(payload)},[System.IO.Compression.ZipArchiveMode]::Create); $beatZip.CreateEntry(${quote(entry)}) | Out-Null; $beatZip.Dispose()`;
  const zipped = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
  assert.equal(zipped.status, 0, String(zipped.error ?? zipped.status));
  const bytes = await fs.readFile(payload), hash = createHash('sha256').update(bytes).digest('hex').toUpperCase();
  const source = (await fs.readFile('scripts/installer.ps1', 'utf8')).replaceAll('@VERSION@', '0.11.0').replaceAll('@HASH@', hash);
  const script = path.join(root, 'Install.ps1'); await fs.writeFile(script, source);
  const log = path.join(root, 'validation.log');
  return { payload, script, run: async () => {
    const command = `$ErrorActionPreference='Stop'; try { & ${quote(script)} -ValidateOnly 2>&1 | Out-File -LiteralPath ${quote(log)} -Encoding UTF8; exit 0 } catch { $_ | Out-File -LiteralPath ${quote(log)} -Encoding UTF8; exit 1 }`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { stdio: ['ignore','inherit','inherit'], windowsHide: true });
    return { status: result.status, output: await fs.readFile(log, 'utf8') };
  } };
}
test('unsigned installer validates a safe payload and rejects changed bytes before extraction', async t => {
  const f = await fixture(t, 'BEAT Windows-win32-x64/BEAT Windows.exe');
  let result = await f.run(); assert.equal(result.status, 0, result.output); assert.match(result.output, /Validated unsigned/);
  await fs.appendFile(f.payload, 'changed'); result = await f.run(); assert.notEqual(result.status, 0); assert.match(result.output, /SHA-256/);
});
test('installer rejects traversal and unexpected archive roots before writing application files', async t => {
  for (const entry of ['BEAT Windows-win32-x64/../escape.txt', 'unexpected/BEAT Windows.exe']) {
    const f = await fixture(t, entry), result = await f.run(); assert.notEqual(result.status, 0); assert.match(result.output, /Unsafe installer archive entry/);
  }
});
