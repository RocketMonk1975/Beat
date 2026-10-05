import { emptyRevisions, validateRevisions, type Revisions } from './revisions';
export { validateRevisions } from './revisions';
export interface FountainDocument {
  text: string;
  original: string;
  metadata: string | null;
  lineEnding: '\n' | '\r\n' | '\r';
  bom: boolean;
  revisions: Revisions;
  revisionEditable: boolean;
}

const markers = ["/* If you're seeing this, you can remove the following stuff - BEAT:", '/** settings:'];
function countBefore(positions: number[], offset: number): number {
  let low = 0, high = positions.length;
  while (low < high) { const middle = (low + high) >>> 1; if (positions[middle] < offset) low = middle + 1; else high = middle; }
  return low;
}

/** Metadata stays opaque until range-based editing has a compatible implementation. */
export function decodeDocument(raw: string): FountainDocument {
  const bom = raw.startsWith('\uFEFF');
  const body = bom ? raw.slice(1) : raw;
  const starts = markers.map(marker => body.indexOf(marker)).filter(position => position >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  const text = start < 0 ? body : body.slice(0, start);
  const lineEnding = body.includes('\r\n') ? '\r\n' : body.includes('\r') ? '\r' : '\n';
  const normalized = text.replace(/\r\n?|\n/g, '\n'), metadata = start < 0 ? null : body.slice(start);
  let revisions = emptyRevisions(), revisionEditable = metadata === null;
  if (metadata) {
    try {
      const match = metadata.match(/^\/\* If you're seeing this, you can remove the following stuff - BEAT:\s*(\{[\s\S]*\})\s*END_BEAT \*\/\s*$/);
      if (!match) throw new Error('Unsupported settings envelope');
      const settings = JSON.parse(match[1]);
      if (Object.keys(settings).some(key => !['Revision', 'Revision Level', 'Revision Mode'].includes(key))) throw new Error('Other metadata remains protected');
      if (!settings.Revision || Object.keys(settings.Revision).some(key => !['Addition', 'RemovalSuggestion', 'Removed'].includes(key)) || !Array.isArray(settings.Revision.Removed) || settings.Revision.Removed.length) throw new Error('Unsupported revision metadata');
      const crlf = [...text.matchAll(/\r\n/g)].map(match => match.index + 1);
      const position = (offset: number) => offset - countBefore(crlf, offset);
      const ranges = ['Addition', 'RemovalSuggestion'].flatMap(kind => {
        if (!Array.isArray(settings.Revision[kind])) throw new Error('Invalid revision ranges');
        return settings.Revision[kind].map((entry: number[]) => {
          if (!Array.isArray(entry) || entry.length !== 3 || !entry.every(Number.isInteger) || entry[0] < 0 || entry[1] <= 0 || entry[0] + entry[1] > text.length || text[entry[0] - 1] === '\r' && text[entry[0]] === '\n' || text[entry[0] + entry[1] - 1] === '\r' && text[entry[0] + entry[1]] === '\n') throw new Error('Invalid native revision range');
          return { from: position(entry[0]), to: position(entry[0] + entry[1]), generation: entry[2], kind: kind as 'Addition' | 'RemovalSuggestion' };
        });
      }).sort((a, b) => a.from - b.from);
      const mode = settings['Revision Mode'] ?? false;
      if (![false, true, 0, 1].includes(mode)) throw new Error('Invalid revision mode');
      revisions = { enabled: Boolean(mode), generation: settings['Revision Level'] ?? 0, ranges };
      if (!validateRevisions(revisions, normalized)) throw new Error('Invalid revision state');
      revisionEditable = true;
    } catch { revisions = emptyRevisions(); }
  }
  return { text: normalized, original: raw, metadata, lineEnding, bom, revisions, revisionEditable };
}

export function encodeDocument(document: FountainDocument, text: string, revisions: Revisions = document.revisions): string {
  if (!validateRevisions(revisions, text)) throw new Error('Invalid revision state');
  const same = JSON.stringify(revisions) === JSON.stringify(document.revisions);
  if (text === document.text && same) return document.original;
  if (!document.revisionEditable) throw new Error('Editing BEAT metadata is not supported yet. Create an editable copy first.');
  const body = (document.bom ? '\uFEFF' : '') + text.replace(/\r\n?|\n/g, document.lineEnding);
  if (document.metadata === null && same) return body;
  const newlines = [...text.matchAll(/\n/g)].map(match => match.index);
  const offset = (position: number) => position + (document.lineEnding.length - 1) * countBefore(newlines, position);
  const Revision = { Addition: [] as number[][], RemovalSuggestion: [] as number[][], Removed: [] };
  for (const range of revisions.ranges) Revision[range.kind].push([offset(range.from), offset(range.to) - offset(range.from), range.generation]);
  return body + `/* If you're seeing this, you can remove the following stuff - BEAT: ${JSON.stringify({ Revision, 'Revision Level': revisions.generation, 'Revision Mode': Number(revisions.enabled) })} END_BEAT */`;
}

export function editableCopy(document: FountainDocument): FountainDocument {
  return decodeDocument(document.text);
}
