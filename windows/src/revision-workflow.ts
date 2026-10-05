import { ChangeSet, type EditorState } from '@codemirror/state';
import { mapAnnotations } from './annotations';
import { mapHeadingIdentities } from './headings';
import { markRevision, type Revisions } from './revisions';

/** Accept additions / remove suggested text; reject additions / keep suggested text. */
export function resolveRevisions(state: EditorState, value: Revisions, from: number, to: number, accept: boolean) {
  const affected = value.ranges.filter(r => r.from < to && r.to > from);
  const changes = ChangeSet.of(affected.filter(r => accept ? r.kind === 'RemovalSuggestion' : r.kind === 'Addition').map(r => ({ from: Math.max(from, r.from), to: Math.min(to, r.to), insert: '' })), state.doc.length);
  const cleared = markRevision(value, from, to, null), tr = state.update({ changes });
  const next: Revisions = {
    ...cleared,
    ranges: cleared.ranges.flatMap(r => { const start = changes.mapPos(r.from, 1), end = changes.mapPos(r.to, -1); return end > start ? [{ ...r, from: start, to: end }] : []; }),
    ...(cleared.annotations ? { annotations: mapAnnotations(cleared.annotations, changes) } : {}),
    ...(cleared.headings ? { headings: mapHeadingIdentities(cleared.headings, tr) } : {})
  };
  return { changes, revisions: next, count: affected.length };
}
