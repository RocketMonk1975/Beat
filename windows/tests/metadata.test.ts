import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, type Transaction, type TransactionSpec } from '@codemirror/state';
import { history, undo, redo, isolateHistory } from '@codemirror/commands';
import { decodeDocument, encodeDocument, validateDocumentRevisions } from '../src/document';
import { revisionExtensions, revisionField } from '../src/revisions';
import { validateAnnotations } from '../src/annotations';

const settings = {
  Tags: [{ range: [3, 3], type: 'prop', definition: 'lamp-id' }],
  TagDefinitions: [{ id: 'lamp-id', type: 'prop', name: 'Lamp <safe>' }],
  'Review Ranges': [{ range: [7, 4], string: 'A comment <script> & 😀' }],
  'Caret Position': 11, 'Window Width': 900, 'Window Height': 700, 'Page Size': 0,
  'Active Plugins': [], 'Heading UUIDs': [], CharacterData: {}, 'Text Length': 12
};
const text = '😀 Lamp glows\n';
function source(value: unknown = settings, modern = true, body = text) {
  return body + (modern ? `/** settings: ${JSON.stringify(value)} **/\n` : `/* If you're seeing this, you can remove the following stuff - BEAT: ${JSON.stringify(value)} END_BEAT */\n`);
}
function editor(raw = source()) {
  const model = decodeDocument(raw);
  let state = EditorState.create({ doc: model.text, extensions: [history(), revisionExtensions(model.revisions)] });
  const dispatch = (tr: TransactionSpec | Transaction) => { state = 'state' in tr ? tr.state : state.update(tr).state; };
  return { model, get state() { return state; }, dispatch };
}

test('legacy and modern native tags, reviews and safe settings stay editable and untouched saves are exact', () => {
  for (const modern of [true, false]) {
    const raw = source(settings, modern), doc = decodeDocument(raw);
    assert.equal(doc.revisionEditable, true); assert.equal(encodeDocument(doc, doc.text), raw);
    assert.deepEqual(doc.settings?.TagDefinitions, settings.TagDefinitions);
    assert.deepEqual(doc.revisions.annotations?.tags[0], { from: 3, to: 6, type: 'prop', definition: 'lamp-id' });
  }
});
test('inserting before native ranges shifts tags, reviews and saved caret and preserves definitions and settings', () => {
  const e = editor(); e.dispatch({ changes: { from: 0, insert: 'Intro\n' } });
  const revisions = e.state.field(revisionField);
  assert.equal(revisions.annotations?.tags[0].from, 9); assert.equal(revisions.annotations?.reviews[0].from, 13); assert.equal(revisions.annotations?.caret, 17);
  const reopened = decodeDocument(encodeDocument(e.model, e.state.doc.toString(), revisions));
  assert.deepEqual(reopened.revisions, revisions); assert.deepEqual(reopened.settings?.TagDefinitions, settings.TagDefinitions);
  assert.equal(reopened.settings?.['Window Width'], 900); assert.equal(reopened.settings?.['Text Length'], e.state.doc.length);
  assert.equal(reopened.settingsFormat, 'modern');
});
test('deleting tagged text removes its range; undo and redo restore text and all metadata together', () => {
  const e = editor(); e.dispatch({ changes: { from: 3, to: 6 }, annotations: isolateHistory.of('full') });
  assert.equal(e.state.field(revisionField).annotations?.tags.length, 0);
  assert.equal(e.state.field(revisionField).annotations?.reviews[0].from, 4);
  assert.ok(undo({ state: e.state, dispatch: e.dispatch })); assert.equal(e.state.doc.toString(), text); assert.deepEqual(e.state.field(revisionField), e.model.revisions);
  assert.ok(redo({ state: e.state, dispatch: e.dispatch })); assert.equal(e.state.field(revisionField).annotations?.tags.length, 0);
  const saved = decodeDocument(encodeDocument(e.model, e.state.doc.toString(), e.state.field(revisionField)));
  assert.deepEqual(saved.settings?.TagDefinitions, settings.TagDefinitions);
});
test('native tag and review ranges round-trip BOM, CRLF and UTF-16 without splitting newline pairs', () => {
  const body = '\uFEFFA\r\n😀 Lamp glows\r\n', native = { ...settings, Tags: [{ ...settings.Tags[0], range: [6, 3] }], 'Review Ranges': [{ range: [10, 4], string: 'Comment' }], 'Caret Position': 14 };
  const doc = decodeDocument(source(native, false, body)); assert.equal(doc.revisionEditable, true);
  assert.equal(doc.revisions.annotations?.tags[0].from, 5);
  const raw = encodeDocument(doc, doc.text + 'More\n', doc.revisions), saved = decodeDocument(raw);
  assert.equal(saved.bom, true); assert.equal(saved.lineEnding, '\r\n'); assert.deepEqual(saved.revisions, doc.revisions);
  assert.deepEqual(saved.settings?.Tags, native.Tags);
  const invalid = decodeDocument(source({ ...native, Tags: [{ ...native.Tags[0], range: [2, 3] }] }, false, body));
  assert.equal(invalid.revisionEditable, false);
});
test('missing definitions, invalid categories, overlapping ranges, unknown fields and scene UUIDs keep documents protected', () => {
  for (const metadata of [
    { ...settings, TagDefinitions: [] }, { ...settings, Tags: [{ ...settings.Tags[0], type: 'unknown' }] },
    { ...settings, Tags: [...settings.Tags, ...settings.Tags] }, { ...settings, plugin: { range: [1, 2] } },
    { ...settings, 'Heading UUIDs': [{ string: 'INT. ROOM - DAY', uuid: 'scene-id' }] },
    { ...settings, 'Active Plugins': ['plugin'] }, { ...settings, Locked: true },
    { ...settings, 'Review Ranges': [{ range: [1, 2], string: 'Splits emoji' }] },
    { ...settings, 'Caret Position': 1 }, { ...settings, Tags: null }, { ...settings, TagDefinitions: null }, { ...settings, 'Review Ranges': null }, { ...settings, Revision: null }, { ...settings, 'Revision Mode': null }, { ...settings, Tags: [{ ...settings.Tags[0], customRange: [1, 2] }] }
  ]) {
    const raw = source(metadata), doc = decodeDocument(raw); assert.equal(doc.revisionEditable, false);
    assert.equal(encodeDocument(doc, doc.text), raw); assert.throws(() => encodeDocument(doc, 'changed'), /metadata/);
  }
});
test('host validation rejects dropped annotation state, forged tag references and malformed ranges', () => {
  const doc = decodeDocument(source()), revisions = doc.revisions;
  assert.equal(validateDocumentRevisions(doc, text, { ...revisions, annotations: undefined }), false);
  assert.equal(validateDocumentRevisions(doc, text, { ...revisions, annotations: { ...revisions.annotations, tags: [{ from: 0, to: 2, type: 'prop', definition: 'forged' }] } }), false);
  assert.equal(validateAnnotations({ tags: [null], reviews: [] }, text), false);
  assert.equal(validateAnnotations({ tags: [], reviews: [{ from: 1, to: 2, string: '' }] }, text), false);
});
