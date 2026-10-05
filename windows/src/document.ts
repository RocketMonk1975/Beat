import { emptyRevisions, validateRevisions, type Revisions } from './revisions';
import { tagTypes, validBoundary, validateAnnotations, type Annotations } from './annotations';
export { validateRevisions } from './revisions';
export interface FountainDocument {
  text: string;
  original: string;
  metadata: string | null;
  lineEnding: '\n' | '\r\n' | '\r';
  bom: boolean;
  revisions: Revisions;
  revisionEditable: boolean;
  settings: Record<string, unknown> | null;
  settingsFormat: 'legacy' | 'modern';
}

const markers = ["/* If you're seeing this, you can remove the following stuff - BEAT:", '/** settings:'];
function countBefore(positions: number[], offset: number): number {
  let low = 0, high = positions.length;
  while (low < high) { const middle = (low + high) >>> 1; if (positions[middle] < offset) low = middle + 1; else high = middle; }
  return low;
}

const scalarSettings: Record<string, 'number' | 'string' | 'boolean'> = {
  'Window Width': 'number', 'Window Height': 'number', 'Page Size': 'number', 'Sidebar Width': 'number',
  'Sidebar Visible': 'boolean', 'Color-code Pages': 'boolean', 'Scene Numbering Starts From': 'number',
  'Print Scene Numbers': 'boolean', printDialogueNumbers: 'boolean', 'Print Synopsis': 'boolean', 'Print Sections': 'boolean', 'Print Notes': 'boolean',
  'Revision Highlighting': 'boolean', 'Hide Page Numbers': 'boolean', printHeadingColor: 'boolean',
  headerString: 'string', headerAlignment: 'number', Stylesheet: 'string', firstPageNumber: 'number', pageNumberingMode: 'number',
  novelLineHeightMultiplier: 'number', novelContentAlignment: 'number', 'Text Length': 'number'
};
const rangeSettings = ['Revision', 'Revision Level', 'Revision Mode', 'Tags', 'TagDefinitions', 'Review Ranges', 'Caret Position'];
function object(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function checkSettings(settings: Record<string, any>) {
  for (const [key, value] of Object.entries(settings)) {
    if (rangeSettings.includes(key)) continue;
    if (Object.hasOwn(scalarSettings, key)) {
      const type = scalarSettings[key];
      if (type === 'boolean' ? ![true, false, 0, 1].includes(value) : typeof value !== type || type === 'number' && !Number.isFinite(value)) throw new Error('Invalid document setting');
    } else if (['Heading UUIDs', 'Changed Indices', 'Active Plugins', 'Hidden Revisions'].includes(key)) {
      if (!Array.isArray(value) || value.length) throw new Error('Unsupported positional or plugin metadata');
    } else if (['CharacterData', 'CharacterGenders'].includes(key)) {
      if (!object(value) || Object.keys(value).length) throw new Error('Unsupported character metadata');
    } else if (key === 'Revision Color') { if (value !== '') throw new Error('Unsupported legacy revision color'); }
    else if (key === 'Locked') { if (![false, 0].includes(value)) throw new Error('Locked document'); }
    else throw new Error('Unknown document setting');
  }
}
/** Edit only known native metadata; unsupported data keeps the original byte-for-byte. */
export function decodeDocument(raw: string): FountainDocument {
  const bom = raw.startsWith('\uFEFF');
  const body = bom ? raw.slice(1) : raw;
  const starts = markers.map(marker => body.indexOf(marker)).filter(position => position >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  const text = start < 0 ? body : body.slice(0, start);
  const lineEnding = body.includes('\r\n') ? '\r\n' : body.includes('\r') ? '\r' : '\n';
  const normalized = text.replace(/\r\n?|\n/g, '\n'), metadata = start < 0 ? null : body.slice(start);
  let revisions = emptyRevisions(), revisionEditable = metadata === null;
  let settings: Record<string, any> | null = null, settingsFormat: 'legacy' | 'modern' = 'legacy';
  if (metadata) {
    try {
      const legacy = metadata.match(/^\/\* If you're seeing this, you can remove the following stuff - BEAT:\s*(\{[\s\S]*\})\s*END_BEAT \*\/\s*$/);
      const modern = metadata.match(/^\/\*\* settings:\s*(\{[\s\S]*\})\s*\*\*\/\s*$/);
      const match = legacy ?? modern;
      if (!match) throw new Error('Unsupported settings envelope');
      const parsed = JSON.parse(match[1]);
      if (!object(parsed)) throw new Error('Invalid settings');
      checkSettings(parsed); settings = parsed; settingsFormat = legacy ? 'legacy' : 'modern';
      const revision = Object.hasOwn(settings, 'Revision') ? settings.Revision : { Addition: [], RemovalSuggestion: [], Removed: [] };
      if (!object(revision) || Object.keys(revision).some(key => !['Addition', 'RemovalSuggestion', 'Removed'].includes(key)) || !Array.isArray(revision.Removed) || revision.Removed.length) throw new Error('Unsupported revision metadata');
      const crlf = [...text.matchAll(/\r\n/g)].map(match => match.index + 1);
      const position = (offset: number) => offset - countBefore(crlf, offset);
      const ranges = ['Addition', 'RemovalSuggestion'].flatMap(kind => {
        if (!Array.isArray(revision[kind])) throw new Error('Invalid revision ranges');
        return revision[kind].map((entry: number[]) => {
          if (!Array.isArray(entry) || entry.length !== 3 || !entry.every(Number.isInteger) || entry[0] < 0 || entry[1] <= 0 || entry[0] + entry[1] > text.length || text[entry[0] - 1] === '\r' && text[entry[0]] === '\n' || text[entry[0] + entry[1] - 1] === '\r' && text[entry[0] + entry[1]] === '\n') throw new Error('Invalid native revision range');
          return { from: position(entry[0]), to: position(entry[0] + entry[1]), generation: entry[2], kind: kind as 'Addition' | 'RemovalSuggestion' };
        });
      }).sort((a, b) => a.from - b.from);
      const mode = Object.hasOwn(settings, 'Revision Mode') ? settings['Revision Mode'] : false;
      if (![false, true, 0, 1].includes(mode)) throw new Error('Invalid revision mode');
      revisions = { enabled: Boolean(mode), generation: Object.hasOwn(settings, 'Revision Level') ? settings['Revision Level'] : 0, ranges };
      if (['Tags', 'TagDefinitions', 'Review Ranges', 'Caret Position'].some(key => key in settings!)) {
        const definitions = Object.hasOwn(settings, 'TagDefinitions') ? settings.TagDefinitions : [], ids = new Map<string, string>();
        if (!Array.isArray(definitions) || definitions.length > 100000) throw new Error('Invalid tag definitions');
        for (const definition of definitions) {
          if (!object(definition) || Object.keys(definition).some(key => !['id', 'name', 'type'].includes(key)) || typeof definition.id !== 'string' || !definition.id || ids.has(definition.id) || typeof definition.name !== 'string' || !tagTypes.includes(definition.type)) throw new Error('Invalid tag definition');
          ids.set(definition.id, definition.type);
        }
        const readRange = (entry: Record<string, any>) => {
          const r = entry.range;
          if (!Array.isArray(r) || r.length !== 2 || !r.every(Number.isInteger) || r[1] <= 0 || !validBoundary(text, r[0]) || !validBoundary(text, r[0] + r[1]) || text[r[0] - 1] === '\r' && text[r[0]] === '\n' || text[r[0] + r[1] - 1] === '\r' && text[r[0] + r[1]] === '\n') throw new Error('Invalid native annotation range');
          return { from: position(r[0]), to: position(r[0] + r[1]) };
        };
        const tags = Object.hasOwn(settings, 'Tags') ? settings.Tags : [], reviews = Object.hasOwn(settings, 'Review Ranges') ? settings['Review Ranges'] : [];
        if (!Array.isArray(tags) || !Array.isArray(reviews) || tags.length > 100000 || reviews.length > 100000) throw new Error('Invalid annotation arrays');
        const annotations: Annotations = {
          tags: tags.map(entry => {
            if (!object(entry) || Object.keys(entry).some(key => !['range', 'type', 'definition'].includes(key)) || !ids.has(entry.definition) || ids.get(entry.definition) !== entry.type) throw new Error('Invalid tag reference');
            return { ...readRange(entry), definition: entry.definition, type: entry.type };
          }).sort((a, b) => a.from - b.from),
          reviews: reviews.map(entry => {
            if (!object(entry) || Object.keys(entry).some(key => !['range', 'string'].includes(key)) || typeof entry.string !== 'string') throw new Error('Invalid review');
            return { ...readRange(entry), string: entry.string };
          }).sort((a, b) => a.from - b.from)
        };
        if ('Caret Position' in settings) {
          const caret = settings['Caret Position'];
          if (!validBoundary(text, caret) || text[caret - 1] === '\r' && text[caret] === '\n') throw new Error('Invalid caret');
          annotations.caret = position(caret);
        }
        if (!validateAnnotations(annotations, normalized)) throw new Error('Invalid annotations');
        revisions.annotations = annotations;
      }
      if (!validateRevisions(revisions, normalized)) throw new Error('Invalid revision state');
      revisionEditable = true;
    } catch { revisions = emptyRevisions(); settings = null; }
  }
  return { text: normalized, original: raw, metadata, lineEnding, bom, revisions, revisionEditable, settings, settingsFormat };
}

export function validateDocumentRevisions(document: FountainDocument, text: string, revisions: unknown): revisions is Revisions {
  if (text.includes('\r') || !validateRevisions(revisions, text)) return false;
  if (document.revisions.annotations && !revisions.annotations) return false;
  const definitions = document.settings?.TagDefinitions as { id: string; type: string }[] | undefined;
  const ids = new Map((definitions ?? []).map(d => [d.id, d.type]));
  return !(revisions.annotations?.tags.some(t => ids.get(t.definition) !== t.type));
}
export function encodeDocument(document: FountainDocument, text: string, revisions: Revisions = document.revisions): string {
  if (!validateDocumentRevisions(document, text, revisions)) throw new Error('Invalid revision or annotation state');
  const same = JSON.stringify(revisions) === JSON.stringify(document.revisions);
  if (text === document.text && same) return document.original;
  if (!document.revisionEditable) throw new Error('Editing BEAT metadata is not supported yet. Create an editable copy first.');
  const body = (document.bom ? '\uFEFF' : '') + text.replace(/\r\n?|\n/g, document.lineEnding);
  if (document.metadata === null && same) return body;
  const newlines = [...text.matchAll(/\n/g)].map(match => match.index);
  const offset = (position: number) => position + (document.lineEnding.length - 1) * countBefore(newlines, position);
  const Revision = { Addition: [] as number[][], RemovalSuggestion: [] as number[][], Removed: [] };
  for (const range of revisions.ranges) Revision[range.kind].push([offset(range.from), offset(range.to) - offset(range.from), range.generation]);
  const settings: Record<string, any> = { ...document.settings, Revision, 'Revision Level': revisions.generation, 'Revision Mode': Number(revisions.enabled) };
  if (document.revisions.annotations && !revisions.annotations) throw new Error('Missing native annotation state');
  if (revisions.annotations) {
    const ids = new Map((settings.TagDefinitions ?? []).map((d: any) => [d.id, d.type]));
    if (revisions.annotations.tags.some(t => ids.get(t.definition) !== t.type)) throw new Error('Unknown tag definition');
    const range = (r: { from: number; to: number }) => [offset(r.from), offset(r.to) - offset(r.from)];
    if ('Tags' in settings || revisions.annotations.tags.length) settings.Tags = revisions.annotations.tags.map(t => ({ range: range(t), type: t.type, definition: t.definition }));
    if ('Review Ranges' in settings || revisions.annotations.reviews.length) settings['Review Ranges'] = revisions.annotations.reviews.map(r => ({ range: range(r), string: r.string }));
    if (revisions.annotations.caret !== undefined) settings['Caret Position'] = offset(revisions.annotations.caret);
  }
  if ('Text Length' in settings) settings['Text Length'] = body.length - Number(document.bom);
  const serialized = JSON.stringify(settings);
  return body + (document.settingsFormat === 'modern' ? `/** settings: ${serialized} **/` : `/* If you're seeing this, you can remove the following stuff - BEAT: ${serialized} END_BEAT */`);
}

export function editableCopy(document: FountainDocument): FountainDocument {
  return decodeDocument(document.text);
}
