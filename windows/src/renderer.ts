import { moveSceneMetadata } from './scene-metadata';
import { replaceAnnotation, tagTypes, type Annotations } from './annotations';
import { resolveRevisions } from './revision-workflow';
import { revisionExtensions, revisionField, setRevisions, markRevision, type Revisions } from './revisions';
import { EditorState, Compartment, Transaction } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, keymap, drawSelection, highlightActiveLine, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap, undo, redo, selectAll, indentWithTab, isolateHistory } from '@codemirror/commands';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { characterSuggestions, sceneMove, type CharacterMatch } from './writing-tools';
import { browserLayout, renderPreview } from './preview';
import type { PaperSize, PrintOptions } from './pagination';
import { parseFountain, type ParsedScript } from './fountain';
import { AutomationError, checkPosition, validateEdits, type TextEdit } from './automation';
interface DocumentState { id: string; revision: number; path: string | null; name: string; text: string; dirty: boolean; readOnly: boolean; revisions: Revisions; protection: string; }
interface ConnectionState { enabled: boolean; lastAction: string; error: string; }
interface AutomationRequest { requestId: string; deadline: number; documentId: string; revision: number; command: string; params: { from?: number; to?: number; edits?: TextEdit[] }; }
declare global { interface Window { beat: {
  current(): Promise<DocumentState>; update(id: string, text: string, revision: number, revisions: Revisions): Promise<boolean>; action(action: string): Promise<boolean>;
  flushed(token: string, update: { id: string; text: string; revision: number; revisions: Revisions }): Promise<boolean>;
  onFlush(callback: (token: string) => void): () => void;
  onDocument(callback: (doc: DocumentState) => void): () => void;
  onStatus(callback: (doc: DocumentState) => void): () => void;
  onCommand(callback: (command: string) => void): () => void;
  connection(): Promise<ConnectionState>; toggleConnection(): Promise<ConnectionState>;
  onConnection(callback: (connection: ConnectionState) => void): () => void;
  onAutomation(callback: (request: AutomationRequest) => void): () => void;
  automationResponse(packet: { requestId: string; state?: { id: string; text: string; revision: number; revisions: Revisions }; result?: unknown; error?: { code: string; message: string; status: number } }): Promise<boolean>;
}; } }
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const readOnly = new Compartment();
let current: DocumentState;
let parsed: ParsedScript = parseFountain('');
let loading = false;
let focusMode = false;
let previewMode = false;
const paperSize = () => $<HTMLSelectElement>('paper-size').value as PaperSize;
function printOptions(): PrintOptions { return { header: $<HTMLInputElement>('print-header').value, footer: $<HTMLInputElement>('print-footer').value, sceneNumbers: $<HTMLInputElement>('print-scenes').checked, sceneContinuations: $<HTMLInputElement>('print-continuations').checked, revisionMarks: $<HTMLInputElement>('print-revisions').checked, revisions: view.state.field(revisionField).ranges }; }
function refreshPreview() {
  try { const layout = renderPreview(parsed, $('preview-content'), paperSize(), printOptions()); $('preview-summary').textContent = `${layout.pages.length} pages · ${layout.size} · 12 pt Courier${view.state.field(revisionField).annotations ? " · Tags/reviews omitted" : ""}${view.state.field(revisionField).ranges.length && !$<HTMLInputElement>('print-revisions').checked ? " · Revision marks omitted from preview/PDF" : ""}`; }
  catch (error) { $('preview-content').replaceChildren(); $('preview-summary').textContent = `Preview unavailable: ${(error as Error).message}`; }
}
let outlineTimer: ReturnType<typeof setTimeout> | undefined;
let sync: Promise<unknown> = Promise.resolve();
let editorRevision = 0;
let completion: CharacterMatch | null = null, completionIndex = 0, completionRevision = -1;
function hideCompletion() { completion = null; $('character-suggestions').hidden = true; view.contentDOM.removeAttribute('aria-activedescendant'); }
function showCompletion(explicit = false) {
  if (!current || current.readOnly || previewMode || !view.state.selection.main.empty) { hideCompletion(); return; }
  completion = characterSuggestions(view.state.doc.toString(), view.state.selection.main.head, explicit, parsed.characters);
  const panel = $('character-suggestions'); panel.replaceChildren();
  if (!completion) { hideCompletion(); return; }
  completionIndex = 0; completionRevision = editorRevision; panel.hidden = false;
  completion.names.forEach((name, index) => {
    const option = document.createElement('button'); option.id = `character-option-${index}`; option.type = 'button'; option.setAttribute('role', 'option'); option.textContent = name;
    option.addEventListener('mousedown', event => event.preventDefault()); option.addEventListener('click', () => acceptCharacter(index)); panel.append(option);
  });
  selectCompletion(0);
}
function selectCompletion(index: number) {
  if (!completion) return;
  completionIndex = (index + completion.names.length) % completion.names.length;
  for (const [i, option] of [...$('character-suggestions').children].entries()) option.setAttribute('aria-selected', String(i === completionIndex));
  view.contentDOM.setAttribute('aria-activedescendant', `character-option-${completionIndex}`);
}
function acceptCharacter(index = completionIndex): boolean {
  if (!completion || current.readOnly || completionRevision !== editorRevision) { hideCompletion(); return false; }
  const match = completion, name = match.names[index]; if (!name) return false;
  hideCompletion();
  view.dispatch({ changes: { from: match.from, to: match.to, insert: name }, selection: { anchor: match.from + name.length }, annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.complete')] });
  hideCompletion(); view.focus(); return true;
}
const writingKeys = [
  { key: 'Ctrl-Space', run: () => { showCompletion(true); return true; } },
  { key: 'ArrowDown', run: () => { if (!completion) return false; selectCompletion(completionIndex + 1); return true; } },
  { key: 'ArrowUp', run: () => { if (!completion) return false; selectCompletion(completionIndex - 1); return true; } },
  { key: 'Tab', run: () => acceptCharacter() },
  { key: 'Escape', run: () => { if (!completion) return false; hideCompletion(); return true; } }
];
const formatter = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = this.make(view); }
  update(update: ViewUpdate) { if (update.docChanged) this.decorations = this.make(update.view); }
  make(view: EditorView) {
    parsed = parseFountain(view.state.doc.toString());
    const ranges = parsed.lines.flatMap(line => [
      ...(line.type !== 'empty' ? [Decoration.line({ attributes: { class: `element-${line.type}${line.dualSide ? ` dual-source-${line.dualSide}` : ''}` } }).range(line.from)] : []),
      ...line.inline.filter(range => range.to > range.from).map(range => Decoration.mark({ class: `inline-${range.style}` }).range(range.from, range.to))
    ]);
    if (previewMode) refreshPreview();
    return Decoration.set(ranges, true);
  }
}, { decorations: value => value.decorations });

const view = new EditorView({ parent: $('editor'), state: EditorState.create({ doc: '', extensions: [
  history(), revisionExtensions(), drawSelection(), highlightActiveLine(), search({ top: true }), EditorView.lineWrapping,
  readOnly.of([EditorState.readOnly.of(false), EditorView.editable.of(true)]),
  EditorView.contentAttributes.of({ 'aria-label': 'Screenplay editor', 'aria-autocomplete': 'list', 'aria-controls': 'character-suggestions', spellcheck: 'true' }),
  keymap.of([...writingKeys, ...searchKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab]), formatter,
  EditorView.updateListener.of(update => {
    if ((update.docChanged || update.transactions.some(tr => tr.effects.some(effect => effect.is(setRevisions)))) && current && !loading) {
      const id = current.id, text = update.state.doc.toString(), revision = ++editorRevision;
      const revisions = update.state.field(revisionField);
      refreshRevisionControls(revisions); refreshAnnotationControls(revisions); if (previewMode) refreshPreview();
      sync = sync.then(() => window.beat.update(id, text, revision, revisions)).catch(error => { $('save-state').textContent = `Sync failed: ${error.message}`; });
      clearTimeout(outlineTimer); outlineTimer = setTimeout(renderOutline, 120);
    }
    if (update.selectionSet || update.docChanged) updateCursor();
  })
] }) });

function applyDocument(doc: DocumentState) {
  if (current) hideCompletion();
  current = doc; editorRevision = doc.revision; loading = true;
  $<HTMLInputElement>('tag-name').value = ''; $<HTMLTextAreaElement>('review-text').value = '';
  $<HTMLSelectElement>('tag-list').value = ''; $<HTMLSelectElement>('review-list').value = '';
  // A fresh state resets undo history so edits cannot cross document boundaries.
  const state = EditorState.create({ doc: doc.text, selection: { anchor: doc.revisions.annotations?.caret ?? 0 }, extensions: [
    history(), revisionExtensions(doc.revisions), drawSelection(), highlightActiveLine(), search({ top: true }), EditorView.lineWrapping,
    readOnly.of([EditorState.readOnly.of(doc.readOnly), EditorView.editable.of(!doc.readOnly)]),
    EditorView.contentAttributes.of({ 'aria-label': 'Screenplay editor', 'aria-autocomplete': 'list', 'aria-controls': 'character-suggestions', spellcheck: 'true' }),
    keymap.of([...writingKeys, ...searchKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab]), formatter,
    EditorView.updateListener.of(update => {
      if ((update.docChanged || update.transactions.some(tr => tr.effects.some(effect => effect.is(setRevisions)))) && !loading) {
        const id = current.id, text = update.state.doc.toString(), revision = ++editorRevision;
        const revisions = update.state.field(revisionField);
      refreshRevisionControls(revisions); refreshAnnotationControls(revisions); if (previewMode) refreshPreview();
      sync = sync.then(() => window.beat.update(id, text, revision, revisions)).catch(error => { $('save-state').textContent = `Sync failed: ${error.message}`; });
        clearTimeout(outlineTimer); outlineTimer = setTimeout(renderOutline, 120);
      }
      if (update.selectionSet || update.docChanged) updateCursor();
    })
  ] });
  view.setState(state); loading = false;
  if (previewMode) setPreview(true);
  $<HTMLInputElement>('outline-filter').value = '';
  $('metadata-banner').hidden = !doc.readOnly;
  $('mode-label').textContent = doc.readOnly ? 'BEAT metadata protected · read-only' : 'Fountain · live formatting';
  $('file-mode').textContent = doc.readOnly ? 'PROTECTED DOCUMENT' : 'LOCAL DOCUMENT';
  refreshRevisionControls(doc.revisions); refreshAnnotationControls(doc.revisions); setStatus(doc); renderOutline(); updateCursor(); if (!previewMode) view.focus();
}
function setStatus(doc: DocumentState) {
  if (current && doc.id !== current.id) return;
  if (current) { current.name = doc.name; current.dirty = doc.dirty; current.path = doc.path; }
  $('save-state').title = doc.protection;
  $('protection-state').textContent = doc.protection;
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
    button.addEventListener('click', () => { if (previewMode) setPreview(false); view.dispatch({ selection: { anchor: item.from }, effects: EditorView.scrollIntoView(item.from, { y: 'center' }) }); view.focus(); });
    container.append(button);
  }
  if (!container.childElementCount) { const empty = document.createElement('p'); empty.className = 'outline-empty'; empty.textContent = query ? 'No matching scenes.' : 'Your outline grows as you write. Start a scene with INT. or EXT., or add a section with #.'; container.append(empty); }
  updateCursor();
}
function moveCurrentScene(direction: -1 | 1) {
  hideCompletion();
  if (current.readOnly || $<HTMLInputElement>('outline-filter').value.trim()) return;
  const text = view.state.doc.toString(), active = [...parsed.outline].reverse().find(item => item.from <= view.state.selection.main.head);
  if (active?.type !== 'scene') return;
  try {
    const edit = sceneMove(text, active.from, direction);
    if (view.state.doc.sliceString(edit.from, edit.to) !== edit.expectedText) throw new Error('The scene changed. Select it again.');
    if (previewMode) setPreview(false);
    view.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert }, selection: { anchor: edit.anchor }, effects: setRevisions.of(moveSceneMetadata(view.state.field(revisionField), edit, text.length)), annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.move-scene')] });
    clearTimeout(outlineTimer); renderOutline(); view.focus(); $('writing-status').textContent = 'Scene moved. Ctrl+Z to undo.';
  } catch (error) { $('writing-status').textContent = (error as Error).message; }
}
function updateCursor() {
  const position = view.state.selection.main.head, line = view.state.doc.lineAt(position);
  const element = parsed.lines[line.number - 1]?.type ?? 'action';
  $('cursor').textContent = `Line ${line.number} · ${element[0].toUpperCase() + element.slice(1)}`;
  const active = [...parsed.outline].reverse().find(item => item.from <= position);
  const activeIndex = parsed.outline.indexOf(active!);
  for (const [id, direction] of [['scene-up', -1], ['scene-down', 1]] as const) {
    $<HTMLButtonElement>(id).disabled = !current || current.readOnly || !!$<HTMLInputElement>('outline-filter').value.trim() || active?.type !== 'scene' || parsed.outline[activeIndex + direction]?.type !== 'scene';
  }
  if (!loading) showCompletion();
  for (const button of $('outline').querySelectorAll<HTMLElement>('button')) button.classList.toggle('current', button.dataset.from === String(active?.from));
}
function setPreview(enabled: boolean) {
  clearTimeout(outlineTimer);
  renderOutline();
  hideCompletion();
  previewMode = enabled;
  $('preview').setAttribute('aria-pressed', String(enabled));
  $('preview-pane').hidden = !enabled;
  $('editor').hidden = enabled;
  if (enabled) { refreshPreview(); $('preview-pane').focus(); }
  else view.focus();
}
function command(action: string) {
  if (action === 'preview') { setPreview(!previewMode); return; }
  if (previewMode && ['select-all', 'find', 'undo', 'redo'].includes(action)) setPreview(false);
  if (action === 'select-all') { selectAll(view); view.focus(); }
  if (action === 'find') openSearchPanel(view);
  if (action === 'undo') undo(view);
  if (action === 'redo') redo(view);
  if (action === 'focus') { focusMode = !focusMode; document.body.classList.toggle('focus-mode', focusMode); $('focus').setAttribute('aria-pressed', String(focusMode)); }
  if (action === 'theme') { const light = document.body.classList.toggle('light'); $('theme').textContent = light ? 'Dark' : 'Light'; localStorage.setItem('beat-theme', light ? 'light' : 'dark'); }
}
$('scene-up').addEventListener('click', () => moveCurrentScene(-1));
$('scene-down').addEventListener('click', () => moveCurrentScene(1));
$('paper-size').addEventListener('change', () => { if (previewMode) refreshPreview(); });
for (const action of ['new', 'open', 'save', 'editable-copy', 'export-pdf']) $(action).addEventListener('click', async () => { await sync; await window.beat.action(action); });
for (const action of ['find', 'focus', 'theme', 'preview']) $(action).addEventListener('click', () => command(action));
$('outline-filter').addEventListener('input', renderOutline);
window.beat.onDocument(applyDocument);
window.beat.onStatus(setStatus);
window.beat.onCommand(command);
window.beat.onFlush(async token => {
  await sync;
  await window.beat.flushed(token, { id: current.id, text: view.state.doc.toString(), revision: editorRevision, revisions: view.state.field(revisionField) });
});
function setConnectionStatus(state: ConnectionState) {
  const button = $('codex-connection');
  button.textContent = state.error ? 'Codex unavailable' : !state.enabled ? 'Codex paused' : state.lastAction ? `Codex ${state.lastAction}` : 'Codex ready';
  button.title = state.error || (state.enabled ? 'Click to pause the local Codex connection' : 'Click to enable the local Codex connection');
  button.setAttribute('aria-pressed', String(state.enabled));
}
$('codex-connection').addEventListener('click', async () => setConnectionStatus(await window.beat.toggleConnection()));
window.beat.onConnection(setConnectionStatus);
window.beat.connection().then(setConnectionStatus);
window.beat.onAutomation(async request => {
  try {
    await sync;
    if (Date.now() > request.deadline) throw new AutomationError('EDITOR_TIMEOUT', 'This command expired. Read the document before retrying.', 504);
    if (current.id !== request.documentId || editorRevision !== request.revision) throw new AutomationError('CONFLICT', 'The screenplay changed while the command was arriving. Read it again.', 409);
    const text = view.state.doc.toString();
    let changed = false;
    if (['edit', 'undo', 'redo'].includes(request.command) && current.readOnly) throw new AutomationError('READ_ONLY', 'This document has protected BEAT metadata.', 409);
    if (request.command === 'layout') {
      await document.fonts.ready;
      const layout = browserLayout(parsed, paperSize(), printOptions());
      await window.beat.automationResponse({ requestId: request.requestId, state: { id: current.id, text: view.state.doc.toString(), revision: editorRevision, revisions: view.state.field(revisionField) }, result: { layout } });
      return;
    }
    if (request.command === 'edit') {
      const edits = validateEdits(text, request.params.edits);
      view.dispatch({ changes: edits.map(({ from, to, insert }) => ({ from, to, insert })), annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.codex')] });
      changed = true;
    } else if (request.command === 'select') {
      checkPosition(text, request.params.from); checkPosition(text, request.params.to);
      if (request.params.to < request.params.from) throw new AutomationError('INVALID_RANGE', 'Selection end precedes its start.');
      if (previewMode) setPreview(false);
      view.dispatch({ selection: { anchor: request.params.from, head: request.params.to }, effects: EditorView.scrollIntoView(request.params.from, { y: 'center' }) });
      view.focus();
    } else if (request.command === 'undo') changed = undo(view);
    else if (request.command === 'redo') changed = redo(view);
    else if (request.command !== 'selection') throw new AutomationError('INVALID_COMMAND', 'Unknown editor command.');
    await sync;
    const selection = view.state.selection.main;
    await window.beat.automationResponse({ requestId: request.requestId, state: { id: current.id, text: view.state.doc.toString(), revision: editorRevision, revisions: view.state.field(revisionField) }, result: { changed, selection: { from: selection.from, to: selection.to, line: view.state.doc.lineAt(selection.head).number, text: view.state.doc.sliceString(selection.from, Math.min(selection.to, selection.from + 50000)), truncated: selection.to - selection.from > 50000 } } });
  } catch (error) {
    const problem = error as AutomationError;
    await window.beat.automationResponse({ requestId: request.requestId, error: { code: problem.code ?? 'EDITOR_ERROR', message: problem.message, status: problem.status ?? 409 } });
  }
});
if (localStorage.getItem('beat-theme') === 'light') { document.body.classList.add('light'); $('theme').textContent = 'Dark'; }
window.beat.current().then(applyDocument).catch(error => { $('save-state').textContent = `Unable to load document: ${error.message}`; });

function refreshRevisionControls(value: Revisions) {
  $<HTMLInputElement>('revision-track').checked = value.enabled;
  $<HTMLSelectElement>('revision-generation').value = String(value.generation);
  for (const id of ['revision-track', 'revision-generation', 'revision-add', 'revision-remove', 'revision-clear', 'revision-accept', 'revision-reject']) ($<HTMLButtonElement>(id)).disabled = current?.readOnly ?? true;
  $('revision-summary').textContent = `${value.ranges.length} revision ranges${value.annotations ? ` · ${value.annotations.tags.length} tags · ${value.annotations.reviews.length} reviews preserved` : ""} · deletions erase text; mark suggested removals before deleting`;
}
function changeRevisions(value: Revisions) {
  if (current.readOnly) return;
  view.dispatch({ effects: setRevisions.of(value), annotations: isolateHistory.of('full') });
  updateCursor(); view.focus();
}
$('revision-track').addEventListener('change', () => changeRevisions({ ...view.state.field(revisionField), enabled: $<HTMLInputElement>('revision-track').checked }));
$('revision-generation').addEventListener('change', () => changeRevisions({ ...view.state.field(revisionField), generation: Number($<HTMLSelectElement>('revision-generation').value) }));
for (const [id, kind] of [['revision-add', 'Addition'], ['revision-remove', 'RemovalSuggestion'], ['revision-clear', null]] as const) $(id).addEventListener('click', () => {
  const { from, to } = view.state.selection.main;
  if (to <= from) { $('revision-summary').textContent = 'Select text to mark or clear a revision.'; return; }
  changeRevisions(markRevision(view.state.field(revisionField), from, to, kind));
});

const annotationValue = (value: Revisions): Annotations => value.annotations ?? { tags: [], reviews: [] };
function refreshAnnotationControls(value: Revisions) {
  const tags = $<HTMLSelectElement>('tag-list'), selected = tags.value;
  tags.replaceChildren(new Option('New tag', ''));
  for (const d of value.definitions ?? []) tags.add(new Option(`${d.name} · ${d.type}`, d.id));
  tags.value = [...tags.options].some(o => o.value === selected) ? selected : '';
  const selectedTag = value.definitions?.find(d => d.id === tags.value);
  if (selectedTag && document.activeElement !== $('tag-name')) { $<HTMLInputElement>('tag-name').value = selectedTag.name; $<HTMLSelectElement>('tag-type').value = selectedTag.type; }
  const reviews = $<HTMLSelectElement>('review-list'), reviewSelected = reviews.value;
  reviews.replaceChildren(new Option('New comment', ''));
  annotationValue(value).reviews.forEach((r, i) => reviews.add(new Option(`Line ${view.state.doc.lineAt(Math.min(r.from, view.state.doc.length)).number}: ${r.string.slice(0, 70)}`, String(i))));
  reviews.value = [...reviews.options].some(o => o.value === reviewSelected) ? reviewSelected : '';
  if (reviews.value !== '' && document.activeElement !== $('review-text')) $<HTMLTextAreaElement>('review-text').value = annotationValue(value).reviews[Number(reviews.value)]?.string ?? '';
  for (const control of document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('.annotation-tools button,.annotation-tools input,.annotation-tools select,.annotation-tools textarea')) control.disabled = current?.readOnly ?? true;
}
for (const type of tagTypes) $<HTMLSelectElement>('tag-type').add(new Option(type, type));
function annotationAction(action: () => void) {
  if (current.readOnly) return;
  try { action(); $('annotation-status').textContent = 'Updated. Ctrl+Z to undo.'; }
  catch (error) { $('annotation-status').textContent = (error as Error).message; }
}
function selectedAnnotationRange() {
  const { from, to } = view.state.selection.main;
  if (from === to) throw new Error('Select screenplay text first.');
  return { from, to };
}
function chosenTag(value: Revisions) {
  const tag = value.definitions?.find(d => d.id === $<HTMLSelectElement>('tag-list').value);
  if (!tag) throw new Error('Choose an existing tag.');
  return tag;
}
$('tag-list').addEventListener('change', () => {
  const d = view.state.field(revisionField).definitions?.find(d => d.id === $<HTMLSelectElement>('tag-list').value);
  $<HTMLInputElement>('tag-name').value = d?.name ?? ''; $<HTMLSelectElement>('tag-type').value = d?.type ?? 'cast';
});
for (const action of ['create', 'apply', 'rename', 'delete', 'clear']) $(`tag-${action}`).addEventListener('click', () => annotationAction(() => {
  const value = view.state.field(revisionField), annotations = annotationValue(value);
  let definitions = value.definitions ?? [], tags = annotations.tags, createdId: string | undefined;
  if (action === 'create') {
    const { from, to } = selectedAnnotationRange(), name = $<HTMLInputElement>('tag-name').value.trim(), type = $<HTMLSelectElement>('tag-type').value;
    if (!name) throw new Error('Enter a tag name.');
    const d = { id: crypto.randomUUID(), name, type }; createdId = d.id; definitions = [...definitions, d]; tags = replaceAnnotation(tags, from, to, { from, to, definition: d.id, type });
  } else if (action === 'clear') { const { from, to } = selectedAnnotationRange(); tags = replaceAnnotation(tags, from, to); }
  else {
    const d = chosenTag(value);
    if (action === 'apply') { const { from, to } = selectedAnnotationRange(); tags = replaceAnnotation(tags, from, to, { from, to, definition: d.id, type: d.type }); }
    if (action === 'delete') { definitions = definitions.filter(t => t.id !== d.id); tags = tags.filter(t => t.definition !== d.id); }
    if (action === 'rename') {
      const name = $<HTMLInputElement>('tag-name').value.trim(), type = $<HTMLSelectElement>('tag-type').value;
      if (!name) throw new Error('Enter a tag name.');
      definitions = definitions.map(t => t.id === d.id ? { ...t, name, type } : t); tags = tags.map(t => t.definition === d.id ? { ...t, type } : t);
    }
  }
  changeRevisions({ ...value, definitions, annotations: { ...annotations, tags } });
  if (createdId) $<HTMLSelectElement>('tag-list').value = createdId;
}));
$('review-list').addEventListener('change', () => {
  const r = annotationValue(view.state.field(revisionField)).reviews[Number($<HTMLSelectElement>('review-list').value)];
  $<HTMLTextAreaElement>('review-text').value = $<HTMLSelectElement>('review-list').value === '' ? '' : r?.string ?? '';
});
for (const action of ['add', 'update', 'delete', 'go']) $(`review-${action}`).addEventListener('click', () => annotationAction(() => {
  const value = view.state.field(revisionField), annotations = annotationValue(value), chosen = $<HTMLSelectElement>('review-list').value, index = chosen === '' ? -1 : Number(chosen);
  let reviews = annotations.reviews;
  const string = $<HTMLTextAreaElement>('review-text').value;
  if (action === 'add') { const { from, to } = selectedAnnotationRange(); if (!string.trim()) throw new Error('Enter a comment.'); reviews = replaceAnnotation(reviews, from, to, { from, to, string }); }
  else {
    const review = reviews[index]; if (!review) throw new Error('Choose a comment.');
    if (action === 'go') { if (previewMode) setPreview(false); view.dispatch({ selection: { anchor: review.from, head: review.to }, effects: EditorView.scrollIntoView(review.from, { y: 'center' }) }); view.focus(); return; }
    if (action === 'delete') reviews = reviews.filter((_r, i) => i !== index);
    if (action === 'update') { if (!string.trim()) throw new Error('Enter a comment.'); reviews = reviews.map((r, i) => i === index ? { ...r, string } : r); }
  }
  changeRevisions({ ...value, annotations: { ...annotations, reviews } });
}));
for (const accept of [true, false]) $(accept ? 'revision-accept' : 'revision-reject').addEventListener('click', () => {
  if (current.readOnly) return;
  const { from, to } = view.state.selection.main;
  if (from === to) { $('revision-summary').textContent = 'Select revised text first.'; return; }
  const result = resolveRevisions(view.state, view.state.field(revisionField), from, to, accept);
  if (!result.count) { $('revision-summary').textContent = 'The selection contains no revisions.'; return; }
  view.dispatch({ changes: result.changes, effects: setRevisions.of(result.revisions), annotations: isolateHistory.of('full') }); view.focus();
});

for (const id of ['print-header', 'print-footer', 'print-revisions', 'print-scenes', 'print-continuations']) $(id).addEventListener('change', () => { if (previewMode) refreshPreview(); });

refreshRevisionControls(view.state.field(revisionField)); refreshAnnotationControls(view.state.field(revisionField));
