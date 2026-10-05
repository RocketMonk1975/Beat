import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importFDX, exportFDX } from '../src/fdx';
import { formattedRuns, parseFountain } from '../src/fountain';
const source='Title: A Story\nAuthor: A Writer\n\n.INT. CAFÉ - DAY #12A#\n\n!😀 **Bold** *italic* _under_ & <literal>.\n\n@Jane (V.O.)\n(softly)\nFirst words.\n\n@John ^\nReply.\n\n>CUT TO:\n\n>THE END<\n\n~A lyric\n';
test('FDX round trip retains paragraph semantics, dual dialogue, scene numbers and styles',()=>{
  const exported=exportFDX(source), imported=importFDX(exported.text), parsed=parseFountain(imported.text);
  assert.ok(exported.text.includes('<DualDialogue>') && exported.text.includes('Style="Bold"'));
  assert.ok(imported.text.includes('@John ^')); assert.ok(!imported.text.includes('@John  ^'));
  assert.ok(imported.text.includes('DAY #12A#'));
  assert.equal(parsed.outline[0].number,'12A'); assert.equal(parsed.dualDialogue.length,1);
  assert.deepEqual(parsed.characters,['Jane','John']);
  assert.ok(parsed.lines.some(line=>line.type==='transition')); assert.ok(parsed.lines.some(line=>line.type==='centered'));
  const action=parsed.lines.find(line=>line.text.includes('Bold'))!,runs=formattedRuns(action);
  assert.equal(runs.map(run=>run.text).join(''),'😀 Bold italic under & <literal>.');
  assert.ok(runs.some(run=>run.text==='Bold' && run.styles.includes('bold')));
  assert.ok(imported.text.includes('A Story') && imported.text.includes('A Writer'));
});
test('literal Fountain syntax and XML entities remain literal through import',()=>{
  const xml='<FinalDraft DocumentType="Script"><Content><Paragraph Type="Action"><Text>*literal* [[note]] /* omit */ &amp; &lt;tag&gt;</Text></Paragraph></Content></FinalDraft>';
  const line=parseFountain(importFDX(xml).text).lines[0];
  assert.equal(line.type,'action');assert.equal(formattedRuns(line).map(run=>run.text).join(''),'*literal* [[note]] /* omit */ & <tag>');
});
test('multiple adjacent dual groups remain independent',()=>{
  const paragraph=(name:string)=>`<Paragraph Type="Character"><Text>${name}</Text></Paragraph><Paragraph Type="Dialogue"><Text>Hello.</Text></Paragraph>`;
  const dual=(a:string,b:string)=>`<Paragraph><DualDialogue>${paragraph(a)}${paragraph(b)}</DualDialogue></Paragraph>`;
  const imported=importFDX(`<FinalDraft><Content>${dual('A','B')}${dual('C','D')}</Content></FinalDraft>`);
  assert.equal(parseFountain(imported.text).dualDialogue.length,2);
});
test('malformed, wrong-format and entity-declaring XML are rejected',()=>{
  for(const text of ['<FinalDraft><Content></FinalDraft>','<Other/>','<FinalDraft/>','<!DOCTYPE FinalDraft [<!ENTITY x SYSTEM "file:///secret">]><FinalDraft><Content/></FinalDraft>','<FinalDraft><Content><Paragraph><Text>&unknown;</Text></Paragraph></Content></FinalDraft>']) assert.throws(()=>importFDX(text));
  assert.throws(()=>importFDX('<FinalDraft><Content/></FinalDraft>'+'x'.repeat(21*1024*1024)),/limit/);
});
test('unsupported metadata and content generate explicit warnings without touching source',()=>{
  const xml='<FinalDraft><Content><Paragraph Type="Custom"><Text Style="Bold+Highlight" RevisionID="2">Keep this.</Text></Paragraph></Content><ScriptNotes><ScriptNote>Original note</ScriptNote></ScriptNotes><TagData><Tags/></TagData></FinalDraft>';
  const result=importFDX(xml);assert.ok(result.text.includes('Keep this.'));assert.ok(result.warnings.length>=3);
  const exported=exportFDX('# Act One\n\n.INT. ROOM - DAY\n\n= Synopsis\n\n!Text [[note]]\n\n===');
  assert.ok(exported.warnings.some(warning=>warning.includes('notes')));assert.ok(exported.warnings.some(warning=>warning.includes('hierarchy')));assert.ok(exported.warnings.some(warning=>warning.includes('page breaks')));
});
