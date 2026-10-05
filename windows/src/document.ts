export interface FountainDocument {
  text: string;
  original: string;
  metadata: string | null;
  lineEnding: '\n' | '\r\n' | '\r';
  bom: boolean;
}

const markers = ["/* If you're seeing this, you can remove the following stuff - BEAT:", '/** settings:'];

/** Metadata stays opaque until range-based editing has a compatible implementation. */
export function decodeDocument(raw: string): FountainDocument {
  const bom = raw.startsWith('\uFEFF');
  const body = bom ? raw.slice(1) : raw;
  const starts = markers.map(marker => body.indexOf(marker)).filter(position => position >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  const text = start < 0 ? body : body.slice(0, start);
  const lineEnding = body.includes('\r\n') ? '\r\n' : body.includes('\r') ? '\r' : '\n';
  return { text: text.replace(/\r\n?|\n/g, '\n'), original: raw, metadata: start < 0 ? null : body.slice(start), lineEnding, bom };
}

export function encodeDocument(document: FountainDocument, text: string): string {
  if (text === document.text) return document.original;
  if (document.metadata !== null) throw new Error('Editing BEAT metadata is not supported yet. Create an editable copy first.');
  return (document.bom ? '\uFEFF' : '') + text.replace(/\r\n?|\n/g, document.lineEnding);
}

export function editableCopy(document: FountainDocument): FountainDocument {
  return decodeDocument(document.text);
}
