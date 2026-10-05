import type { Revisions } from './revisions';
import type { sceneMove } from './writing-tools';
/** Move attached metadata with both scene blocks, splitting ranges that cross a boundary. */
export function moveSceneMetadata(value: Revisions, edit: ReturnType<typeof sceneMove>, length: number): Revisions {
  const { from, middle, to, separator } = edit;
  const pieces = [{ from: 0, to: from, delta: 0 }, { from, to: middle, delta: to - middle + separator }, { from: middle, to, delta: from - middle }, { from: to, to: length, delta: separator }];
  const map = <T extends { from: number; to: number }>(entries: T[]): T[] => entries.flatMap(r => pieces.flatMap(p => {
    const start = Math.max(p.from, r.from), end = Math.min(p.to, r.to);
    return end > start ? [{ ...r, from: start + p.delta, to: end + p.delta }] : [];
  })).sort((a, b) => a.from - b.from);
  const position = (p: number) => p < from ? p : p < middle ? p + to - middle + separator : p < to ? p + from - middle : p + separator;
  return {
    ...value, ranges: map(value.ranges),
    ...(value.headings ? { headings: value.headings.map(h => ({ ...h, from: position(h.from), to: position(h.from) + h.to - h.from })).sort((a, b) => a.from - b.from) } : {}),
    ...(value.annotations ? { annotations: { ...value.annotations, tags: map(value.annotations.tags), reviews: map(value.annotations.reviews), ...(value.annotations.caret === undefined ? {} : { caret: position(value.annotations.caret) }) } } : {})
  };
}
