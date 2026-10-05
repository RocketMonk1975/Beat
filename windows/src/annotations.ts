import type { ChangeDesc } from '@codemirror/state';

export interface TagRange { from: number; to: number; definition: string; type: string }
export interface ReviewRange { from: number; to: number; string: string }
export interface Annotations { tags: TagRange[]; reviews: ReviewRange[]; caret?: number }
export const tagTypes = ['cast', 'prop', 'vfx', 'sfx', 'camera', 'animal', 'extras', 'vehicle', 'costume', 'makeup', 'music', 'sound', 'stunt', 'setDesign', 'other'];
export function validBoundary(text: string, position: number): boolean {
  return Number.isInteger(position) && position >= 0 && position <= text.length && !(position > 0 && position < text.length && /[\uD800-\uDBFF]/.test(text[position - 1]) && /[\uDC00-\uDFFF]/.test(text[position]));
}
export function validateAnnotations(value: unknown, text: string): value is Annotations {
  const v = value as Annotations;
  const ranges = (entries: (TagRange | ReviewRange)[]) => Array.isArray(entries) && entries.length <= 100000 && entries.every((r, i) => !!r && validBoundary(text, r.from) && validBoundary(text, r.to) && r.to > r.from && (!i || entries[i - 1].to <= r.from));
  return !!v && ranges(v.tags) && ranges(v.reviews) && v.tags.every(r => typeof r.definition === 'string' && !!r.definition && tagTypes.includes(r.type)) && v.reviews.every(r => typeof r.string === 'string') && (v.caret === undefined || validBoundary(text, v.caret));
}
export function mapAnnotations(value: Annotations, changes: ChangeDesc): Annotations {
  const map = <T extends { from: number; to: number }>(entries: T[]): T[] => entries.flatMap(r => {
    const from = changes.mapPos(r.from, 1), to = changes.mapPos(r.to, -1);
    return to > from ? [{ ...r, from, to }] : [];
  });
  return { tags: map(value.tags), reviews: map(value.reviews), ...(value.caret === undefined ? {} : { caret: changes.mapPos(value.caret, 1) }) };
}
