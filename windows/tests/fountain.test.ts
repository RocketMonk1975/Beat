import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFountain } from '../src/fountain';
import { decodeDocument } from '../src/document';

test('screenplay context distinguishes action, cues, parentheticals and dialogue', () => {
  const script = 'INT. ROOM - DAY\n\nA quiet room.\n\nJANE (V.O.)\n(softly)\nHello there.\n\n!LOUD ACTION\n\nCUT TO:\n\nEXT. STREET - NIGHT\n';
  const parsed = parseFountain(script);
  assert.deepEqual(parsed.lines.map(line => line.type), ['scene','empty','action','empty','character','parenthetical','dialogue','empty','action','empty','transition','empty','scene','empty']);
  assert.deepEqual(parsed.characters, ['JANE']);
  assert.equal(parsed.outline.length, 2);
});
test('forced elements, dual-dialogue cue, outline depth, synopsis and scene numbers', () => {
  const parsed = parseFountain('## Sequence\n\n.a peculiar place #12A# [[COLOR BLUE]]\n\n= A secret arrives.\n\n@Jane ^\nHello.\n\n>FADE OUT.\n\n>THE END<\n\n~A lyric\n\n===\n');
  assert.equal(parsed.outline[0].depth, 2);
  assert.equal(parsed.outline[1].number, '12A');
  assert.equal(parsed.outline[1].title, 'a peculiar place');
  assert.equal(parsed.outline[1].color, 'blue');
  assert.equal(parsed.outline[1].synopsis, 'A secret arrives.');
  assert.equal(parsed.lines[6].type, 'character');
  assert.equal(parsed.lines[7].type, 'dialogue');
  assert.equal(parsed.lines[9].type, 'transition');
  assert.equal(parsed.lines[11].type, 'centered');
  assert.equal(parsed.lines[13].type, 'lyrics');
  assert.equal(parsed.lines[15].type, 'page-break');
});
test('title-page continuation, boneyards and notes do not appear as scenes', () => {
  const script = 'Title: My script\nAuthor: A Writer\nContact:\n  writer@example.com\n\n/*\nINT. HIDDEN - DAY\n*/\n\n[[\nEXT. HIDDEN - DAY\n]]\n\nint. café - day\n';
  const parsed = parseFountain(script);
  assert.equal(parsed.lines[3].type, 'title');
  assert.equal(parsed.outline.length, 1);
  assert.equal(parsed.outline[0].title, 'int. café - day');
});
test('UTF-16 positions navigate correctly around emoji and non-Latin text', () => {
  const script = '😀 Một câu chuyện.\n\nEXT. HÀ NỘI - DAY\n\n@Ngọc\nXin chào.\n';
  const parsed = parseFountain(script);
  assert.equal(parsed.outline[0].from, script.indexOf('EXT.'));
  assert.equal(parsed.lines[5].from, script.indexOf('Xin'));
  assert.deepEqual(parsed.characters, ['Ngọc']);
});
test('outline fixture discovers headings and retains scene notes/synopses', () => {
  const source = readFileSync('../Sample files/Outlining.fountain', 'utf8');
  const parsed = parseFountain(decodeDocument(source).text);
  assert.ok(parsed.outline.filter(item => item.type === 'scene').length >= 6);
  assert.ok(parsed.outline.some(item => item.color === 'red'));
  assert.ok(parsed.outline.some(item => item.synopsis.includes('synopsis')));
});
test('realistic script and repeated large script parse within an interactive budget', () => {
  const source = decodeDocument(readFileSync('../Sample files/Big-Fish.fountain', 'utf8')).text;
  const before = performance.now();
  const parsed = parseFountain(source);
  assert.ok(parsed.outline.filter(item => item.type === 'scene').length > 100);
  assert.ok(parsed.words > 15000);
  assert.ok(performance.now() - before < 1000);
  const large = parseFountain(source.repeat(5));
  assert.ok(large.outline.length >= parsed.outline.length * 5);
});
