import { test } from 'node:test';
import assert from 'node:assert/strict';
import { characterSuggestions, sceneMove } from '../src/writing-tools';
import { parseFountain } from '../src/fountain';
const known = '@JANE\nHello.\n\n@JANET\nHi.\n\n@Ngọc\nXin chào.\n\n';
test('suggestions match cue context, preserve extensions and Unicode names', () => {
  const text = known+'@JA (V.O.) ^';
  const result=characterSuggestions(text,known.length+3)!;
  assert.deepEqual(result.names,['JANE','JANET']);
  assert.equal(text.slice(0,result.from)+'JANE'+text.slice(result.to),known+'@JANE (V.O.) ^');
  assert.deepEqual(characterSuggestions(known+'@Ng',known.length+3)?.names,['Ngọc']);
  assert.equal(characterSuggestions(known+'Action prose',known.length+12),null);
  assert.equal(characterSuggestions(known+'@JANE\nJA',known.length+8),null);
  assert.equal(characterSuggestions(known+'[[JA',known.length+4),null);
});
test('explicit completion supports blank cues and replacement inside a name',()=>{
  assert.ok(characterSuggestions(known,known.length,true)?.names.includes('JANE'));
  assert.equal(characterSuggestions(known,known.length),null);
  const text=known+'@JAX (O.S.)';const result=characterSuggestions(text,known.length+3)!;
  assert.equal(text.slice(0,result.from)+'JANE'+text.slice(result.to),known+'@JANE (O.S.)');
  assert.equal(characterSuggestions(text,-1),null);
});
const scenes='Title: Story\n\n# Act One\n\nINT. ONE - DAY #1#\n\n= One synopsis\n\n!First 😀.\n\nEXT. TWO - NIGHT #2# [[COLOR BLUE]]\n\n@JANE\nSecond.\n\n# Act Two\n\nINT. THREE - DAY\n\n!Third.';
test('scene moves preserve title, sections, synopsis, explicit numbers and exact blocks',()=>{
  const parsed=parseFountain(scenes),second=parsed.outline.find(item=>item.number==='2')!;
  const move=sceneMove(scenes,second.from,-1),result=scenes.slice(0,move.from)+move.insert+scenes.slice(move.to);
  assert.ok(result.startsWith('Title: Story\n\n# Act One\n\nEXT. TWO'));
  assert.ok(result.includes('= One synopsis\n\n!First 😀.'));
  assert.ok(result.endsWith('# Act Two\n\nINT. THREE - DAY\n\n!Third.'));
  assert.deepEqual(parseFountain(result).outline.filter(item=>item.type==='scene').map(item=>item.number),['2','1','3']);
  assert.equal(result.slice(move.anchor,move.anchor+3),'EXT');
  assert.throws(()=>sceneMove(scenes,second.from,1),/section/);
  assert.throws(()=>sceneMove(scenes,123,1),/changed/);
});
test('moving EOF scene without newline retains valid heading separation',()=>{
  const text='INT. ONE - DAY\n\n!First.\n\nEXT. TWO - NIGHT\n\n!Second.';
  const move=sceneMove(text,0,1),result=move.insert;
  assert.equal(parseFountain(result).outline.length,2);
  assert.equal(parseFountain(result).outline[0].title,'EXT. TWO - NIGHT');
  assert.equal(result.slice(move.anchor,move.anchor+3),'INT');
  assert.ok(result.includes('!Second.\n\nINT. ONE'));
});
