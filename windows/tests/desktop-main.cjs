const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function ({ app, win, dialog, snapshot, runAction, openFile }) {
  const root = path.resolve('work/desktop-test');
  const errors = [], checks = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  win.webContents.on('preload-error', (_event, _file, error) => errors.push(error.message));
  const js = code => win.webContents.executeJavaScript(code, true);
  const waitFor = async (code, label) => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) { if (await js(code)) return; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw new Error(`Timed out: ${label}`);
  };
  const check = label => { checks.push(label); console.log(`PASS ${label}`); };
  const edit = async text => {
    await new Promise(resolve => setTimeout(resolve, 600));
    win.focus(); win.webContents.focus();
    await js("document.querySelector('.cm-content').focus()");
    win.webContents.send('editor:command', 'select-all');
    await waitFor("window.getSelection().toString().length > 0", 'select-all command');
    await win.webContents.insertText(text);
    await waitFor(`document.querySelector('.cm-content').textContent.includes(${JSON.stringify(text.split('\n').find(Boolean))})`, 'editor insertion');
    await waitFor("document.getElementById('save-state').textContent === 'Unsaved changes'", 'document sync');
  };
  let nextSave = path.join(root, 'roundtrip.fountain');
  let nextOpen;
  let answer = 2;
  dialog.showSaveDialog = async () => nextSave ? ({ canceled: false, filePath: nextSave }) : ({ canceled: true });
  dialog.showOpenDialog = async () => nextOpen ? ({ canceled: false, filePaths: [nextOpen] }) : ({ canceled: true, filePaths: [] });
  dialog.showMessageBox = async (_window, options) => {
    if (options.type === 'error') { errors.push(options.detail ?? options.message); return { response: 0 }; }
    return { response: answer };
  };
  try {
    await fs.mkdir(root, { recursive: true });
    win.show(); win.focus(); win.webContents.focus();
    await waitFor("document.querySelectorAll('.outline-item.scene').length === 2", 'initial outline');
    assert.equal(await js("typeof window.require"), 'undefined');
    assert.equal(await js("typeof window.beat.action"), 'function');
    check('real Electron window loads; isolated preload and two-scene outline');
    await js("document.body.classList.remove('light'); document.getElementById('theme').textContent='Light'; document.getElementById('theme').click(); document.getElementById('focus').click()");
    assert.equal(await js("document.body.classList.contains('light') && document.body.classList.contains('focus-mode')"), true);
    await js("document.getElementById('theme').click(); document.getElementById('focus').click()");
    check('theme and focus controls');
    await js("document.querySelectorAll('.outline-item.scene')[1].click()");
    assert.match(await js("document.getElementById('cursor').textContent"), /Scene/);
    check('outline navigation selects the scene');

    await edit('INT. TEST ROOM - DAY\n\nA first line.\n\nTESTER\nIt works.\n\nEXT. TEST ROAD - NIGHT\n\nA second scene.\n');
    await waitFor("document.querySelectorAll('.outline-item.scene').length === 2 && document.querySelector('.outline-item.scene').textContent.includes('TEST ROOM')", 'live outline');
    assert.equal(snapshot().dirty, true);
    assert.equal(await js("document.querySelectorAll('.element-character').length"), 1);
    assert.equal(await js("document.querySelectorAll('.element-dialogue').length"), 1);
    check('keyboard editing, live Fountain formatting and host dirty state');

    const filter = await js("(() => {const input=document.getElementById('outline-filter');input.value='ROAD';input.dispatchEvent(new Event('input'));return document.querySelectorAll('.outline-item.scene').length;})()");
    assert.equal(filter, 1);
    await js("document.getElementById('outline-filter').value='';document.getElementById('outline-filter').dispatchEvent(new Event('input'))");
    await runAction('save');
    assert.equal(await fs.readFile(nextSave, 'utf8'), snapshot().text);
    assert.equal(snapshot().dirty, false);
    check('scene filtering and native-host file save');

    const textBefore = snapshot().text;
    await edit('INT. CHANGED - DAY\n\nChanged.\n');
    answer = 2;
    await runAction('new');
    assert.match(snapshot().text, /CHANGED/);
    nextSave = null;
    await runAction('save-as');
    assert.match(snapshot().text, /CHANGED/);
    check('cancelled discard and cancelled Save As both preserve edits');
    win.webContents.send('editor:command', 'undo');
    await waitFor("document.querySelector('.cm-content').textContent.includes('TEST ROOM')", 'undo');
    win.webContents.send('editor:command', 'redo');
    await waitFor("document.querySelector('.cm-content').textContent.includes('CHANGED')", 'redo');
    check('undo and redo restore the correct document text');
    nextSave = path.join(root, 'roundtrip.fountain');
    await fs.writeFile(nextSave, 'An outside editor wrote this.');
    assert.equal(await runAction('save'), false);
    assert.equal(await fs.readFile(nextSave, 'utf8'), 'An outside editor wrote this.');
    assert.match(errors.pop(), /changed outside/);
    check('external-file changes cannot be silently overwritten');
    answer = 1; await runAction('new');
    await waitFor("document.querySelector('.cm-content').textContent === ''", 'new document');
    assert.equal(snapshot().text, '');
    win.webContents.send('editor:command', 'undo');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(snapshot().text, '');
    check('new document clears history; undo cannot leak the previous file');

    const protectedFile = path.join(root, 'metadata.fountain');
    const source = '\uFEFFINT. ORIGINAL - DAY\r\n\r\n😀 Original.\r\n\r\n/** settings: {"Tags":[[1,2]],"custom":42} **/\r\n';
    await fs.writeFile(protectedFile, source);
    nextOpen = protectedFile; await runAction('open');
    await waitFor("!document.getElementById('metadata-banner').hidden", 'metadata banner');
    assert.equal(snapshot().readOnly, true);
    assert.equal(await js("document.querySelector('.cm-content').getAttribute('contenteditable')"), 'false');
    const rejected = await js("window.beat.current().then(doc=>window.beat.update(doc.id,'malicious overwrite'))");
    assert.equal(rejected, false);
    nextSave = path.join(root, 'metadata-copy.fountain');
    await runAction('save-as');
    assert.equal(await fs.readFile(nextSave, 'utf8'), source);
    check('metadata documents resist renderer edits and save byte-for-byte');

    const protectedPath = snapshot().path;
    answer = 0; await runAction('editable-copy');
    await waitFor("document.getElementById('metadata-banner').hidden", 'editable copy');
    assert.equal(snapshot().readOnly, false);
    assert.equal(snapshot().path, null);
    nextSave = protectedPath;
    assert.equal(await runAction('save'), false);
    assert.match(errors.pop(), /different filename/);
    assert.equal(await fs.readFile(protectedPath, 'utf8'), source);
    nextSave = protectedFile;
    assert.equal(await runAction('save'), false);
    assert.match(errors.pop(), /different filename/);
    assert.equal(await fs.readFile(protectedFile, 'utf8'), source);
    nextSave = path.join(root, 'editable.fountain'); await runAction('save');
    assert.ok(!(await fs.readFile(nextSave, 'utf8')).includes('settings:'));
    check('editable copies omit metadata and cannot overwrite their source');

    const bad = path.join(root, 'bad-encoding.fountain');
    await fs.writeFile(bad, Buffer.from([0xff, 0xfe, 0x00, 0x00]));
    nextOpen = bad; const before = snapshot().id;
    assert.equal(await runAction('open'), false);
    assert.equal(snapshot().id, before);
    assert.match(errors.pop(), /encoded data|encoding/i);
    check('invalid UTF-8 cannot replace the active document');

    await openFile(path.resolve('../Sample files/Big-Fish.fountain'));
    await waitFor("document.querySelectorAll('.outline-item.scene').length > 100", 'real script');
    assert.ok(snapshot().readOnly);
    check('upstream Big Fish sample opens with over 100 navigable scenes');
    await openFile(path.join(root, 'editable.fountain'));
    await waitFor("document.getElementById('filename').textContent==='editable.fountain'", 'editable view');
    await fs.writeFile(path.join(root, 'desktop-dark.png'), (await win.capturePage()).toPNG());
    await js("document.getElementById('theme').click()");
    await new Promise(resolve => setTimeout(resolve, 100));
    await fs.writeFile(path.join(root, 'desktop-light.png'), (await win.capturePage()).toPNG());
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
    console.log(`DESKTOP TESTS PASSED: ${checks.length}`);
    app.exit(0);
  } catch (error) {
    console.error(error);
    const diagnostic = await js("({text:document.querySelector('.cm-content')?.textContent,outline:document.getElementById('outline')?.textContent,sceneCount:document.querySelectorAll('.outline-item.scene').length})").catch(() => null);
    await fs.writeFile(path.join(root, 'failure.png'), (await win.capturePage()).toPNG()).catch(() => {});
    await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({ passed: checks.length, checks, errors, failure: error.stack, document: snapshot(), diagnostic }, null, 2));
    app.exit(1);
  }
};
