import type { Transaction } from '@codemirror/state';
import { parseFountain } from './fountain';

export interface HeadingIdentity { from: number; to: number; string: string; uuid: string }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function headingLines(text: string) {
  const parsed = parseFountain(text);
  return parsed.outline.map(item => { const line = parsed.lines[item.line - 1]; return { from: line.from, to: line.to, string: line.text }; });
}
export function loadHeadingIdentities(text: string, entries: unknown): HeadingIdentity[] {
  if (!Array.isArray(entries) || entries.length > 100000) throw new Error('Invalid heading identifiers');
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Object.keys(entry).some(key => !['uuid', 'string'].includes(key)) || typeof entry.uuid !== 'string' || !uuidPattern.test(entry.uuid) || typeof entry.string !== 'string' || seen.has(entry.uuid.toLowerCase())) throw new Error('Invalid or duplicate heading UUID');
    seen.add(entry.uuid.toLowerCase());
  }
  const lines = headingLines(text);
  // An empty native table means the document has no persisted identities yet.
  if (entries.length && (entries.length !== lines.length || entries.some((entry, i) => entry.string.toLowerCase() !== lines[i].string.toLowerCase()))) throw new Error('Native heading identities do not match the parsed outline');
  return lines.map((line, i) => ({ ...line, uuid: entries.length ? entries[i].uuid : globalThis.crypto.randomUUID() }));
}
export function validateHeadingIdentities(text: string, value: unknown): value is HeadingIdentity[] {
  if (!Array.isArray(value) || value.length > 100000) return false;
  const lines = headingLines(text), seen = new Set<string>();
  return value.length === lines.length && value.every((h, i) => {
    if (!h || typeof h.uuid !== 'string' || !uuidPattern.test(h.uuid) || seen.has(h.uuid.toLowerCase()) || h.from !== lines[i].from || h.to !== lines[i].to || h.string !== lines[i].string) return false;
    seen.add(h.uuid.toLowerCase()); return true;
  });
}
export function mapHeadingIdentities(value: HeadingIdentity[], tr: Transaction): HeadingIdentity[] {
  const lines = headingLines(tr.newDoc.toString()), byStart = new Map(lines.map((line, i) => [line.from, i])), identities = new Map<number, string>();
  for (const old of value) {
    let destroyed = false;
    tr.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
      if (from <= old.from && to >= old.to && to > from) {
        // A direct one-line rename keeps the line's identity. Whole-scene replacement does not.
        const rename = from === old.from && to === old.to && inserted.length > 0 && inserted.lines === 1;
        if (!rename) destroyed = true;
      }
    });
    if (destroyed) continue;
    const position = tr.changes.mapPos(old.from, 1), start = tr.newDoc.lineAt(position).from, index = byStart.get(start);
    if (index !== undefined && !identities.has(index)) identities.set(index, old.uuid);
  }
  return lines.map((line, i) => ({ ...line, uuid: identities.get(i) ?? globalThis.crypto.randomUUID() }));
}
