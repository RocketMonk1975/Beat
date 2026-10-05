const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const uuid = /^[a-f0-9-]{36}$/i;
const limit = 20 * 1024 * 1024;
async function atomicWrite(target, data, beforeCommit) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(data); await handle.sync(); await handle.close(); handle = null;
    if (beforeCommit) await beforeCommit();
    await fs.rename(temporary, target);
  } finally { if (handle) await handle.close().catch(() => {}); await fs.unlink(temporary).catch(() => {}); }
}
function validate(record) {
  if (record?.version !== 1 || !uuid.test(record.id ?? '') || typeof record.text !== 'string' || record.text.length > limit || typeof record.original !== 'string' || record.original.length > limit || !Number.isFinite(record.updatedAt) || !Array.isArray(record.protectedPaths) || record.protectedPaths.some(p => typeof p !== 'string' || !path.isAbsolute(p)) || !(record.recoveredFrom == null || typeof record.recoveredFrom === 'string' && record.recoveredFrom.split('/').length === 2 && record.recoveredFrom.split('/').every(part => uuid.test(part))) || !(record.sourcePath === null || typeof record.sourcePath === 'string' && path.isAbsolute(record.sourcePath))) throw new Error('Invalid recovery record.');
  return record;
}
function createProtection(root, { sessionId = randomUUID(), onError = () => {}, debounceMs = 750, maxWaitMs = 5000, activeSession = false, onCheckpoint = () => {} } = {}) {
  if (!uuid.test(sessionId)) throw new Error('Invalid recovery session.');
  const recoveryRoot = path.join(root, 'recovery'), backupRoot = path.join(root, 'backups');
  const lease = activeSession ? atomicWrite(path.join(recoveryRoot, sessionId, 'owner.json'), JSON.stringify({ pid: process.pid })) : Promise.resolve();
  let queue = lease, latest = null, debounce = null, maximum = null, lastError = null;
  const ownKey = id => `${sessionId}/${id}`;
  const recordPath = key => {
    const parts = String(key).split('/');
    if (parts.length !== 2 || !parts.every(p => uuid.test(p))) throw new Error('Invalid recovery key.');
    return path.join(recoveryRoot, parts[0], `${parts[1]}.json`);
  };
  function enqueue(job) {
    const result = queue.then(job);
    queue = result.catch(error => { lastError = error; onError(error); });
    return result;
  }
  function stopTimers() { clearTimeout(debounce); clearTimeout(maximum); debounce = maximum = null; }
  function persistPending() {
    stopTimers(); const pending = latest; latest = null;
    if (!pending) return queue;
    return enqueue(async () => {
      if (pending.dirty) { await atomicWrite(recordPath(ownKey(pending.record.id)), JSON.stringify(pending.record)); onCheckpoint(pending.record.updatedAt); }
      else await fs.unlink(recordPath(ownKey(pending.record.id))).catch(error => { if (error.code !== 'ENOENT') throw error; });
    });
  }
  function schedule(doc) {
    const record = validate({ version: 1, id: doc.id, updatedAt: Date.now(), sourcePath: doc.filePath,
      original: doc.model.original, text: doc.text, protectedPaths: [...doc.protectedPaths], recoveredFrom: doc.recoverySource ?? null, name: doc.recoveryName ?? (doc.filePath ? path.basename(doc.filePath) : 'Untitled.fountain') });
    if (latest && latest.record.id !== record.id) persistPending().catch(() => {});
    latest = { record, dirty: doc.dirty };
    clearTimeout(debounce); debounce = setTimeout(() => persistPending().catch(() => {}), debounceMs);
    if (!maximum) maximum = setTimeout(() => persistPending().catch(() => {}), maxWaitMs);
  }
  async function flush() { await persistPending(); await queue; if (lastError) { const error = lastError; lastError = null; throw error; } }
  async function clear(doc) {
    if (latest?.record.id === doc.id) { latest = null; stopTimers(); }
    const keys = [ownKey(doc.id), ...(doc.recoverySource ? [doc.recoverySource] : [])];
    await enqueue(async () => {
      // Resolve the full ancestry before deleting anything, so a crash cannot leave an older draft hidden behind a deleted link.
      const pending = [...keys], seen = new Set();
      while (pending.length) {
        const key = pending.shift(); if (seen.has(key)) continue; seen.add(key);
        try { const record = validate(JSON.parse(await fs.readFile(recordPath(key), 'utf8'))); if (record.recoveredFrom) pending.push(record.recoveredFrom); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      // Delete ancestors first; the current copy remains recoverable until the final deletion.
      for (const key of [...seen].reverse()) await fs.unlink(recordPath(key)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    });
  }
  async function list({ excludeId } = {}) {
    await flush(); const records = [], invalid = [];
    const sessions = await fs.readdir(recoveryRoot, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    for (const session of sessions.filter(item => item.isDirectory() && uuid.test(item.name))) {
      if (activeSession && session.name !== sessionId) {
        try {
          const owner = JSON.parse(await fs.readFile(path.join(recoveryRoot, session.name, 'owner.json'), 'utf8'));
          if (Number.isInteger(owner.pid) && owner.pid > 0) { try { process.kill(owner.pid, 0); continue; } catch (error) { if (error.code !== 'ESRCH') continue; } }
        } catch (error) { if (error.code !== 'ENOENT') { invalid.push(`${session.name}/owner.json`); continue; } }
      }
      for (const file of await fs.readdir(path.join(recoveryRoot, session.name))) {
        const id = file.replace(/\.json$/, '');
        if (!file.endsWith('.json') || !uuid.test(id) || id === excludeId) continue;
        const key = `${session.name}/${id}`;
        try {
          const info = await fs.lstat(recordPath(key));
          if (!info.isFile() || info.isSymbolicLink() || info.size > 160 * 1024 * 1024) throw new Error('Invalid recovery file.');
          const record = validate(JSON.parse(await fs.readFile(recordPath(key), 'utf8')));
          if (record.id !== id) throw new Error('Recovery identity mismatch.');
          records.push({ key, record });
        } catch { invalid.push(key); }
      }
    }
    return { records: records.sort((a, b) => b.record.updatedAt - a.record.updatedAt), invalid };
  }
  async function backup(target, previousBytes) {
    if (!Buffer.isBuffer(previousBytes)) throw new Error('Backup requires exact file bytes.');
    if (previousBytes.length > 20 * 1024 * 1024) throw new Error('Existing file is too large for a protected overwrite. Save under another filename.');
    const hash = createHash('sha256').update(path.resolve(target).toLowerCase()).digest('hex');
    const folder = path.join(backupRoot, hash);
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.fountain`;
    const backupPath = path.join(folder, name);
    await atomicWrite(backupPath, previousBytes);
    await atomicWrite(`${backupPath}.json`, JSON.stringify({ sourcePath: path.resolve(target), createdAt: Date.now() }));
    const versions = (await fs.readdir(folder)).filter(name => name.endsWith('.fountain')).sort().reverse();
    for (const old of versions.slice(50)) {
      await fs.unlink(path.join(folder, old));
      await fs.unlink(path.join(folder, `${old}.json`)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    return backupPath;
  }
  async function backups() {
    const entries = [];
    const folders = await fs.readdir(backupRoot).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    for (const folder of folders.filter(name => /^[a-f0-9]{64}$/.test(name))) {
      for (const name of (await fs.readdir(path.join(backupRoot, folder))).filter(name => name.endsWith('.fountain'))) {
        const filePath = path.join(backupRoot, folder, name);
        try {
          const meta = JSON.parse(await fs.readFile(`${filePath}.json`, 'utf8'));
          if (!path.isAbsolute(meta.sourcePath) || !Number.isFinite(meta.createdAt)) continue;
          entries.push({ filePath, ...meta });
        } catch (error) { onError(new Error(`Cannot read backup information: ${filePath}: ${error.message}`)); }
      }
    }
    return entries.sort((a, b) => b.createdAt - a.createdAt);
  }
  function dispose() { stopTimers(); if (activeSession) fs.unlink(path.join(recoveryRoot, sessionId, 'owner.json')).catch(onError); }
  return { backups, dispose, schedule, flush, clear, list, backup, root, recoveryRoot, backupRoot, sessionId };
}
module.exports = { createProtection, atomicWrite, validate };
