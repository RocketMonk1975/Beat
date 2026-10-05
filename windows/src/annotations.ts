import type { ChangeDesc } from '@codemirror/state';

export interface TagRange { from: number; to: number; definition: string; type: string }
export interface ReviewRange { from: number; to: number; string: string }
export interface Annotations { tags: TagRange[]; reviews: ReviewRange[]; caret?: number }
export interface TagDefinition { id: string; name: string; type: string }
export const tagTypes = ['cast', 'prop', 'vfx', 'sfx', 'camera', 'animal', 'extras', 'vehicle', 'costume', 'makeup', 'music', 'sound', 'stunt', 'setDesign', 'other'];
export function validateDefinitions(value: unknown): value is TagDefinition[] {
  if (!Array.isArray(value) || value.length > 100000) return false;
  const ids = new Set<string>();
  return value.every(d => {
    if (!d || typeof d.id !== 'string' || !d.id || ids.has(d.id) || typeof d.name !== 'string' || !d.name.trim() || !tagTypes.includes(d.type) || Object.keys(d).some(k => !['id', 'name', 'type'].includes(k))) return false;
    ids.add(d.id); return true;
  });
}
export function replaceAnnotation<T extends { from: number; to: number }>(entries: T[], from: number, to: number, entry?: T): T[] {
  const ranges = entries.flatMap(r => r.to <= from || r.from >= to ? [r] : [...(r.from < from ? [{ ...r, to: from }] : []), ...(r.to > to ? [{ ...r, from: to }] : [])]);
  if (entry && to > from) ranges.push(entry);
  return ranges.sort((a, b) => a.from - b.from);
}
export function validBoundary(text: string, position: number): boolean {
  return Number.isInteger(position) && position >= 0 && position <= text.length && !(position > 0 && position < text.length && /[\uD800-\uDBFF]/.test(text[position - 1]) && /[\uDC00-\uDFFF]/.test(text[position]));
}
export function validateAnnotations(value: unknown, text: string): value is Annotations {
  const v = value as Annotations;
  const ranges = (entries: (TagRange | ReviewRange)[]) => Array.isArray(entries) && entries.length <= 100000 && entries.every((r, i) => !!r && validBoundary(text, r.from) && validBoundary(text, r.to) && r.to > r.from && (!i || entries[i - 1].to <= r.from));
  return !!v && Object.keys(v).every(k => ['tags', 'reviews', 'caret'].includes(k)) && ranges(v.tags) && ranges(v.reviews) && v.tags.every(r => Object.keys(r).every(k => ['from', 'to', 'definition', 'type'].includes(k)) && typeof r.definition === 'string' && !!r.definition && tagTypes.includes(r.type)) && v.reviews.every(r => Object.keys(r).every(k => ['from', 'to', 'string'].includes(k)) && typeof r.string === 'string') && (v.caret === undefined || validBoundary(text, v.caret));
}
export function mapAnnotations(value: Annotations, changes: ChangeDesc): Annotations {
  const map = <T extends { from: number; to: number }>(entries: T[]): T[] => entries.flatMap(r => {
    const from = changes.mapPos(r.from, 1), to = changes.mapPos(r.to, -1);
    return to > from ? [{ ...r, from, to }] : [];
  });
  return { tags: map(value.tags), reviews: map(value.reviews), ...(value.caret === undefined ? {} : { caret: changes.mapPos(value.caret, 1) }) };
}
