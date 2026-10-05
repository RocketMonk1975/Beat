import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, type TransactionSpec, type Transaction } from '@codemirror/state';
import { history, undo, redo } from '@codemirror/commands';
import { revisionExtensions, revisionField, setRevisions, markRevision, emptyRevisions, validateRevisions } from '../src/revisions';
import { decodeDocument, encodeDocument } from '../src/document';

test('revision colors and suggested removals round-trip with UTF-16, BOM and each newline style', () => {
  for (const ending of ['\n', '\r\n', '\r']) {
    const doc = decodeDocument('\uFEFFA😀' + ending + 'B' + ending);
    const revisions = { enabled: true, generation: 7, ranges: [{ from: 1, to: 5, generation: 3, kind: 'Addition' as const }, { from: 5, to: 6, generation: 7, kind: 'RemovalSuggestion' as const }] };
    const raw = encodeDocument(doc, doc.text, revisions), reopened = decodeDocument(raw);
    assert.equal(reopened.revisionEditable, true); assert.equal(reopened.text, doc.text);
    assert.deepEqual(reopened.revisions, revisions); assert.equal(encodeDocument(reopened, reopened.text), raw);
    assert.equal(reopened.bom, true); assert.equal(reopened.lineEnding, ending);
  }
});
test('unknown metadata, invalid ranges and obsolete removed ranges stay protected', () => {
  const good = encodeDocument(decodeDocument('ABC'), 'ABC', { enabled: true, generation: 0, ranges: [] });
  for (const raw of [good.replace('"Revision":', '"Tags":[[0,1]],"Revision":'), good.replace('"Addition":[]', '"Addition":[[0,99,0]]'), good.replace('"Removed":[]', '"Removed":[[0,1,0]]')]) {
    const doc = decodeDocument(raw); assert.equal(doc.revisionEditable, false);
    assert.equal(encodeDocument(doc, doc.text), raw); assert.throws(() => encodeDocument(doc, 'changed'));
  }
});
test('revision validation rejects overlaps, invalid colors and out-of-document ranges', () => {
  const good = markRevision(emptyRevisions(), 0, 2, 'Addition'); assert.ok(validateRevisions(good, 3));
  assert.equal(validateRevisions({ ...good, generation: 8 }, 3), false);
  assert.equal(validateRevisions(good, 1), false);
  assert.equal(validateRevisions({ ...good, ranges: [...good.ranges, ...good.ranges] }, 3), false);
  assert.equal(validateRevisions({ ...good, ranges: [null] }, 3), false);
  assert.equal(validateRevisions(markRevision(emptyRevisions(), 1, 2, 'Addition'), '😀'), false);
});
test('manual removal marks split additions and clearing keeps surrounding marks', () => {
  let value = markRevision(emptyRevisions(), 0, 10, 'Addition');
  value = markRevision(value, 3, 7, 'RemovalSuggestion'); assert.equal(value.ranges.length, 3);
  value = markRevision(value, 4, 6, null); assert.deepEqual(value.ranges.map(r => [r.from, r.to]), [[0,3],[3,4],[6,7],[7,10]]);
});
test('typing, deleting, multiple guarded edits and revision-only actions undo and redo together', () => {
  let state = EditorState.create({ doc: 'ABC', extensions: [history(), revisionExtensions()] });
  const dispatch = (tr: TransactionSpec | Transaction) => { state = 'state' in tr ? tr.state : state.update(tr).state; };
  dispatch({ effects: setRevisions.of({ enabled: true, generation: 2, ranges: [] }) });
  assert.ok(undo({ state, dispatch })); assert.equal(state.field(revisionField).enabled, false);
  assert.ok(redo({ state, dispatch })); assert.equal(state.field(revisionField).generation, 2);
  dispatch({ changes: [{from: 0, insert:'x'}, {from:3, insert:'y'}] });
  assert.deepEqual(state.field(revisionField).ranges.map(r => [r.from,r.to]), [[0,1],[4,5]]);
  const before = state.field(revisionField);
  assert.ok(undo({ state, dispatch })); assert.equal(state.doc.toString(), 'ABC'); assert.equal(state.field(revisionField).ranges.length, 0);
  assert.ok(redo({ state, dispatch })); assert.deepEqual(state.field(revisionField), before);
  dispatch({ changes: {from:0,to:1} }); assert.deepEqual(state.field(revisionField).ranges.map(r=>[r.from,r.to]), [[3,4]]);
  assert.ok(undo({ state, dispatch })); assert.deepEqual(state.field(revisionField), before);
});
