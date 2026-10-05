import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDocument, checkPosition, validateEdits, documentSlice, findText, outline, type AutomatedDocument } from '../src/automation';
const document: AutomatedDocument = { id: 'document-1', revision: 4, name: 'test.fountain', path: null, text: 'INT. ROOM - DAY\n\n😀 Jane sees Jane.\n\nEXT. ROAD - NIGHT\n', dirty: true, readOnly: false };
test('automation rejects a different document or stale revision', () => {
  assert.doesNotThrow(() => checkDocument(document, { documentId: document.id, revision: 4 }));
  for (const params of [{ documentId: document.id, revision: 3 }, { documentId: 'old-document', revision: 4 }, {}]) assert.throws(() => checkDocument(document, params), /document changed/);
});
test('atomic edits require matching text, valid ranges, and non-overlapping positions', () => {
  const from = document.text.indexOf('Jane');
  const edits = validateEdits(document.text, [{ from, to: from + 4, insert: 'Jade\r\n', expectedText: 'Jane' }]);
  assert.equal(edits[0].insert, 'Jade\n');
  assert.throws(() => validateEdits(document.text, [{ from, to: from + 4, insert: 'Jade', expectedText: 'John' }]), /expected text/);
  assert.throws(() => validateEdits(document.text, [{ from: -1, to: 0, insert: '', expectedText: '' }]), /Offsets/);
  assert.throws(() => validateEdits(document.text, [{ from: 0, to: 2, insert: 'A', expectedText: 'IN' }, { from: 1, to: 3, insert: 'B', expectedText: 'NT' }]), /overlap/);
  assert.throws(() => validateEdits('abc', [{ from: 1, to: 1, insert: 'A', expectedText: '' }, { from: 1, to: 1, insert: 'B', expectedText: '' }]), /insertion position/);
});
test('automation ranges cannot split an emoji surrogate pair', () => {
  const from = document.text.indexOf('😀');
  assert.doesNotThrow(() => checkPosition(document.text, from));
  assert.doesNotThrow(() => checkPosition(document.text, from + 2));
  assert.throws(() => checkPosition(document.text, from + 1), /surrogate/);
});
test('document slices report exact UTF-16 offsets and bounded output', () => {
  const result = documentSlice(document, { startLine: 3, endLine: 3 });
  assert.equal(result.text, '😀 Jane sees Jane.');
  assert.equal(result.from, document.text.indexOf('😀'));
  assert.equal(result.documentId, document.id);
  assert.equal(result.revision, 4);
  assert.equal(result.sceneCount, 2);
  assert.throws(() => documentSlice(document, { startLine: 0 }), /line range/);
  const large = documentSlice({ ...document, text: 'x'.repeat(49999) + '😀rest' }, {});
  assert.equal(large.text.length, 49999);
  assert.equal(large.truncated, true);
});
test('literal search escapes regex characters and preserves Unicode offsets', () => {
  assert.equal(findText('A.*B A.*B', '.*').count, 2);
  const found = findText('İ JANE jane', 'jane', false);
  assert.deepEqual(found.matches.map(match => match.from), [2, 7]);
  assert.equal(findText(document.text, 'Jane').count, 2);
  assert.throws(() => findText(document.text, ''), /Search text/);
});
test('outline query returns versioned scenes and truncated results stay bounded', () => {
  const result = outline(document, 'road');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].line, 5);
  const found = findText('hello '.repeat(1001), 'hello');
  assert.equal(found.count, 1001);
  assert.equal(found.matches.length, 1000);
  assert.equal(found.truncated, true);
});
