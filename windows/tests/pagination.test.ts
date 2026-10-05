import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFountain } from '../src/fountain';
import { paginate, wrapRuns, printHTML } from '../src/pagination';
const measure = (text: string) => [...text].length * 7.2;
const textOf = (layout: ReturnType<typeof paginate>) => layout.pages.flatMap(page => page.rows.map(row => row.runs.map(run => run.text).join(''))).join('\n');
test('Letter and A4 have bounded row geometry and explicit breaks', () => {
  for (const size of ['Letter', 'A4'] as const) {
    const layout = paginate(parseFountain('INT. ROOM - DAY\n\n!First.\n\n===\n\n!Second.'), size, measure);
    assert.equal(layout.pages.length, 2);
    assert.ok(textOf(layout).includes('First.') && textOf(layout).includes('Second.'));
    for (const page of layout.pages) for (const row of page.rows) { assert.ok(row.x >= 108); assert.ok(row.x + row.width <= layout.width - 72 + .01); assert.ok(row.y + 12 <= layout.height - 72); }
    assert.ok(!textOf(layout).includes('==='));
  }
});
test('dialogue continues with more and repeated cue without losing speech', () => {
  const speech = Array.from({length:140}, (_, i) => `Sentence${i}.`).join(' ');
  const layout = paginate(parseFountain('@JANE\n' + speech), 'Letter', measure), printed = textOf(layout);
  assert.ok(layout.pages.length > 1); assert.ok(printed.includes('(MORE)')); assert.ok(printed.includes("JANE (CONT'D)"));
  const spoken = layout.pages.flatMap(page => page.rows.filter(row => row.type === 'dialogue').map(row => row.runs.map(run => run.text).join(''))).join('');
  assert.equal(spoken, speech);
});
test('dual dialogue paginates both columns and retains unequal speeches', () => {
  const left = 'Left sentence. '.repeat(120), right = 'Right sentence. '.repeat(60);
  const layout = paginate(parseFountain('@JANE\n'+left+'\n\n@JOHN ^\n'+right), 'Letter', measure);
  assert.ok(layout.pages.length > 1);
  for (const [side, source] of [['left',left],['right',right]] as const) {
    const spoken = layout.pages.flatMap(page => page.rows.filter(row => row.type === 'dialogue' && row.side === side).map(row => row.runs.map(run => run.text).join(''))).join('');
    assert.equal(spoken, source);
  }
});
test('wrapping preserves emphasis and graphemes even in long unbroken tokens', () => {
  const value = '😀e\u0301👩‍💻'.repeat(20), rows = wrapRuns([{text:value,styles:['bold','underline']}], 30, measure);
  assert.equal(rows.flatMap(row => row.map(run => run.text)).join(''),value);
  assert.ok(rows.every(row => row.every(run => run.styles.includes('bold') && run.styles.includes('underline'))));
  assert.ok(rows.every(row => !row[0].text.startsWith('\u0301') && !row[0].text.startsWith('\u200d')));
});
test('title page is separate and HTML cannot execute screenplay text', () => {
  const layout = paginate(parseFountain('Title: My Story\nAuthor: A Writer\n\n!<script>alert(1)</script>\n\n[[secret]]'), 'Letter', measure);
  assert.equal(layout.pages.length,2); assert.equal(layout.pages[0].title,true);
  const html = printHTML(layout); assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>')); assert.ok(!html.includes('secret'));
  assert.throws(() => printHTML({ ...layout, pages: [{title:false,rows:[{runs:[],type:'action',x:NaN,y:0,width:0}]}] }), /Invalid/);
});
test('scene headings do not land at a page foot without following content', () => {
  const source = Array.from({length:51}, (_,i)=>'!Action '+i).join('\n')+'\n\nINT. NEXT - DAY\n\n!Next scene.';
  const layout=paginate(parseFountain(source),'Letter',measure);
  assert.equal(layout.pages[1].rows[0].type,'scene');
});
