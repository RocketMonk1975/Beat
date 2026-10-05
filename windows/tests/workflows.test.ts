import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, type Transaction, type TransactionSpec } from '@codemirror/state';
import { history, undo, redo, isolateHistory } from '@codemirror/commands';
import { revisionExtensions, revisionField, setRevisions, markRevision, emptyRevisions } from '../src/revisions';
import { resolveRevisions } from '../src/revision-workflow';
import { replaceAnnotation, validateDefinitions } from '../src/annotations';
import { decodeDocument, encodeDocument, validateDocumentRevisions } from '../src/document';
import { parseFountain } from '../src/fountain';
import { paginate, printHTML } from '../src/pagination';
import { sceneMove } from '../src/writing-tools';
import { moveSceneMetadata } from '../src/scene-metadata';

test('new tags and comments serialize, reopen and keep their definitions through rename and deletion', () => {
  const model = decodeDocument('!A lamp glows.\n');
  const definitions = [{ id: 'lamp', name: 'Lamp', type: 'prop' }], annotations = { tags: [{ from: 3, to: 7, definition: 'lamp', type: 'prop' }], reviews: [{ from: 8, to: 13, string: 'Review <img> & 😀 */ **/ END_BEAT */' }] };
  const value = { ...emptyRevisions(), definitions, annotations };
  assert.ok(validateDocumentRevisions(model, model.text, value));
  const reopened = decodeDocument(encodeDocument(model, model.text, value));
  assert.deepEqual(reopened.revisions, value);
  const renamed = { ...value, definitions: [{ ...definitions[0], name: 'Desk lamp', type: 'setDesign' }], annotations: { ...annotations, tags: [{ ...annotations.tags[0], type: 'setDesign' }] } };
  assert.ok(validateDocumentRevisions(reopened, reopened.text, renamed));
  const cleared = { ...renamed, definitions: [], annotations: { ...annotations, tags: [] } };
  assert.deepEqual(decodeDocument(encodeDocument(reopened, reopened.text, cleared)).revisions, cleared);
  assert.equal(validateDefinitions([{ ...definitions[0], name: ' ' }]), false);
  assert.equal(validateDocumentRevisions(model, model.text, { ...value, definitions: [] }), false);
});
test('tag and review selection changes split overlaps without losing surrounding annotations', () => {
  const ranges = [{ from: 0, to: 10, string: 'First' }];
  const updated = replaceAnnotation(ranges, 3, 7, { from: 3, to: 7, string: 'Second' });
  assert.deepEqual(updated.map(r => [r.from, r.to, r.string]), [[0,3,'First'],[3,7,'Second'],[7,10,'First']]);
  assert.deepEqual(replaceAnnotation(updated, 2, 8).map(r => [r.from,r.to]), [[0,2],[8,10]]);
});
for (const accept of [true, false]) test(`${accept ? 'accept' : 'reject'} selected revisions is one undo step and maps comments with removed text`, () => {
  let value = markRevision(emptyRevisions(), 0, 3, 'Addition'); value = markRevision(value, 4, 7, 'RemovalSuggestion');
  value.annotations = { tags: [], reviews: [{ from: 8, to: 11, string: 'Keep' }] };
  let state = EditorState.create({ doc: 'ADD OLD END', extensions: [history(), revisionExtensions(value)] });
  const dispatch = (tr: Transaction | TransactionSpec) => { state = 'state' in tr ? tr.state : state.update(tr).state; };
  const result = resolveRevisions(state, value, 0, 7, accept);
  dispatch({ changes: result.changes, effects: setRevisions.of(result.revisions), annotations: isolateHistory.of('full') });
  assert.equal(state.doc.toString(), accept ? 'ADD  END' : ' OLD END'); assert.equal(state.field(revisionField).ranges.length, 0);
  assert.equal(state.field(revisionField).annotations?.reviews[0].from, 5);
  assert.ok(undo({ state, dispatch })); assert.equal(state.doc.toString(), 'ADD OLD END'); assert.deepEqual(state.field(revisionField), value);
  assert.ok(redo({ state, dispatch })); assert.equal(state.doc.toString(), accept ? 'ADD  END' : ' OLD END');
});
test('partial revision decisions preserve marks outside the selected text', () => {
  const value = markRevision(emptyRevisions(), 0, 6, 'Addition'), state = EditorState.create({ doc: 'ABCDEF' });
  const result = resolveRevisions(state, value, 2, 4, false);
  assert.equal(result.changes.apply(state.doc).toString(), 'ABEF'); assert.deepEqual(result.revisions.ranges.map(r=>[r.from,r.to]), [[0,2],[2,4]]);
});
test('print options add escaped headers, footers, scene numbers, continuation labels and correct revision symbols', () => {
  const text = 'INT. ROOM - DAY #12A#\n\n!' + 'word '.repeat(1500) + '\n';
  const script = parseFountain(text), layout = paginate(script, 'Letter', text=>text.length*7.2, { header: '<script>Title</script>', footer: 'Draft & 😀', sceneNumbers: true, sceneContinuations: true, revisionMarks: true, revisions: [{from:0,to:20,generation:3}] });
  assert.ok(layout.pages.length > 1); const html = printHTML(layout);
  assert.ok(html.includes('aria-label="Revision 4">++')); assert.ok(html.includes('>12A</div>')); assert.ok(html.includes('>CONTINUED:</div>')); assert.ok(html.includes('>(CONTINUED)</div>'));
  assert.ok(html.includes('&lt;script&gt;Title&lt;/script&gt;')); assert.ok(!html.includes('<script>')); assert.ok(html.includes('Draft &amp; 😀'));
  layout.pages[0].rows[0].generations = [99]; assert.throws(()=>printHTML(layout),/revision/);
});
test('native character biographies, aliases, genders and hidden revision settings remain intact during edits', () => {
  const settings = { CharacterData: { JANE: { name:'JANE', aliases:['J'], bio:'Bio 😀', age:'35', gender:'female', highlightColor:'blue', realName:'Jane' } }, CharacterGenders:{JOHN:'male'}, 'Hidden Revisions':[0,3] };
  const source='INT. ROOM - DAY\n\n/** settings: '+JSON.stringify(settings)+' **/';
  const doc=decodeDocument(source); assert.equal(doc.revisionEditable,true);
  const saved=decodeDocument(encodeDocument(doc,doc.text+'!More.\n')); assert.deepEqual(saved.settings?.CharacterData,settings.CharacterData);assert.deepEqual(saved.settings?.CharacterGenders,settings.CharacterGenders);assert.deepEqual(saved.settings?.['Hidden Revisions'],[0,3]);
  const bad=decodeDocument(source.replace('"age":"35"','"range":[0,2]'));assert.equal(bad.revisionEditable,false);
});

test('scene moves carry tags, comments, revision ranges, saved caret and native heading IDs together', () => {
  const text='INT. ONE - DAY\n\n!Lamp.\n\nEXT. TWO - NIGHT\n\n!Quiet.', first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
  const model=decodeDocument(text+'/** settings: '+JSON.stringify({'Heading UUIDs':[{string:'INT. ONE - DAY',uuid:first},{string:'EXT. TWO - NIGHT',uuid:second}]})+' **/');
  const at=text.indexOf('Lamp'), value={...model.revisions,enabled:true,definitions:[{id:'lamp',name:'Lamp',type:'prop'}],annotations:{tags:[{from:at,to:at+4,definition:'lamp',type:'prop'}],reviews:[{from:at,to:at+4,string:'Note'}],caret:at},ranges:[{from:at,to:at+4,kind:'Addition' as const,generation:1}]};
  const edit=sceneMove(text,0,1), moved=moveSceneMetadata(value,edit,text.length), result=text.slice(0,edit.from)+edit.insert+text.slice(edit.to);
  assert.deepEqual(moved.headings?.map(h=>h.uuid),[second,first]);assert.equal(result.slice(moved.annotations!.tags[0].from,moved.annotations!.tags[0].to),'Lamp');
  assert.equal(moved.ranges[0].from,moved.annotations?.caret);assert.ok(validateDocumentRevisions(model,result,moved));
  assert.deepEqual(decodeDocument(encodeDocument(model,result,moved)).revisions,moved);
});
test('annotations crossing a scene boundary split and remain valid after a move', () => {
  const text='INT. ONE - DAY\n\n!First.\n\nEXT. TWO - NIGHT\n\n!Second.\n', middle=text.indexOf('EXT.'),edit=sceneMove(text,0,1);
  const value={...emptyRevisions(),annotations:{tags:[],reviews:[{from:middle-3,to:middle+4,string:'Crossing'}]}};
  const moved=moveSceneMetadata(value,edit,text.length);assert.equal(moved.annotations?.reviews.length,2);
  const pieces=moved.annotations!.reviews.map(r=>edit.insert.slice(r.from,r.to));assert.equal(pieces.join('').length,7);
  assert.ok(validateDocumentRevisions(decodeDocument(text),edit.insert,moved));
});
test('large native identity documents keep stable UUIDs and bounded edit validation', () => {
  const text=Array.from({length:1000},(_,i)=>`INT. SCENE ${i} - DAY\n\n!${'Action '.repeat(35)}\n\n`).join('');
  const model=decodeDocument(text+'/** settings: {"Heading UUIDs":[]} **/');assert.equal(model.revisionEditable,true);
  const state=EditorState.create({doc:text,extensions:revisionExtensions(model.revisions)}),start=performance.now();
  const next=state.update({changes:{from:0,insert:'!Prefix.\n\n'}}).state;
  assert.deepEqual(next.field(revisionField).headings?.map(h=>h.uuid),model.revisions.headings?.map(h=>h.uuid));
  assert.ok(validateDocumentRevisions(model,next.doc.toString(),next.field(revisionField)));assert.ok(performance.now()-start<3000);
});
