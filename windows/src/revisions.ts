import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { invertedEffects } from '@codemirror/commands';
import { Decoration, EditorView } from '@codemirror/view';
import { mapAnnotations, validateAnnotations, type Annotations } from './annotations';

export interface RevisionRange { from: number; to: number; generation: number; kind: 'Addition' | 'RemovalSuggestion' }
export interface Revisions { enabled: boolean; generation: number; ranges: RevisionRange[]; annotations?: Annotations }
export const emptyRevisions = (): Revisions => ({ enabled: false, generation: 0, ranges: [] });
export function validateRevisions(value: unknown, document: number | string): value is Revisions {
  const length = typeof document === 'number' ? document : document.length;
  const boundary = (position: number) => typeof document === 'number' || !(position > 0 && position < length && /[\uD800-\uDBFF]/.test(document[position - 1]) && /[\uDC00-\uDFFF]/.test(document[position]));
  const v = value as Revisions;
  if (v?.annotations !== undefined && (typeof document !== 'string' || !validateAnnotations(v.annotations, document))) return false;
  return !!v && typeof v.enabled === 'boolean' && Number.isInteger(v.generation) && v.generation >= 0 && v.generation < 8 && Array.isArray(v.ranges) && v.ranges.length <= 100000 && v.ranges.every(r => !!r && boundary(r.from) && boundary(r.to) && Number.isInteger(r.from) && Number.isInteger(r.to) && r.from >= 0 && r.to > r.from && r.to <= length && Number.isInteger(r.generation) && r.generation >= 0 && r.generation < 8 && ['Addition', 'RemovalSuggestion'].includes(r.kind)) && v.ranges.every((r, i) => !i || v.ranges[i - 1].to <= r.from);
}
export function markRevision(value: Revisions, from: number, to: number, kind: RevisionRange['kind'] | null): Revisions {
  const ranges = value.ranges.flatMap(r => r.to <= from || r.from >= to ? [r] : [ ...(r.from < from ? [{ ...r, to: from }] : []), ...(r.to > to ? [{ ...r, from: to }] : []) ]);
  if (kind && to > from) ranges.push({ from, to, generation: value.generation, kind });
  ranges.sort((a, b) => a.from - b.from);
  const merged: RevisionRange[] = [];
  for (const r of ranges) { const last = merged.at(-1); if (last && last.to === r.from && last.kind === r.kind && last.generation === r.generation) last.to = r.to; else merged.push({ ...r }); }
  return { ...value, ranges: merged };
}
export const setRevisions = StateEffect.define<Revisions>();
export const revisionField = StateField.define<Revisions>({
  create: emptyRevisions,
  update(value, tr) {
    // Undo/redo restores the exact pre-transaction revision state.
    const explicit = tr.effects.find(effect => effect.is(setRevisions));
    if (explicit) return explicit.value;
    if (!tr.docChanged) return value;
    let next: Revisions = { ...value, ...(value.annotations ? { annotations: mapAnnotations(value.annotations, tr.changes) } : {}), ranges: value.ranges.flatMap(r => {
      const from = tr.changes.mapPos(r.from, 1), to = tr.changes.mapPos(r.to, -1);
      return to > from ? [{ ...r, from, to }] : [];
    }) };
    if (value.enabled) tr.changes.iterChanges((_a, _b, from, to) => { if (to > from) next = markRevision(next, from, to, 'Addition'); });
    return next;
  },
  provide: field => EditorView.decorations.from(field, value => Decoration.set([
    ...value.ranges.map(r => Decoration.mark({ class: `revision-${r.kind} revision-generation-${r.generation}`, attributes: { title: `${r.kind === 'Addition' ? 'Addition' : 'Suggested removal'} · revision ${r.generation + 1}` } }).range(r.from, r.to)),
    ...(value.annotations?.tags ?? []).map(r => Decoration.mark({ class: 'native-tag', attributes: { title: `BEAT tag · ${r.type}` } }).range(r.from, r.to)),
    ...(value.annotations?.reviews ?? []).map(r => Decoration.mark({ class: 'native-review', attributes: { title: `Review: ${r.string}` } }).range(r.from, r.to))
  ], true))
});
export function revisionExtensions(initial = emptyRevisions()): Extension {
  return [revisionField.init(() => initial), invertedEffects.of(tr => tr.docChanged || tr.effects.some(effect => effect.is(setRevisions)) ? [setRevisions.of(tr.startState.field(revisionField))] : [])];
}
