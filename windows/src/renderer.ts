import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, keymap, drawSelection, highlightActiveLine, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap, undo, redo, selectAll, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { parseFountain, type ParsedScript } from './fountain';
interface DocumentState { id: string; path: string | null; name: string; text: string; dirty: boolean; readOnly: boolean; }
declare global { interface Window { beat: {
  current(): Promise<DocumentState>; update(id: string, text: string): Promise<boolean>; action(action: string): Promise<boolean>;
  flushed(token: string, update: { id: string; text: string }): Promise<boolean>;
  onFlush(callback: (token: string) => void): () => void;
  onDocument(callback: (doc: DocumentState) => void): () => void;
  onStatus(callback: (doc: DocumentState) => void): () => void;
  onCommand(callback: (command: string) => void): () => void;
}; } }
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const readOnly = new Compartment();
let current: DocumentState;
let parsed: ParsedScript = parseFountain('');
let loading = false;
let focusMode = false;
let outlineTimer: ReturnType<typeof setTimeout> | undefined;
let sync: Promise<unknown> = Promise.resolve();
const formatter = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = this.make(view); }
  update(update: ViewUpdate) { if (update.docChanged) this.decorations = this.make(update.view); }
  make(view: EditorView) {
    parsed = parseFountain(view.state.doc.toString());
    return Decoration.set(parsed.lines.filter(line => line.type !== 'empty').map(line => Decoration.line({ attributes: { class: `element-${line.type}` } }).range(line.from)));
  }
}, { decorations: value => value.decorations });

const view = new EditorView({ parent: $('editor'), state: EditorState.create({ doc: '', extensions: [
  history(), drawSelection(), highlightActiveLine(), search({ top: true }), EditorView.lineWrapping,
  readOnly.of([EditorState.readOnly.of(false), EditorView.editable.of(true)]),
  EditorView.contentAttributes.of({ 'aria-label': 'Screenplay editor', spellcheck: 'true' }),
  keymap.of([...searchKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab]), formatter,
  EditorView.updateListener.of(update => {
    if (update.docChanged && current && !loading) {
      const id = current.id, text = update.state.doc.toString();
      sync = sync.then(() => window.beat.update(id, text)).catch(error => { $('save-state').textContent = `Sync failed: ${error.message}`; });
      clearTimeout(outlineTimer); outlineTimer = setTimeout(renderOutline, 120);
    }
    if (update.selectionSet || update.docChanged) updateCursor();
  })
] }) });

function applyDocument(doc: DocumentState) {
  current = doc; loading = true;
  // A fresh state resets undo history so edits cannot cross document boundaries.
  const state = EditorState.create({ doc: doc.text, extensions: [
    history(), drawSelection(), highlightActiveLine(), search({ top: true }), EditorView.lineWrapping,
    readOnly.of([EditorState.readOnly.of(doc.readOnly), EditorView.editable.of(!doc.readOnly)]),
    EditorView.contentAttributes.of({ 'aria-label': 'Screenplay editor', spellcheck: 'true' }),
    keymap.of([...searchKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab]), formatter,
    EditorView.updateListener.of(update => {
      if (update.docChanged && !loading) {
        const id = current.id, text = update.state.doc.toString();
        sync = sync.then(() => window.beat.update(id, text)).catch(error => { $('save-state').textContent = `Sync failed: ${error.message}`; });
        clearTimeout(outlineTimer); outlineTimer = setTimeout(renderOutline, 120);
      }
      if (update.selectionSet || update.docChanged) updateCursor();
    })
  ] });
  view.setState(state); loading = false;
  $<HTMLInputElement>('outline-filter').value = '';
  $('metadata-banner').hidden = !doc.readOnly;
  $('mode-label').textContent = doc.readOnly ? 'BEAT metadata protected · read-only' : 'Fountain · live formatting';
  $('file-mode').textContent = doc.readOnly ? 'PROTECTED DOCUMENT' : 'LOCAL DOCUMENT';
  setStatus(doc); renderOutline(); updateCursor(); view.focus();
}
function setStatus(doc: DocumentState) {
  if (current && doc.id !== current.id) return;
  if (current) { current.name = doc.name; current.dirty = doc.dirty; current.path = doc.path; }
  $('filename').textContent = doc.name;
  $('filename').title = doc.path ?? 'New screenplay';
  $('save-state').textContent = doc.readOnly ? 'Read-only · metadata preserved' : doc.dirty ? 'Unsaved changes' : doc.path ? 'All changes saved' : 'Ready to write';
}
function renderOutline() {
  const query = ($<HTMLInputElement>('outline-filter').value ?? '').toLowerCase();
  const container = $('outline'); container.replaceChildren();
  const scenes = parsed.outline.filter(item => item.type === 'scene').length;
  $('scene-count').textContent = `${scenes} ${scenes === 1 ? 'scene' : 'scenes'}`;
  $('stats').textContent = `${parsed.words.toLocaleString()} words · ${parsed.characters.length} characters`;
  for (const item of parsed.outline) {
    if (query && !`${item.title} ${item.synopsis}`.toLowerCase().includes(query)) continue;
    const button = document.createElement('button'); button.className = `outline-item ${item.type}`; button.dataset.from = String(item.from);
    if (item.type === 'scene') {
      const number = document.createElement('span'); number.className = 'scene-number'; number.textContent = item.number ?? '';
      if (item.color) number.style.color = item.color;
      button.append(number);
    }
    const label = document.createElement('span'); label.className = 'scene-title'; label.textContent = item.title;
    if (item.synopsis) { const synopsis = document.createElement('span'); synopsis.className = 'synopsis'; synopsis.textContent = item.synopsis; label.append(synopsis); }
    button.append(label);
    button.addEventListener('click', () => { view.dispatch({ selection: { anchor: item.from }, effects: EditorView.scrollIntoView(item.from, { y: 'center' }) }); view.focus(); });
    container.append(button);
  }
  if (!container.childElementCount) { const empty = document.createElement('p'); empty.className = 'outline-empty'; empty.textContent = query ? 'No matching scenes.' : 'Your outline grows as you write. Start a scene with INT. or EXT., or add a section with #.'; container.append(empty); }
  updateCursor();
}
function updateCursor() {
  const position = view.state.selection.main.head, line = view.state.doc.lineAt(position);
  const element = parsed.lines[line.number - 1]?.type ?? 'action';
  $('cursor').textContent = `Line ${line.number} · ${element[0].toUpperCase() + element.slice(1)}`;
  const active = [...parsed.outline].reverse().find(item => item.from <= position);
  for (const button of $('outline').querySelectorAll<HTMLElement>('button')) button.classList.toggle('current', button.dataset.from === String(active?.from));
}
function command(action: string) {
  if (action === 'select-all') { selectAll(view); view.focus(); }
  if (action === 'find') openSearchPanel(view);
  if (action === 'undo') undo(view);
  if (action === 'redo') redo(view);
  if (action === 'focus') { focusMode = !focusMode; document.body.classList.toggle('focus-mode', focusMode); $('focus').setAttribute('aria-pressed', String(focusMode)); }
  if (action === 'theme') { const light = document.body.classList.toggle('light'); $('theme').textContent = light ? 'Dark' : 'Light'; localStorage.setItem('beat-theme', light ? 'light' : 'dark'); }
}
for (const action of ['new', 'open', 'save', 'editable-copy']) $(action).addEventListener('click', async () => { await sync; await window.beat.action(action); });
for (const action of ['find', 'focus', 'theme']) $(action).addEventListener('click', () => command(action));
$('outline-filter').addEventListener('input', renderOutline);
window.beat.onDocument(applyDocument);
window.beat.onStatus(setStatus);
window.beat.onCommand(command);
window.beat.onFlush(async token => {
  await sync;
  await window.beat.flushed(token, { id: current.id, text: view.state.doc.toString() });
});
if (localStorage.getItem('beat-theme') === 'light') { document.body.classList.add('light'); $('theme').textContent = 'Dark'; }
window.beat.current().then(applyDocument).catch(error => { $('save-state').textContent = `Unable to load document: ${error.message}`; });
