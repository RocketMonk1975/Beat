import { parseFountain } from './fountain';

export class AutomationError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export interface AutomatedDocument { id: string; revision: number; name: string; path: string | null; text: string; dirty: boolean; readOnly: boolean; }
export interface TextEdit { from: number; to: number; insert: string; expectedText: string; }
export function checkDocument(document: AutomatedDocument, params: { documentId?: unknown; revision?: unknown }) {
  if (params.documentId !== document.id || params.revision !== document.revision) throw new AutomationError('CONFLICT', 'The document changed. Read it again and retry with its current documentId and revision.', 409);
}
export function checkPosition(text: string, position: unknown): asserts position is number {
  if (!Number.isInteger(position) || (position as number) < 0 || (position as number) > text.length) throw new AutomationError('INVALID_RANGE', 'Offsets must be integers within the document, measured in UTF-16 code units.');
  const offset = position as number;
  if (offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset])) throw new AutomationError('INVALID_RANGE', 'A text range cannot split a Unicode surrogate pair.');
}
export function validateEdits(text: string, input: unknown): TextEdit[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 1000) throw new AutomationError('INVALID_EDITS', 'Provide between 1 and 1000 non-overlapping edits.');
  const edits = input.map(edit => {
    if (!edit || typeof edit !== 'object') throw new AutomationError('INVALID_EDITS', 'Each edit must be an object.');
    checkPosition(text, edit.from); checkPosition(text, edit.to);
    if (edit.to < edit.from || typeof edit.insert !== 'string' || typeof edit.expectedText !== 'string') throw new AutomationError('INVALID_EDITS', 'Each edit needs from, to, insert, and expectedText.');
    if (text.slice(edit.from, edit.to) !== edit.expectedText) throw new AutomationError('CONFLICT', 'The expected text does not match. Read the current document before editing.', 409);
    return { from: edit.from, to: edit.to, insert: edit.insert.replace(/\r\n?/g, '\n'), expectedText: edit.expectedText };
  }).sort((a, b) => a.from - b.from || a.to - b.to);
  for (let i = 1; i < edits.length; i++) if (edits[i].from < edits[i - 1].to || edits[i].from === edits[i - 1].from) throw new AutomationError('INVALID_EDITS', 'Edit ranges cannot overlap or share an insertion position.');
  const size = edits.reduce((length, edit) => length + edit.insert.length - (edit.to - edit.from), text.length);
  if (size > 20 * 1024 * 1024) throw new AutomationError('TOO_LARGE', 'The edited script would exceed the 20 MB prototype limit.', 413);
  return edits;
}
export function summary(document: AutomatedDocument) {
  const parsed = parseFountain(document.text);
  const { text, ...metadata } = document;
  return { ...metadata, documentId: document.id, length: text.length, lineCount: parsed.lines.length, words: parsed.words, sceneCount: parsed.outline.filter(item => item.type === 'scene').length, characters: parsed.characters, offsetEncoding: 'UTF-16' };
}
export function documentSlice(document: AutomatedDocument, params: { startLine?: unknown; endLine?: unknown }) {
  const lines = document.text.split('\n');
  const start = params.startLine ?? 1, end = params.endLine ?? Math.min(lines.length, (start as number) + 299);
  if (!Number.isInteger(start) || !Number.isInteger(end) || (start as number) < 1 || (end as number) < (start as number) || (start as number) > lines.length || (end as number) > lines.length || (end as number) - (start as number) >= 500) throw new AutomationError('INVALID_RANGE', 'Request a valid line range of at most 500 lines.');
  let from = 0;
  for (let i = 0; i < (start as number) - 1; i++) from += lines[i].length + 1;
  const requested = lines.slice((start as number) - 1, end as number).join('\n');
  let length = Math.min(requested.length, 50000);
  if (length > 0 && /[\uD800-\uDBFF]/.test(requested[length - 1]) && /[\uDC00-\uDFFF]/.test(requested[length] ?? '')) length--;
  return { ...summary(document), startLine: start, endLine: end, from, to: from + length, text: requested.slice(0, length), truncated: length < requested.length || (end as number) < lines.length };
}
export function findText(text: string, query: unknown, caseSensitive = true) {
  if (typeof query !== 'string' || !query || query.length > 10000) throw new AutomationError('INVALID_QUERY', 'Search text must contain between 1 and 10000 characters.');
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'gu' : 'giu');
  const matches: { from: number; to: number; text: string; line: number }[] = [];
  let count = 0, line = 1, scanned = 0;
  for (const match of text.matchAll(expression)) {
    count++;
    if (matches.length < 1000) {
      while (scanned < match.index!) if (text[scanned++] === '\n') line++;
      matches.push({ from: match.index!, to: match.index! + match[0].length, text: match[0], line });
    }
  }
  return { count, matches, truncated: count > matches.length };
}
export function outline(document: AutomatedDocument, query?: unknown) {
  if (query !== undefined && typeof query !== 'string') throw new AutomationError('INVALID_QUERY', 'Outline query must be a string.');
  const items = parseFountain(document.text).outline;
  const filtered = query ? items.filter(item => `${item.title} ${item.synopsis}`.toLowerCase().includes((query as string).toLowerCase())) : items;
  return { documentId: document.id, revision: document.revision, items: filtered.slice(0, 1000), total: filtered.length, truncated: filtered.length > 1000 };
}
