import { parseFountain } from './fountain';
export interface CharacterMatch { from: number; to: number; names: string[]; }
export function characterSuggestions(text: string, position: number, explicit = false, existingNames?: string[]): CharacterMatch | null {
  if (!Number.isInteger(position) || position < 0 || position > text.length) return null;
  const start = position === 0 ? 0 : text.lastIndexOf('\n', position - 1) + 1, endAt = text.indexOf('\n', position), end = endAt < 0 ? text.length : endAt;
  const prefix = text.slice(start, position), line = text.slice(start, end);
  const previousStart = text.lastIndexOf('\n', start - 2) + 1;
  if (start > 0 && text.slice(previousStart, start - 1).trim()) return null;
  const match = prefix.match(/^([ \t]*[@＠]?)([\p{L}\p{N} .'-]*)$/u);
  if (!match || (!explicit && !match[2].trim()) || /^\s*[.!#=>~\\]/.test(line)) return null;
  const forced = /[@＠]/.test(match[1]), query = match[2];
  if (!forced && query !== query.toUpperCase()) return null;
  // Replace the complete name when the caret is inside it; preserve extensions and dual marker.
  const suffix = text.slice(position, end), tail = suffix.match(/^[\p{L}\p{N} .'-]*/u)?.[0] ?? '';
  const nameEnd = position + tail.trimEnd().length;
  if (suffix.slice(tail.length).trim() && !/^[\s]*(?:\([^\n]*|\^\s*$)/.test(suffix.slice(tail.length))) return null;
  const names = (existingNames ?? parseFountain(text).characters).filter(name => name.toUpperCase().startsWith(query.trim().toUpperCase()) && name.toUpperCase() !== text.slice(start + match[1].length, nameEnd).trim().toUpperCase()).slice(0, 12);
  return names.length ? { from: start + match[1].length, to: nameEnd, names } : null;
}
export function sceneMove(text: string, sceneFrom: number, direction: -1 | 1) {
  const outline = parseFountain(text).outline, index = outline.findIndex(item => item.from === sceneFrom && item.type === 'scene');
  if (index < 0) throw new Error('The selected scene changed. Select it again.');
  const neighbor = outline[index + direction];
  if (!neighbor || neighbor.type !== 'scene') throw new Error('Scenes can move within their section. Choose an adjacent scene in the same section.');
  const firstIndex = direction < 0 ? index - 1 : index;
  const from = outline[firstIndex].from, middle = outline[firstIndex + 1].from, to = outline[firstIndex + 2]?.from ?? text.length;
  const first = text.slice(from, middle), second = text.slice(middle, to);
  // An EOF scene may lack the separator needed when it is moved before another heading.
  const separator = second.endsWith('\n\n') ? '' : second.endsWith('\n') ? '\n' : '\n\n';
  return { from, middle, to, separator: separator.length, insert: second + separator + first, expectedText: text.slice(from, to), anchor: direction < 0 ? from : from + second.length + separator.length };
}
