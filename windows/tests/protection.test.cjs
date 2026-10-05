const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { createProtection, atomicWrite } = require('../electron/protection.cjs');
async function setup(t, options) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'beat-protection-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return createProtection(root, options); }
function doc(text = 'unsaved') { return { id: randomUUID(), model: { original: 'original' }, text, filePath: null, dirty: true, protectedPaths: new Set() }; }
test('recovery survives a fresh process store without writing the source file', async t => {
  const store = await setup(t), document = doc('INT. ROOM - DAY\n\n你好 🐙\n');
  document.filePath = path.join(store.root, 'original.fountain'); await fs.writeFile(document.filePath, 'original');
  document.protectedPaths.add(document.filePath);
  store.schedule(document); await store.flush();
  const restarted = createProtection(store.root); const { records } = await restarted.list();
  assert.equal(records.length, 1); assert.equal(records[0].record.text, document.text); assert.equal(records[0].record.original, 'original');
  assert.deepEqual(records[0].record.protectedPaths, [document.filePath]); assert.equal(await fs.readFile(document.filePath, 'utf8'), 'original');
});
test('debouncing stores the last edit and maximum wait checkpoints continuous edits', async t => {
  const store = await setup(t, { debounceMs: 80, maxWaitMs: 35 }), document = doc();
  for (let i = 0; i < 6; i++) { document.text = String(i); store.schedule(document); await new Promise(r => setTimeout(r, 10)); }
  const sessions = await fs.readdir(store.recoveryRoot); assert.ok(sessions.length);
  await store.flush(); assert.equal((await store.list()).records[0].record.text, '5');
});
test('queued checkpoints cannot resurrect a saved or explicitly discarded document', async t => {
  const store = await setup(t), document = doc(); store.schedule(document); const writing = store.flush(); await store.clear(document); await writing;
  assert.equal((await store.list()).records.length, 0);
  store.schedule(document); await store.clear(document); assert.equal((await store.list()).records.length, 0);
});
test('document changes preserve both pending unsaved drafts', async t => {
  const store = await setup(t), a = doc('first'), b = doc('second'); store.schedule(a); store.schedule(b); await store.flush();
  assert.deepEqual((await store.list()).records.map(x => x.record.text).sort(), ['first', 'second']);
});
test('instances isolate recovery and recovered drafts persist until explicitly resolved', async t => {
  const a = await setup(t), b = createProtection(a.root), old = doc(); a.schedule(old); await a.flush();
  const entry = (await b.list()).records[0], restored = doc('recovered'); restored.recoverySource = entry.key;
  b.schedule(restored); await b.flush(); assert.equal((await a.list()).records.length, 2);
  await b.clear(restored); assert.equal((await a.list()).records.length, 0);
});
test('clean checkpoints remove obsolete recovery without touching another instance', async t => {
  const a = await setup(t), b = createProtection(a.root), one = doc(), two = doc(); a.schedule(one); b.schedule(two); await a.flush(); await b.flush();
  one.dirty = false; a.schedule(one); await a.flush(); assert.equal((await b.list()).records.length, 1);
});
test('malformed recovery is isolated and preserved for inspection', async t => {
  const store = await setup(t); const session = randomUUID(), id = randomUUID(); const p = path.join(store.recoveryRoot, session, `${id}.json`);
  await atomicWrite(p, '{broken'); const valid = doc(); store.schedule(valid); await store.flush();
  const found = await store.list(); assert.equal(found.records.length, 1); assert.equal(found.invalid.length, 1); assert.equal(await fs.readFile(p, 'utf8'), '{broken');
});
test('backups preserve exact BOM, line endings, metadata and arbitrary bytes', async t => {
  const store = await setup(t), target = path.join(store.root, 'sample.fountain'), bytes = Buffer.from('\uFEFFINT. ROOM - DAY\r\n\r\n/** settings: {"tags":[]} */');
  const first = await store.backup(target, bytes), second = await store.backup(target, bytes);
  assert.notEqual(first, second); assert.deepEqual(await fs.readFile(first), bytes); assert.deepEqual(await fs.readFile(second), bytes);
  const binary = Buffer.from([0, 255, 128]); assert.deepEqual(await fs.readFile(await store.backup(target, binary)), binary);
});
test('backup failure is surfaced before a caller can overwrite its source', async t => {
  const store = await setup(t); await fs.writeFile(store.backupRoot, 'blocked'); const target = path.join(store.root, 'source.fountain'); await fs.writeFile(target, 'preserved');
  await assert.rejects(store.backup(target, Buffer.from('preserved'))); assert.equal(await fs.readFile(target, 'utf8'), 'preserved');
});
test('storage errors are reported and unsafe recovery references are rejected', async t => {
  const errors = []; const store = await setup(t, { onError: e => errors.push(e.message) }); await fs.writeFile(store.recoveryRoot, 'blocked');
  store.schedule(doc()); await assert.rejects(store.flush()); assert.ok(errors.length);
  await assert.rejects(store.clear({ ...doc(), recoverySource: '../../source' }));
});


test('repeated crash recovery clears its complete ancestry', async t => {
  const store = await setup(t), original = doc('first'); store.schedule(original); await store.flush();
  const firstKey = (await store.list()).records[0].key;
  const second = doc('second'); second.recoverySource = firstKey; store.schedule(second); await store.flush();
  const secondKey = (await store.list()).records.find(item => item.record.id === second.id).key;
  const third = doc('third'); third.recoverySource = secondKey; store.schedule(third); await store.flush();
  await store.clear(third); assert.equal((await store.list()).records.length, 0);
});
test('backup history names its source and retains the newest 50 versions', async t => {
  const store = await setup(t), target = path.join(store.root, 'original.fountain');
  for (let i = 0; i < 52; i++) await store.backup(target, Buffer.from(String(i)));
  const history = await store.backups(); assert.equal(history.length, 50);
  assert.ok(history.every(item => item.sourcePath === target));
  assert.equal(await fs.readFile(history[0].filePath, 'utf8'), '51');
});
test('live session ownership isolates another instance recovery selection', async t => {
  const first = await setup(t, { activeSession: true }), draft = doc(); first.schedule(draft); await first.flush();
  const other = createProtection(first.root, { activeSession: true });
  assert.equal((await other.list()).records.length, 0);
  first.dispose(); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await other.list()).records.length, 1); other.dispose();
  await new Promise(resolve => setTimeout(resolve, 30));
});
test('commit guard failure preserves destination and removes temporary files', async t => {
  const store = await setup(t), target = path.join(store.root, 'original.fountain'); await fs.writeFile(target, 'original');
  await assert.rejects(atomicWrite(target, 'edited', () => { throw new Error('conflict'); }), /conflict/);
  assert.equal(await fs.readFile(target, 'utf8'), 'original');
  assert.deepEqual(await fs.readdir(store.root), ['original.fountain']);
});
