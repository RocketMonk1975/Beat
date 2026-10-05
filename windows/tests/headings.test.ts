import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EditorState, type Transaction, type TransactionSpec } from '@codemirror/state';
import { history, isolateHistory, undo, redo } from '@codemirror/commands';
import { decodeDocument, encodeDocument, validateDocumentRevisions } from '../src/document';
import { revisionExtensions, revisionField } from '../src/revisions';

const first = '11111111-1111-4111-8111-111111111111', second = '22222222-2222-4222-8222-222222222222';
const text = 'INT. SAME - DAY\n\n!First.\n\nINT. SAME - DAY\n\n!Second.\n';
const table = [{ string: 'INT. SAME - DAY', uuid: first }, { string: 'INT. SAME - DAY', uuid: second }];
const raw = (entries: unknown = table, body = text) => body + `/** settings: ${JSON.stringify({ 'Heading UUIDs': entries })} **/`;
function editor(source = raw()) {
  const model = decodeDocument(source);
  let state = EditorState.create({ doc: model.text, extensions: [history(), revisionExtensions(model.revisions)] });
  const dispatch = (tr: TransactionSpec | Transaction) => { state = 'state' in tr ? tr.state : state.update({ ...tr, annotations: isolateHistory.of('full') }).state; };
  return { model, get state() { return state; }, dispatch, get headings() { return state.field(revisionField).headings!; } };
}
test('duplicate heading names keep separate native UUIDs through insertions before the script', () => {
  const e = editor(); assert.equal(e.model.revisionEditable, true);
  e.dispatch({ changes: { from: 0, insert: '!Preface.\n\n' } });
  assert.deepEqual(e.headings.map(h => h.uuid), [first, second]); assert.equal(e.headings[0].from, 11);
  assert.deepEqual(decodeDocument(encodeDocument(e.model, e.state.doc.toString(), e.state.field(revisionField))).revisions, e.state.field(revisionField));
});
test('renaming a heading retains its UUID and undo restores both name and identity', () => {
  const e = editor(); e.dispatch({ changes: { from: 0, to: e.headings[0].to, insert: 'EXT. RENAMED - NIGHT' } });
  assert.equal(e.headings[0].uuid, first); assert.equal(e.headings[0].string, 'EXT. RENAMED - NIGHT');
  assert.ok(undo({ state: e.state, dispatch: e.dispatch })); assert.equal(e.headings[0].string, table[0].string);
  assert.ok(redo({ state: e.state, dispatch: e.dispatch })); assert.equal(e.headings[0].uuid, first);
});
test('new duplicate headings receive fresh UUIDs; delete and undo/redo never transfer IDs to neighboring scenes', () => {
  const e = editor(); e.dispatch({ changes: { from: 0, insert: 'INT. SAME - DAY\n\n!New.\n\n' } });
  const generated = e.headings[0].uuid; assert.notEqual(generated, first); assert.notEqual(generated, second);
  assert.deepEqual(e.headings.slice(1).map(h => h.uuid), [first, second]);
  assert.ok(undo({ state: e.state, dispatch: e.dispatch })); assert.deepEqual(e.headings.map(h => h.uuid), [first, second]);
  assert.ok(redo({ state: e.state, dispatch: e.dispatch })); assert.equal(e.headings[0].uuid, generated);
  e.dispatch({ changes: { from: e.headings[1].from, to: e.headings[2].from } });
  assert.deepEqual(e.headings.map(h => h.uuid), [generated, second]);
  assert.ok(undo({ state: e.state, dispatch: e.dispatch })); assert.deepEqual(e.headings.map(h => h.uuid), [generated, first, second]);
});
test('sections, forced scenes, emoji, BOM and CRLF preserve raw heading strings and native order', () => {
  const body = '\uFEFF# Act 😀\r\n\r\n.INT. ROOM - DAY #12A#\r\n\r\n!Action.\r\n';
  const entries = [{ string: '# Act 😀', uuid: first }, { string: '.INT. ROOM - DAY #12A#', uuid: second }];
  const e = editor(raw(entries, body)); assert.equal(e.model.revisionEditable, true);
  e.dispatch({ changes: { from: e.state.doc.length, insert: '\n!More.\n' } });
  const saved = decodeDocument(encodeDocument(e.model, e.state.doc.toString(), e.state.field(revisionField)));
  assert.equal(saved.bom, true); assert.equal(saved.lineEnding, '\r\n'); assert.deepEqual(saved.settings?.['Heading UUIDs'], entries);
});
test('malformed, duplicated, mismatched or incomplete native heading tables remain protected', () => {
  for (const entries of [null, [{ ...table[0], uuid: 'bad' }], [table[0]], [table[0], table[0]], [{ ...table[0], string: 'EXT. WRONG - DAY' }, table[1]], [{ ...table[0], extra: 42 }, table[1]]]) {
    const source = raw(entries), model = decodeDocument(source); assert.equal(model.revisionEditable, false);
    assert.equal(encodeDocument(model, model.text), source); assert.throws(() => encodeDocument(model, 'changed'));
  }
  const model = decodeDocument(raw()); assert.equal(validateDocumentRevisions(model, model.text, { ...model.revisions, headings: undefined }), false);
  assert.equal(validateDocumentRevisions(model, model.text, { ...model.revisions, headings: [{ ...model.revisions.headings![0], from: 1 }, model.revisions.headings![1]] }), false);
});
test('upstream Big Fish opens editable, retains all 194 UUIDs and saves untouched byte-for-byte', () => {
  const source = readFileSync('../Sample files/Big-Fish.fountain', 'utf8'), e = editor(source);
  assert.equal(e.model.revisionEditable, true); assert.equal(e.headings.length, 194);
  assert.equal(encodeDocument(e.model, e.model.text), source);
  const ids = e.headings.map(h => h.uuid); e.dispatch({ changes: { from: 0, insert: '!Windows edit.\n\n' } });
  assert.deepEqual(e.headings.map(h => h.uuid), ids);
  const saved = decodeDocument(encodeDocument(e.model, e.state.doc.toString(), e.state.field(revisionField)));
  assert.deepEqual(saved.revisions.headings?.map(h => h.uuid), ids);
});
