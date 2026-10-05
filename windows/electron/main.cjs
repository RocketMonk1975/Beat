const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { decodeDocument, encodeDocument } = require('../dist/document.cjs');
const { createProtection, atomicWrite } = require('./protection.cjs');
const { createBridge } = require('./bridge.cjs');
const { AutomationError, checkDocument, checkPosition, validateEdits, summary, documentSlice, findText, outline } = require('../dist/automation.cjs');

if (process.env.BEAT_USER_DATA) app.setPath('userData', process.env.BEAT_USER_DATA);
app.setName('BEAT Windows');
let win, doc, busy = false, allowClose = false;
const flushes = new Map();
const editorRequests = new Map();
let protectionMessage = 'Automatic recovery ready';
const protection = createProtection(path.join(app.getPath('userData'), 'protection'), { activeSession: true, onCheckpoint: timestamp => { protectionMessage = `Recovery checkpoint · ${new Date(timestamp).toLocaleTimeString()}`; if (win && !win.isDestroyed()) status(); }, onError: error => { protectionMessage = `Recovery/backup error: ${error.message}`; if (win && !win.isDestroyed()) status(); } });
let bridge = null, connectionError = '', lastAutomation = '', bridgeTransitions = Promise.resolve(), bridgeClosing = false;
const connectionFile = process.env.BEAT_BRIDGE_FILE ?? (app.isPackaged ? path.join(app.getPath('userData'), 'codex-bridge.json') : path.resolve(__dirname, '../../../work/codex-bridge.json'));
const welcome = 'Title: A new story\nAuthor: Your name\n\n# Act One\n\nINT. WRITING ROOM - DAY\n\nA blank page. A little courage. The beginning of something.\n\nWRITER\nEvery story starts somewhere.\n\nEXT. CITY STREET - EVENING\n\nThe world keeps moving.\n';
function createDocument(text = '', filePath = null) {
  const model = decodeDocument(text);
  return { id: randomUUID(), revision: 0, filePath, model, text: model.text, dirty: false, forceUnsaved: false,
    protectedPaths: new Set(), metadataPaths: new Set(model.metadata !== null && filePath ? [path.resolve(filePath).toLowerCase()] : []) };
}
function snapshot() { return { id: doc.id, revision: doc.revision, path: doc.filePath, name: doc.filePath ? path.basename(doc.filePath) : doc.recoveryName ? `Recovered — ${doc.recoveryName}` : 'Untitled.fountain', text: doc.text, dirty: doc.dirty, readOnly: doc.model.metadata !== null, protection: protectionMessage }; }
function status() {
  const state = snapshot();
  win.setTitle(`${state.dirty ? '• ' : ''}${state.name} — BEAT Windows`);
  win.webContents.send('document:status', state);
}
function publish() { win.webContents.send('document:loaded', snapshot()); status(); }
function trusted(event) {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Untrusted document request.');
}
function applyUpdate(update) {
  if (update?.id !== doc.id || typeof update.text !== 'string') return false;
  if (!Number.isInteger(update.revision) || update.revision < 0) return false;
  if (update.text.length > 20 * 1024 * 1024) throw new Error('Document exceeds the 20 MB prototype limit.');
  if (doc.model.metadata !== null && update.text !== doc.model.text) return false;
  if (update.revision < doc.revision) return true;
  if (update.revision === doc.revision && update.text !== doc.text) return false;
  doc.text = update.text; doc.revision = update.revision; doc.dirty = doc.text !== doc.model.text || doc.forceUnsaved; protection.schedule(doc); status(); return true;
}
function connectionStatus() { return { enabled: bridge !== null, lastAction: lastAutomation, error: connectionError }; }
function publishConnection() { if (win && !win.isDestroyed()) win.webContents.send('automation:status', connectionStatus()); }
function editorTask(command, params, state) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID(), deadline = Date.now() + 8000;
    const timeout = setTimeout(() => { editorRequests.delete(requestId); reject(new AutomationError('EDITOR_TIMEOUT', 'The editor command timed out. Read the document before retrying.', 504)); }, 8000);
    editorRequests.set(requestId, { resolve: result => { clearTimeout(timeout); resolve(result); }, reject: error => { clearTimeout(timeout); reject(error); } });
    win.webContents.send('automation:request', { requestId, deadline, command, params, documentId: state.id, revision: state.revision });
  });
}
async function automate(command, params) {
  const supported = ['get-document', 'get-outline', 'get-selection', 'find', 'go-to-scene', 'select', 'edit', 'replace', 'undo', 'redo', 'save'];
  if (!supported.includes(command)) throw new AutomationError('INVALID_COMMAND', 'Unknown BEAT command.');
  if (busy) throw new AutomationError('BUSY', 'BEAT is handling another operation. Try again once it finishes.', 409);
  busy = true;
  try {
    await flushRenderer();
    const state = snapshot();
    if (command === 'get-document') return documentSlice(state, params);
    if (command === 'get-outline') return outline(state, params.query);
    if (command === 'find') { const found = findText(state.text, params.query, params.caseSensitive !== false); return { documentId: state.id, revision: state.revision, count: found.count, matches: found.matches.slice(0, 100), truncated: found.count > 100 }; }
    if (command === 'get-selection') return { ...await editorTask('selection', {}, state), documentId: doc.id, revision: doc.revision };
    checkDocument(state, params);
    if (['edit', 'replace', 'undo', 'redo'].includes(command) && state.readOnly) throw new AutomationError('READ_ONLY', 'This BEAT document has protected metadata. Create an editable copy in the app first.', 409);
    let editorCommand = command, editorParams = params;
    if (command === 'edit') editorParams = { edits: validateEdits(state.text, params.edits) };
    if (command === 'replace') {
      if (typeof params.replace !== 'string') throw new AutomationError('INVALID_EDITS', 'Replacement text must be a string.');
      const found = findText(state.text, params.find, params.caseSensitive !== false);
      if (!Number.isInteger(params.expectedOccurrences) || params.expectedOccurrences < 1 || params.expectedOccurrences !== found.count || found.truncated) throw new AutomationError('CONFLICT', `Found ${found.count} occurrences. Supply that count after reviewing the matches (maximum 1000).`, 409);
      editorCommand = 'edit'; editorParams = { edits: validateEdits(state.text, found.matches.map(match => ({ from: match.from, to: match.to, insert: params.replace, expectedText: match.text }))) };
    }
    if (command === 'go-to-scene') {
      const scene = outline(state).items.find(item => item.type === 'scene' && item.line === params.line);
      if (!scene) throw new AutomationError('INVALID_SCENE', 'Choose a scene heading line from the current outline.');
      editorCommand = 'select'; editorParams = { from: scene.from, to: scene.from };
    }
    if (command === 'select') { checkPosition(state.text, params.from); checkPosition(state.text, params.to); if (params.to < params.from) throw new AutomationError('INVALID_RANGE', 'Selection end precedes its start.'); }
    if (command === 'save') {
      if (!doc.filePath) throw new AutomationError('NEEDS_FILENAME', 'Use File > Save in BEAT to choose a filename first.', 409);
      await save(); lastAutomation = 'saved'; publishConnection(); return { document: summary(snapshot()), saved: true };
    }
    const result = await editorTask(editorCommand, editorParams, state);
    lastAutomation = ['edit', 'replace'].includes(command) ? 'edited · Ctrl+Z to undo' : command === 'go-to-scene' || command === 'select' ? 'navigated' : command === 'undo' ? 'undid an edit' : 'redid an edit';
    publishConnection(); return { ...result, document: summary(snapshot()) };
  } finally { busy = false; }
}
function setConnection(enabled) {
  bridgeTransitions = bridgeTransitions.then(async () => {
    try {
      if (enabled && !bridge) bridge = await createBridge({ connectionFile, onRequest: automate });
      if (!enabled && bridge) { const previous = bridge; bridge = null; await previous.close(); }
      connectionError = ''; lastAutomation = '';
    } catch (error) { connectionError = error.message; }
    publishConnection(); return connectionStatus();
  });
  return bridgeTransitions;
}
function flushRenderer() {
  return new Promise((resolve, reject) => {
    const token = randomUUID();
    const timeout = setTimeout(() => { flushes.delete(token); reject(new Error('The editor did not respond. Your document has not been closed or overwritten. Try again.')); }, 8000);
    flushes.set(token, { resolve: () => { clearTimeout(timeout); resolve(); }, reject: error => { clearTimeout(timeout); reject(error); } });
    win.webContents.send('document:flush', token);
  });
}
async function writeFileSafely(filePath, content, previous) {
  await atomicWrite(filePath, content, async () => {
    let bytes;
    try { bytes = await fs.readFile(filePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous ? !bytes || !bytes.equals(previous) : bytes !== undefined) throw new Error('The destination changed outside BEAT. Use Save As to preserve your edits.');
  });
}
async function save(saveAs = false) {
  let target = doc.filePath;
  if (!target || saveAs) {
    const result = await dialog.showSaveDialog(win, { title: 'Save screenplay', defaultPath: target ?? 'Untitled.fountain', filters: [{ name: 'Fountain screenplay', extensions: ['fountain'] }] });
    if (result.canceled || !result.filePath) return false;
    target = result.filePath;
    if (!path.extname(target)) target += '.fountain';
  }
  const content = encodeDocument(doc.model, doc.text);
  if (doc.protectedPaths.has(path.resolve(target).toLowerCase())) {
    throw new Error('Save the editable copy under a different filename to preserve the original BEAT document.');
  }
  if (doc.filePath && path.resolve(target).toLowerCase() === path.resolve(doc.filePath).toLowerCase()) {
    let disk;
    try { disk = await fs.readFile(target, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') throw new Error('The source file was removed outside BEAT. Use Save As.'); throw error; }
    if (disk !== undefined && disk !== doc.model.original) throw new Error('This file changed outside BEAT. Use Save As to keep your edits in another file.');
  }
  let previous;
  try { previous = await fs.readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous) {
    await protection.backup(target, previous);
    const currentBytes = await fs.readFile(target);
    if (!currentBytes.equals(previous)) throw new Error('This file changed while preparing its backup. Save As to preserve your edits.');
  }
  await writeFileSafely(target, content, previous);
  doc.filePath = target; doc.model = decodeDocument(content); doc.dirty = false; doc.forceUnsaved = false;
  if (doc.model.metadata !== null) doc.metadataPaths.add(path.resolve(target).toLowerCase());
  await protection.clear(doc);
  protectionMessage = 'Saved · previous version backed up';
  status();
  return true;
}
async function mayDiscard() {
  if (!doc.dirty) return true;
  const result = await dialog.showMessageBox(win, { type: 'question', title: 'Unsaved screenplay', message: 'Save your changes before continuing?', detail: snapshot().name, buttons: ['Save', 'Discard changes', 'Cancel'], defaultId: 0, cancelId: 2, noLink: true });
  if (result.response === 1) { await protection.clear(doc); return true; }
  return (result.response === 0 && await save());
}
async function openFile(filePath) {
  const info = await fs.stat(filePath);
  if (info.size > 20 * 1024 * 1024) throw new Error('This prototype supports screenplays up to 20 MB.');
  const buffer = await fs.readFile(filePath);
  new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  // TextDecoder strips the BOM by default; Buffer preserves it for exact round trips.
  doc = createDocument(buffer.toString('utf8'), filePath); publish();
}
async function runAction(action) {
  if (busy) return false;
  busy = true;
  try {
    await flushRenderer();
    if (action === 'recover') return await recover();
    if (action === 'backups') return await restoreBackup();
    if (action === 'save') return await save();
    if (action === 'save-as') return await save(true);
    if (action === 'new') { if (await mayDiscard()) { doc = createDocument(); publish(); return true; } }
    if (action === 'open') {
      if (!await mayDiscard()) return false;
      const result = await dialog.showOpenDialog(win, { title: 'Open screenplay', properties: ['openFile'], filters: [{ name: 'Screenplays', extensions: ['fountain', 'txt'] }, { name: 'All files', extensions: ['*'] }] });
      if (!result.canceled && result.filePaths[0]) { await openFile(result.filePaths[0]); return true; }
    }
    if (action === 'editable-copy') {
      if (doc.model.metadata === null) return false;
      const answer = await dialog.showMessageBox(win, { type: 'question', title: 'Create editable copy', message: 'Create a new script containing the Fountain text?', detail: 'The copy omits BEAT settings, revisions, tags, and plugin metadata. Your original file remains intact. Save the copy under a new filename.', buttons: ['Create copy', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true });
      if (answer.response === 0) { const originals = doc.metadataPaths; doc = createDocument(doc.text); doc.protectedPaths = new Set(originals); doc.forceUnsaved = true; doc.dirty = true; protection.schedule(doc); publish(); return true; }
    }
    return false;
  } catch (error) {
    await dialog.showMessageBox(win, { type: 'error', title: 'BEAT Windows', message: 'The operation could not be completed.', detail: error.message });
    return false;
  } finally { busy = false; }
}

async function choose(entries, title, label) {
  for (let offset = 0; offset < entries.length; offset += 8) {
    const page = entries.slice(offset, offset + 8);
    const more = offset + 8 < entries.length;
    const buttons = [...page.map(label), ...(more ? ['More…'] : []), 'Cancel'];
    const answer = await dialog.showMessageBox(win, { title, message: title, detail: 'Select a version to restore as an unsaved copy. Original files remain protected.', buttons, cancelId: buttons.length - 1, defaultId: buttons.length - 1, noLink: true });
    if (answer.response < page.length) return page[answer.response];
    if (!more || answer.response !== page.length) return null;
  }
  await dialog.showMessageBox(win, { title, message: 'No saved versions are available.' });
  return null;
}
async function recover() {
  const found = await protection.list({ excludeId: doc.id });
  if (found.invalid.length) await dialog.showMessageBox(win, { type: 'warning', title: 'Recovery storage', message: `${found.invalid.length} damaged recovery entries were retained for inspection.`, detail: protection.recoveryRoot });
  if (found.records.length > 100) await dialog.showMessageBox(win, { type: 'warning', title: 'Recovery storage', message: 'More than 100 unresolved drafts are retained.', detail: 'Recover and save or explicitly discard old drafts to reduce storage. Unresolved drafts are never removed automatically.' });
  const entry = await choose(found.records, 'Recover unsaved screenplay', item => `${item.record.sourcePath ? path.basename(item.record.sourcePath) : 'Untitled'} · ${new Date(item.record.updatedAt).toLocaleString()}`);
  if (!entry || !await mayDiscard()) return false;
  const record = entry.record;
  const restored = createDocument(record.original);
  restored.recoveryName = record.name ?? (record.sourcePath ? path.basename(record.sourcePath) : 'Untitled.fountain');
  if (restored.model.metadata !== null && record.text !== restored.model.text) throw new Error('Recovery text conflicts with protected BEAT metadata. The draft was retained for inspection.');
  restored.text = record.text; restored.recoverySource = entry.key;
  restored.protectedPaths = new Set([...record.protectedPaths, ...(record.sourcePath ? [path.resolve(record.sourcePath).toLowerCase()] : [])]);
  restored.forceUnsaved = restored.dirty = true;
  protection.schedule(restored); await protection.flush(); doc = restored; publish(); return true;
}
async function restoreBackup() {
  const entry = await choose(await protection.backups(), 'Restore versioned backup', item => `${path.basename(item.sourcePath)} · ${new Date(item.createdAt).toLocaleString()}`);
  if (!entry || !await mayDiscard()) return false;
  const restored = createDocument(await fs.readFile(entry.filePath, 'utf8'));
  restored.recoveryName = path.basename(entry.sourcePath);
  restored.protectedPaths.add(path.resolve(entry.sourcePath).toLowerCase());
  restored.forceUnsaved = restored.dirty = true;
  protection.schedule(restored); await protection.flush(); doc = restored; publish(); return true;
}

app.whenReady().then(async () => {
  doc = createDocument(welcome);
  win = new BrowserWindow({ width: 1320, height: 920, minWidth: 860, minHeight: 600, show: false, backgroundColor: '#171b21',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const file = (label, accelerator, action) => ({ label, accelerator, click: () => runAction(action) });
  const command = name => win.webContents.send('editor:command', name);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [file('New', 'Ctrl+N', 'new'), file('Open…', 'Ctrl+O', 'open'), { type: 'separator' }, file('Save', 'Ctrl+S', 'save'), file('Save As…', 'Ctrl+Shift+S', 'save-as'), { type: 'separator' }, file('Create editable copy…', undefined, 'editable-copy'), { type: 'separator' }, { label: 'Exit', accelerator: 'Alt+F4', click: () => win.close() }] },
    { label: 'Edit', submenu: [{ label: 'Undo', accelerator: 'Ctrl+Z', click: () => command('undo') }, { label: 'Redo', accelerator: 'Ctrl+Shift+Z', click: () => command('redo') }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { label: 'Select All', accelerator: 'Ctrl+A', click: () => command('select-all') }, { type: 'separator' }, { label: 'Find / Replace', accelerator: 'Ctrl+F', click: () => command('find') }] },
    { label: 'View', submenu: [{ label: 'Screenplay preview', accelerator: 'Ctrl+Shift+P', click: () => command('preview') }, { label: 'Focus mode', accelerator: 'Ctrl+Shift+F', click: () => command('focus') }, { label: 'Toggle theme', accelerator: 'Ctrl+Shift+D', click: () => command('theme') }, { role: 'togglefullscreen' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
    { label: 'Connection', submenu: [{ label: 'Toggle local Codex connection', click: () => setConnection(!bridge) }, { label: 'Connection details', click: () => dialog.showMessageBox(win, { title: 'Local Codex connection', message: bridge ? 'Local connection is ready.' : 'Local connection is paused.', detail: `Connection file: ${connectionFile}\n\nCodex edits use the editor undo history. Your script stays unsaved until you save it. ${connectionError}` }) }] },
    { label: 'Help', submenu: [{ label: 'About BEAT Windows', click: () => dialog.showMessageBox(win, { title: 'BEAT Windows', message: 'BEAT Windows · Preview 0.4.0', detail: 'A Windows port in development, based on BEAT by Lauri-Matti Parppei and contributors. GPL v3 or later. Fountain editing, outlining and a local Codex connection are available. Pagination, PDF/FDX export, revisions and plugins are not implemented yet.' }) }] }
  ]));
  ipcMain.handle('document:current', event => { trusted(event); return snapshot(); });
  ipcMain.handle('document:update', (event, update) => {
    trusted(event);
    return applyUpdate(update);
  });
  ipcMain.handle('document:flushed', (event, packet) => {
    trusted(event);
    const pending = flushes.get(packet?.token);
    if (!pending) return false;
    flushes.delete(packet.token);
    try {
      if (!applyUpdate(packet.update)) throw new Error('The editor and document are out of sync. The operation was cancelled to protect your work.');
      pending.resolve(); return true;
    } catch (error) { pending.reject(error); return false; }
  });
  ipcMain.handle('document:action', (event, action) => { trusted(event); return runAction(action); });
  ipcMain.handle('automation:current', event => { trusted(event); return connectionStatus(); });
  ipcMain.handle('automation:toggle', event => { trusted(event); return setConnection(!bridge); });
  ipcMain.handle('automation:response', (event, packet) => {
    trusted(event);
    const pending = editorRequests.get(packet?.requestId);
    if (!pending) return false;
    editorRequests.delete(packet.requestId);
    if (packet.error) { pending.reject(new AutomationError(packet.error.code ?? 'EDITOR_ERROR', packet.error.message, packet.error.status ?? 409)); return false; }
    try {
      if (!applyUpdate(packet.state)) throw new AutomationError('CONFLICT', 'The editor document changed during the command. Read it again.', 409);
      pending.resolve(packet.result); return true;
    } catch (error) { pending.reject(error); return false; }
  });
  win.on('close', async event => {
    if (allowClose) return;
    event.preventDefault();
    if (busy) return;
    busy = true;
    try { await flushRenderer(); if (await mayDiscard()) { allowClose = true; win.close(); } }
    catch (error) { await dialog.showMessageBox(win, { type: 'error', message: error.message }); }
    finally { busy = false; }
  });
  await win.loadFile(path.join(__dirname, '../dist/index.html'));
  const argument = process.argv.slice(app.isPackaged ? 1 : 2).find(value => !value.startsWith('-') && /\.(fountain|txt)$/i.test(value));
  if (argument) { try { await openFile(path.resolve(argument)); } catch (error) { await dialog.showMessageBox(win, { type: 'error', message: error.message }); } }
  status();
  if (process.env.BEAT_SMOKE_TEST !== '1') { try { const pending = await protection.list(); if (pending.records.length || pending.invalid.length) await recover(); } catch (error) { protectionMessage = `Recovery error: ${error.message}`; status(); } }
  await setConnection(true);
  if (!app.isPackaged && process.env.BEAT_SMOKE_TEST === '1') {
    require('../tests/desktop-main.cjs')({ app, win, dialog, snapshot, runAction, openFile, automate, setConnection, connectionFile, protection });
  } else win.show();
});
app.on('window-all-closed', () => { protection.dispose(); app.quit(); });
app.on('before-quit', event => {
  if (!bridge || bridgeClosing) return;
  event.preventDefault(); bridgeClosing = true;
  const previous = bridge; bridge = null;
  previous.close().finally(() => app.quit());
});
