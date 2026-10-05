const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { decodeDocument, encodeDocument } = require('../dist/document.cjs');

if (process.env.BEAT_USER_DATA) app.setPath('userData', process.env.BEAT_USER_DATA);
app.setName('BEAT Windows');
let win, doc, busy = false, allowClose = false;
const flushes = new Map();
const welcome = 'Title: A new story\nAuthor: Your name\n\n# Act One\n\nINT. WRITING ROOM - DAY\n\nA blank page. A little courage. The beginning of something.\n\nWRITER\nEvery story starts somewhere.\n\nEXT. CITY STREET - EVENING\n\nThe world keeps moving.\n';
function createDocument(text = '', filePath = null) {
  const model = decodeDocument(text);
  return { id: randomUUID(), filePath, model, text: model.text, dirty: false, forceUnsaved: false,
    protectedPaths: new Set(), metadataPaths: new Set(model.metadata !== null && filePath ? [path.resolve(filePath).toLowerCase()] : []) };
}
function snapshot() { return { id: doc.id, path: doc.filePath, name: doc.filePath ? path.basename(doc.filePath) : 'Untitled.fountain', text: doc.text, dirty: doc.dirty, readOnly: doc.model.metadata !== null }; }
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
  if (update.text.length > 20 * 1024 * 1024) throw new Error('Document exceeds the 20 MB prototype limit.');
  if (doc.model.metadata !== null && update.text !== doc.model.text) return false;
  doc.text = update.text; doc.dirty = doc.text !== doc.model.text || doc.forceUnsaved; status(); return true;
}
function flushRenderer() {
  return new Promise((resolve, reject) => {
    const token = randomUUID();
    const timeout = setTimeout(() => { flushes.delete(token); reject(new Error('The editor did not respond. Your document has not been closed or overwritten. Try again.')); }, 8000);
    flushes.set(token, { resolve: () => { clearTimeout(timeout); resolve(); }, reject: error => { clearTimeout(timeout); reject(error); } });
    win.webContents.send('document:flush', token);
  });
}
async function writeFileSafely(filePath, content) {
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try { await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' }); await fs.rename(temporary, filePath); }
  finally { await fs.unlink(temporary).catch(() => {}); }
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
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (disk !== undefined && disk !== doc.model.original) throw new Error('This file changed outside BEAT. Use Save As to keep your edits in another file.');
  }
  await writeFileSafely(target, content);
  doc.filePath = target; doc.model = decodeDocument(content); doc.dirty = false; doc.forceUnsaved = false;
  if (doc.model.metadata !== null) doc.metadataPaths.add(path.resolve(target).toLowerCase());
  status();
  return true;
}
async function mayDiscard() {
  if (!doc.dirty) return true;
  const result = await dialog.showMessageBox(win, { type: 'question', title: 'Unsaved screenplay', message: 'Save your changes before continuing?', detail: snapshot().name, buttons: ['Save', 'Discard changes', 'Cancel'], defaultId: 0, cancelId: 2, noLink: true });
  return result.response === 1 || (result.response === 0 && await save());
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
      if (answer.response === 0) { const originals = doc.metadataPaths; doc = createDocument(doc.text); doc.protectedPaths = new Set(originals); doc.forceUnsaved = true; doc.dirty = true; publish(); return true; }
    }
    return false;
  } catch (error) {
    await dialog.showMessageBox(win, { type: 'error', title: 'BEAT Windows', message: 'The operation could not be completed.', detail: error.message });
    return false;
  } finally { busy = false; }
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
    { label: 'View', submenu: [{ label: 'Focus mode', accelerator: 'Ctrl+Shift+F', click: () => command('focus') }, { label: 'Toggle theme', accelerator: 'Ctrl+Shift+D', click: () => command('theme') }, { role: 'togglefullscreen' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
    { label: 'Help', submenu: [{ label: 'About BEAT Windows', click: () => dialog.showMessageBox(win, { title: 'BEAT Windows', message: 'BEAT Windows · Prototype 0.1.0', detail: 'A Windows port in development, based on BEAT by Lauri-Matti Parppei and contributors. GPL v3 or later. Basic Fountain editing and outlining are available. Pagination, PDF/FDX export, revisions and plugins are not implemented yet.' }) }] }
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
  if (!app.isPackaged && process.env.BEAT_SMOKE_TEST === '1') {
    require('../tests/desktop-main.cjs')({ app, win, dialog, snapshot, runAction, openFile });
  } else win.show();
});
app.on('window-all-closed', () => app.quit());
