import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeDocument, encodeDocument, editableCopy } from '../src/document';

test('untouched scripts round-trip byte-for-byte, including BOM and mixed newlines', () => {
  for (const source of ['\uFEFFINT. ROOM - DAY\r\n\r\nHello.\n', 'INT. ROOM - DAY\r\rHello.\r', '']) {
    const document = decodeDocument(source);
    assert.equal(encodeDocument(document, document.text), source);
  }
});
test('editing preserves the source newline style and BOM', () => {
  const document = decodeDocument('\uFEFFINT. ROOM - DAY\r\n');
  assert.equal(encodeDocument(document, document.text + '\nHello.\n'), '\uFEFFINT. ROOM - DAY\r\n\r\nHello.\r\n');
});
test('legacy, modern and malformed metadata are protected; explicit copies strip metadata', () => {
  for (const suffix of ["/* If you're seeing this, you can remove the following stuff - BEAT: {\"Tags\":[[1,2]],\"unknown\":42} END_BEAT */\n", '/** settings: {"Revision":{"Addition":[[0,2]]}} **/\n', '/** settings: {broken']) {
    const raw = `INT. ROOM - DAY\n\n😀 hello\n\n${suffix}`;
    const document = decodeDocument(raw);
    assert.equal(document.metadata, suffix);
    assert.equal(encodeDocument(document, document.text), raw);
    assert.throws(() => encodeDocument(document, 'changed'), /metadata/);
    const copy = editableCopy(document);
    assert.equal(copy.metadata, null);
    assert.equal(encodeDocument(copy, copy.text + 'more'), document.text + 'more');
  }
});
test('the upstream Big Fish sample preserves all metadata', () => {
  const source = readFileSync('../Sample files/Big-Fish.fountain', 'utf8');
  const document = decodeDocument(source);
  assert.ok(document.metadata?.includes('Heading UUIDs'));
  assert.equal(encodeDocument(document, document.text), source);
});
