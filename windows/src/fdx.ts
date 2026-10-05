import { DOMParser, type Element as XMLElement } from '@xmldom/xmldom';
import { formattedRuns, parseFountain, type FormattedRun, type FountainLine } from './fountain';
export interface FDXResult { text: string; warnings: string[]; }
const limit = 20 * 1024 * 1024;
const invalidXML = (text: string) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);
const xml = (text: string) => text.replace(/[&<>"']/g, value => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[value]!));
const children = (element: XMLElement) => Array.from(element.childNodes).filter(node => node.nodeType === 1) as XMLElement[];
const literal = (text: string) => text.replace(/[\\*_\[\]]/g, '\\$&');
function toFountain(runs: {text:string;style:string}[]): string {
  return runs.map(run => {
    const styles = run.style.split('+'), bold = styles.includes('Bold'), italic = styles.includes('Italic'), underline = styles.includes('Underline');
    const marker = bold ? italic ? '***' : '**' : italic ? '*' : '';
    return run.text.replace(/\r\n?/g,'\n').split('\n').map(line => {
      const parts = line.match(/^(\s*)(.*?)(\s*)$/)!;
      return parts[1] + (parts[2] ? marker + (underline ? '_' : '') + literal(parts[2]) + (underline ? '_' : '') + marker : '') + parts[3];
    }).join('\n');
  }).join('');
}
export function importFDX(source: string): FDXResult {
  if (source.length > limit) throw new Error('FDX exceeds the 20 MB import limit.');
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(source)) throw new Error('FDX containing DTDs or entity declarations is not supported.');
  if (invalidXML(source)) throw new Error('FDX contains invalid XML characters.');
  const document = new DOMParser({onError: (_level,message) => { throw new Error(message); }}).parseFromString(source,'application/xml');
  const root = document.documentElement;
  if (!root || root.tagName !== 'FinalDraft' || root.getAttribute('DocumentType') && root.getAttribute('DocumentType') !== 'Script') throw new Error('Choose a Final Draft screenplay (.fdx).');
  const content = children(root).find(node => node.tagName === 'Content');
  if (!content) throw new Error('The FDX document has no screenplay Content.');
  const warnings = new Set<string>();
  let count = 0;
  const inspect = (element: XMLElement, depth = 0) => {
    if (++count > 100000 || depth > 128) throw new Error('FDX structure exceeds the import limit.');
    if (['Revisions','TagData','ScriptNotes','SceneProperties'].includes(element.tagName) && (children(element).length || element.attributes.length)) warnings.add(`${element.tagName} is not converted; the original FDX stays intact.`);
    for (const attribute of Array.from(element.attributes)) if (['RevisionID','TagNumber','Color','Font','Size'].includes(attribute.name)) warnings.add('Revision, tag, color and custom font information is not converted.');
    for (const node of children(element)) inspect(node,depth+1);
  };
  inspect(root);
  const paragraphs: {node:XMLElement;dual:number}[] = [];
  let group = 0;
  const collect = (node: XMLElement, dual = 0) => {
    const pair = children(node).find(child => child.tagName === 'DualDialogue');
    if (pair) { const id=++group; children(pair).forEach(child => collect(child,id)); return; }
    if (node.tagName === 'DualDialogue') { const id=++group; children(node).forEach(child => collect(child,id)); return; }
    if (node.tagName === 'Paragraph') { paragraphs.push({node,dual}); return; }
    warnings.add(`Unsupported content element ${node.tagName} was preserved as action text.`);
    if (node.textContent?.trim()) paragraphs.push({node,dual:0});
  };
  children(content).forEach(node=>collect(node));
  const body: string[] = [];
  let previous = '', dualCues = 0, inDual = 0;
  for (const {node,dual} of paragraphs) {
    const type = node.getAttribute('Type') ?? 'Action';
    const texts = children(node).filter(child=>child.tagName==='Text');
    for (const child of children(node)) if (!['Text','SceneProperties'].includes(child.tagName)) warnings.add(`Paragraph feature ${child.tagName} is not converted.`);
    for (const text of texts) if ((text.getAttribute('Style') ?? '').split('+').some(style=>style && !['Bold','Italic','Underline'].includes(style))) warnings.add('Unsupported text styles were converted to plain text.');
    let value = texts.length ? toFountain(texts.map(text=>({text:text.textContent ?? '',style:text.getAttribute('Style') ?? ''}))) : literal(node.textContent ?? '');
    if (!value.trim()) { previous=''; if (body.length && body[body.length-1] !== '') body.push(''); continue; }
    if (dual && dual !== inDual) dualCues = 0;
    if (!dual) dualCues=0;
    inDual=dual;
    const dialog = ['Dialogue','Parenthetical'].includes(type);
    if (body.length && (!dialog || !['Character','Dialogue','Parenthetical'].includes(previous)) && body[body.length-1] !== '') body.push('');
    if (type==='Scene Heading') {
      const number=node.getAttribute('Number');
      if (number && /[#\r\n]/.test(number)) throw new Error('Invalid FDX scene number.');
      value='.'+value.trimEnd()+(number ? ` #${number}#` : '');
    } else if (type==='Character') { dualCues++; value='@'+value.trimEnd()+(dual && dualCues===2 ? ' ^' : ''); }
    else if (type==='Dialogue') value=value.split('\n').map(line=>/^[.!#=>~@（(]/.test(line) ? '\\'+line : line).join('\n');
    else if (type==='Parenthetical') { if (!value.startsWith('(')) value='('+value+')'; }
    else if (type==='Transition') value='>'+value;
    else if (type==='Shot') value='!!'+value;
    else if (type==='Lyrics') value='~'+value;
    else { if (type!=='Action') warnings.add(`Paragraph type ${type} was preserved as action.`); value=/^(Centered|Center)$/i.test(node.getAttribute('Alignment') ?? '') ? '>'+value+'<' : value.split('\n').map(line=>'!'+line).join('\n'); }
    body.push(value); previous=type;
  }
  const title = children(root).find(node=>node.tagName==='TitlePage');
  const titleLines: string[] = [];
  if (title) {
    const titleContent=children(title).find(node=>node.tagName==='Content');
    if (titleContent) for (const node of children(titleContent)) if (node.tagName==='Paragraph') {
      const value=toFountain(children(node).filter(child=>child.tagName==='Text').map(text=>({text:text.textContent ?? '',style:text.getAttribute('Style') ?? ''})));
      if (value.trim()) titleLines.push(value);
    }
    if (titleLines.length) warnings.add('Title-page text is retained; original positioning and field labels are not retained.');
  }
  const result=(titleLines.length ? 'Title: '+titleLines.join('\n    ')+'\n\n' : '')+body.join('\n')+'\n';
  if (invalidXML(result)) throw new Error('FDX contains invalid text characters.');
  if (result.length>limit) throw new Error('Converted screenplay exceeds the 20 MB limit.');
  return {text:result,warnings:[...warnings]};
}
function textXML(runs: FormattedRun[]): string {
  return runs.map(run => `<Text${run.styles.length ? ` Style="${run.styles.map(style=>({bold:'Bold',italic:'Italic',underline:'Underline'}[style])).join('+')}"` : ''}>${xml(run.text)}</Text>`).join('');
}
export function exportFDX(source: string): FDXResult {
  if (source.length>limit || invalidXML(source)) throw new Error('Screenplay is too large or contains invalid XML characters.');
  const parsed=parseFountain(source), warnings=new Set<string>(), content:string[]=[], title:string[]=[];
  if (parsed.lines.some(line => line.inline.some(range => range.style === 'note'))) warnings.add('Fountain notes are omitted from FDX export.');
  const pairs=new Map(parsed.dualDialogue.map(pair=>[pair.leftStart,pair]));
  const types: Record<string,string>={scene:'Scene Heading',action:'Action',character:'Character',dialogue:'Dialogue',parenthetical:'Parenthetical',transition:'Transition',shot:'Shot',lyrics:'Lyrics',centered:'Action'};
  const paragraph=(line:FountainLine) => {
    const number=line.type==='scene' ? parsed.outline.find(item=>item.from===line.from)?.number : undefined;
    return `<Paragraph Type="${types[line.type] ?? 'Action'}"${number ? ` Number="${xml(number)}"` : ''}${line.type==='centered' ? ' Alignment="Center"' : ''}>${textXML(formattedRuns(line))}</Paragraph>`;
  };
  for (let i=0;i<parsed.lines.length;i++) {
    const line=parsed.lines[i];
    if (line.inline.some(range=>range.style==='note')) warnings.add('Fountain notes are omitted from FDX export.');
    if (line.type==='title') {
      const runs=formattedRuns(line).map(run=>({...run})); if (runs[0]) runs[0].text=runs[0].text.replace(/^\s*[^:]+:\s*/,'');
      title.push(`<Paragraph Type="Action" Alignment="Center">${textXML(runs)}</Paragraph>`);continue;
    }
    if (['note','boneyard'].includes(line.type)) continue;
    if (['section','synopsis'].includes(line.type)) warnings.add('Sections and synopsis text are exported as action; outline hierarchy is not retained.');
    if (line.type==='page-break') { warnings.add('Explicit Fountain page breaks are omitted; Final Draft repaginates the script.');continue; }
    if (line.type==='empty') continue;
    const pair=pairs.get(i);
    if (pair) { content.push('<Paragraph><DualDialogue>'+parsed.lines.slice(pair.leftStart,pair.rightEnd+1).filter(item=>['character','dialogue','parenthetical'].includes(item.type)).map(paragraph).join('')+'</DualDialogue></Paragraph>');i=pair.rightEnd; }
    else content.push(paragraph(line));
  }
  return {text:`<?xml version="1.0" encoding="UTF-8" standalone="no"?><FinalDraft DocumentType="Script" Template="No" Version="1"><Content>${content.join('')}</Content>${title.length ? `<TitlePage><Content>${title.join('')}</Content></TitlePage>` : ''}</FinalDraft>`,warnings:[...warnings]};
}
