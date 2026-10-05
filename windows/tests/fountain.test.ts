import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFountain, formattedRuns } from '../src/fountain';
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


const nativeRules = JSON.parse(readFileSync('tests/fixtures/native-rules.json', 'utf8').replace(/^\uFEFF/, '')) as { name: string; rule: string; source: string; types: string[]; characters?: string[] }[];
for (const fixture of nativeRules) test(`native rule fixture: ${fixture.name}`, () => {
  const parsed = parseFountain(fixture.source);
  assert.deepEqual(parsed.lines.map(line => line.type), fixture.types, fixture.rule);
  if (fixture.characters) assert.deepEqual(parsed.characters, fixture.characters);
  for (const line of parsed.lines) {
    assert.equal(fixture.source.slice(line.from, line.to), line.text);
    for (const range of line.inline) assert.ok(range.from >= line.from && range.to <= line.to && range.to >= range.from);
  }
});
const plain = (source: string) => parseFountain(source).lines.map(line => formattedRuns(line).map(run => run.text).join('')).join('\n');
test('inline styles overlap without changing UTF-16 source or styling comments', () => {
  const source = '!😀 **bold** *italic* _under_ ***both*** **bold _under_** [[*hidden*]] /* **omitted** */';
  const line = parseFountain(source).lines[0], runs = formattedRuns(line);
  assert.equal(runs.map(run => run.text).join(''), '😀 bold italic under both bold under  ');
  assert.ok(runs.some(run => run.text === 'both' && run.styles.includes('bold') && run.styles.includes('italic')));
  assert.ok(runs.some(run => run.text === 'under' && run.styles.includes('bold') && run.styles.includes('underline')));
  assert.equal(source.slice(line.from, line.to), source);
  assert.ok(!runs.some(run => run.text.includes('hidden') || run.text.includes('omitted')));
});
test('escaped and unmatched markup stays literal and cannot swallow later lines', () => {
  assert.equal(plain(String.raw`!\*literal\* \_word\_ **open`), '*literal* _word_ **open');
  assert.equal(plain(String.raw`\.INT. literal`), '.INT. literal');
  assert.equal(plain('!Before [[unfinished\n\nEXT. ROOM - DAY'), 'Before [[unfinished\n\nEXT. ROOM - DAY');
  assert.equal(plain('/* omit */!Visible.'), 'Visible.');
});
test('dual dialogue pairs adjacent blocks with unequal lengths and source offsets', () => {
  const source = '@Jane\nHello.\n(still speaking)\nMore.\n\n@John ^\n(replying)\nYes.\n\n!Next.\n';
  const parsed = parseFountain(source);
  assert.deepEqual(parsed.dualDialogue, [{ leftStart: 0, leftEnd: 3, rightStart: 5, rightEnd: 7 }]);
  assert.deepEqual(parsed.lines.slice(0, 4).map(line => line.dualSide), ['left', 'left', 'left', 'left']);
  assert.deepEqual(parsed.lines.slice(5, 8).map(line => line.dualSide), ['right', 'right', 'right']);
  assert.equal(parsed.lines[9].dualSide, undefined);
  assert.deepEqual(parsed.characters, ['Jane', 'John']);
  assert.equal(formattedRuns(parsed.lines[5]).map(run => run.text).join('').trim(), 'John');
  assert.equal(parseFountain('@Jane ^\nAlone.').dualDialogue.length, 0);
  assert.equal(parseFountain('@Jane\nHello.\n\n!An interruption.\n\n@John ^\nYes.').dualDialogue.length, 0);
});
test('outline and word counts exclude comments, markup and scene-number syntax', () => {
  const parsed = parseFountain('.**CAFÉ** #12A# [[COLOR #aabbcc]]\n\n!One [[hidden\nsecret]] two /* also secret */ _three_.');
  assert.equal(parsed.outline[0].title, 'CAFÉ'); assert.equal(parsed.outline[0].number, '12A');
  assert.equal(parsed.outline[0].color, '#aabbcc'); assert.equal(parsed.words, 4);
});
test('long malformed markup and dense style ranges remain bounded', () => {
  const before = performance.now();
  parseFountain('!'+('[[open '.repeat(20000))+'\n\nINT. ROOM - DAY');
  const dense = parseFountain('!' + '**word** '.repeat(15000));
  assert.equal(dense.words, 15000);
  assert.ok(performance.now() - before < 3000);
});
