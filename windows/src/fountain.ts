export type ElementType = 'empty' | 'title' | 'scene' | 'action' | 'shot' | 'character' | 'dialogue' | 'parenthetical' | 'transition' | 'section' | 'synopsis' | 'note' | 'boneyard' | 'centered' | 'lyrics' | 'page-break';
export type InlineStyle = 'bold' | 'italic' | 'underline' | 'note' | 'boneyard' | 'escape' | 'marker';
/** Absolute, half-open UTF-16 source offsets. Parsing never rewrites the source. */
export interface InlineRange { from: number; to: number; style: InlineStyle; }
export interface FountainLine { number: number; from: number; to: number; text: string; type: ElementType; inline: InlineRange[]; dualSide?: 'left' | 'right'; }
export interface OutlineItem { line: number; from: number; title: string; type: 'scene' | 'section'; depth: number; number?: string; color?: string; synopsis: string; }
export interface DualDialogue { leftStart: number; leftEnd: number; rightStart: number; rightEnd: number; }
export interface ParsedScript { lines: FountainLine[]; outline: OutlineItem[]; words: number; characters: string[]; dualDialogue: DualDialogue[]; }
export interface FormattedRun { text: string; styles: ('bold' | 'italic' | 'underline')[]; }
function escaped(text: string, at: number): boolean {
  let count = 0; while (at > 0 && text[--at] === '\\') count++; return count % 2 === 1;
}
function comments(text: string): InlineRange[] {
  const ranges: InlineRange[] = [], blanks = [...text.matchAll(/\n[ \t]*\n/g)].map(match => match.index!);
  let blankIndex = 0;
  const closing = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i++) {
    const token = text.slice(i, i + 2);
    if ((token !== '/*' && token !== '[[') || escaped(text, i)) continue;
    const close = token === '/*' ? '*/' : ']]';
    let end = closing.get(close);
    if (end === undefined || end >= 0 && end < i + 2) {
      end = text.indexOf(close, i + 2);
      while (end >= 0 && escaped(text, end)) end = text.indexOf(close, end + 2);
      closing.set(close, end);
    }
    while (blankIndex < blanks.length && blanks[blankIndex] < i) blankIndex++;
    // Beat cancels unterminated notes and note blocks crossing blank lines.
    if (token === '[[' && (end < 0 || blanks[blankIndex] < end)) continue;
    const to = end < 0 ? text.length : end + 2;
    ranges.push({ from: i, to, style: token === '/*' ? 'boneyard' : 'note' }); i = to - 1;
  }
  return ranges;
}
function inlineFormatting(raw: string, from: number, excluded: InlineRange[]): InlineRange[] {
  const ranges = [...excluded], blocked = new Uint8Array(raw.length);
  for (const range of excluded) blocked.fill(1, range.from - from, range.to - from);
  // Native Beat parses bold before italic and excludes the paired bold delimiter stars.
  for (const [delimiter, style] of [['**', 'bold'], ['*', 'italic'], ['_', 'underline']] as const) {
    let opening = -1;
    for (let i = 0; i <= raw.length - delimiter.length; i++) {
      if (!raw.startsWith(delimiter, i) || escaped(raw, i) || blocked.subarray(i, i + delimiter.length).some(Boolean)) continue;
      if (opening < 0) opening = i;
      else {
        if (i === opening + delimiter.length) { opening = -1; i += delimiter.length - 1; continue; }
        if (i > opening + delimiter.length) ranges.push({ from: from + opening + delimiter.length, to: from + i, style });
        for (const at of [opening, i]) {
          ranges.push({ from: from + at, to: from + at + delimiter.length, style: 'marker' });
          blocked.fill(1, at, at + delimiter.length);
        }
        opening = -1;
      }
      i += delimiter.length - 1;
    }
  }
  for (let i = 0; i < raw.length - 1; i++) {
    if (!blocked[i] && raw[i] === '\\' && /[\\*_\[\]@.!~>#=^]/.test(raw[i + 1])) {
      ranges.push({ from: from + i, to: from + i + 1, style: 'escape' }); i++;
    }
  }
  return ranges;
}
/** Renderable text and styles. No HTML; comments and matched control markers are omitted. */
export function formattedRuns(line: FountainLine): FormattedRun[] {
  const events = new Map<number, { style: InlineStyle; change: number }[]>();
  events.set(line.from, []); events.set(line.to, []);
  for (const range of line.inline) {
    if (range.to <= range.from) continue;
    for (const [at, change] of [[range.from, 1], [range.to, -1]]) {
      const list = events.get(at) ?? []; list.push({ style: range.style, change }); events.set(at, list);
    }
  }
  const sorted = [...events.keys()].sort((a, b) => a - b), runs: FormattedRun[] = [], active = new Map<InlineStyle, number>();
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i], to = sorted[i + 1];
    for (const event of events.get(from)!) active.set(event.style, (active.get(event.style) ?? 0) + event.change);
    if (['marker', 'escape', 'note', 'boneyard'].some(style => (active.get(style as InlineStyle) ?? 0) > 0)) continue;
    const styles = (['bold', 'italic', 'underline'] as const).filter(style => (active.get(style) ?? 0) > 0);
    runs.push({ text: line.text.slice(from - line.from, to - line.from), styles });
  }
  return runs;
}
export function parseFountain(text: string): ParsedScript {
  const rawLines = text.split('\n'), hidden = comments(text), lines: FountainLine[] = [], visibleLines: string[] = [];
  const outline: OutlineItem[] = [], dualDialogue: DualDialogue[] = [], characters = new Set<string>();
  let from = 0, commentIndex = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i], to = from + raw.length, exclusions: InlineRange[] = [];
    while (commentIndex < hidden.length && hidden[commentIndex].to <= from) commentIndex++;
    for (let j = commentIndex; j < hidden.length && hidden[j].from < to; j++) {
      const range = hidden[j]; exclusions.push({ ...range, from: Math.max(from, range.from), to: Math.min(to, range.to) });
    }
    let visible = '', cursor = from;
    for (const range of exclusions) { visible += raw.slice(cursor - from, range.from - from); cursor = range.to; }
    visible += raw.slice(cursor - from); visibleLines.push(visible);
    lines.push({ number: i + 1, from, to, text: raw, type: 'action', inline: inlineFormatting(raw, from, exclusions) }); from = to + 1;
  }
  let title = false, titleDone = false, scenes = 0, dialogue = false, cue = -1;
  let previousBlock: { start: number; end: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], raw = visibleLines[i], value = raw.trim(), next = visibleLines[i + 1]?.trim() ?? '';
    const prevBlank = i === 0 || visibleLines[i - 1].trim() === '', unindented = raw.length === raw.trimStart().length;
    const outsideParentheses = value.replace(/\([^)]*\)?/g, '');
    let type: ElementType = 'action';
    if (!value && line.inline.some(range => range.style === 'boneyard')) type = 'boneyard';
    else if (!value && line.inline.some(range => range.style === 'note')) type = 'note';
    else if (!value) type = dialogue && raw.length >= 2 ? 'dialogue' : raw.length >= 2 ? 'action' : 'empty';
    else if (value.startsWith('\\')) type = dialogue ? 'dialogue' : 'action';
    else if (unindented && /^[!！]{2}/.test(value)) type = 'shot';
    else if (unindented && /^[!！]/.test(value)) type = 'action';
    else if (/^[~～]/.test(value)) type = 'lyrics';
    else if (unindented && /^[#＃]/.test(value)) type = 'section';
    else if (/^={3,}$/.test(value)) type = 'page-break';
    else if (unindented && /^=/.test(value)) type = 'synopsis';
    else if (unindented && prevBlank && (/^[.．](?!\.)/.test(value) || /^(?:int\.?\/ext\.?|ext\.?\/int\.?|int|ext|i\/e|i\.\/e|e\/i|e\.\/i|est)[ .]/i.test(value))) type = 'scene';
    else if (/^>.*<$/.test(value)) type = 'centered';
    else if ((unindented && /^>/.test(value)) || (prevBlank && outsideParentheses === outsideParentheses.toUpperCase() && /TO:$/.test(value))) type = 'transition';
    else if (!titleDone && (title || i === 0 && /^(title|credit|authors?|source|draft date|contact|copyright|notes):/i.test(value))) { type = 'title'; title = true; }
    else if (prevBlank && (/^[@＠]/.test(value) || (!!next && value.length >= 2 && /\p{L}/u.test(outsideParentheses) && outsideParentheses === outsideParentheses.toUpperCase() && !value.startsWith('(')))) type = 'character';
    else if (dialogue) type = value.startsWith('(') ? 'parenthetical' : 'dialogue';
    else if (!titleDone && (title || i === 0 && /^[^:]+:/.test(value))) { type = 'title'; title = true; }
    if (type === 'empty') { if (title) { title = false; titleDone = true; } }
    else if (!['title', 'note', 'boneyard'].includes(type)) titleDone = true;
    line.type = type;
    // Locate structural markers in the original source, not in comment-stripped text.
    const sourceValue = value;
    let first = 0;
    while (first < line.text.length) {
      const hiddenRange = line.inline.find(range => (range.style === 'note' || range.style === 'boneyard') && range.from <= line.from + first && range.to > line.from + first);
      if (hiddenRange) first = hiddenRange.to - line.from;
      else if (/\s/.test(line.text[first])) first++;
      else break;
    }
    const start = line.from + first;
    const prefix = type === 'scene' ? sourceValue.match(/^[.．](?!\.)/) : type === 'character' ? sourceValue.match(/^[@＠]/) : type === 'shot' ? sourceValue.match(/^[!！]{2}/) : type === 'action' ? sourceValue.match(/^[!！]/) : type === 'section' ? sourceValue.match(/^[#＃]+\s*/) : type === 'synopsis' ? sourceValue.match(/^=\s*/) : type === 'lyrics' ? sourceValue.match(/^[~～]/) : type === 'transition' || type === 'centered' ? sourceValue.match(/^>/) : null;
    if (prefix) line.inline.push({ from: start, to: start + prefix[0].length, style: 'marker' });
    if (type === 'centered') { const at = line.from + line.text.lastIndexOf('<'); line.inline.push({ from: at, to: at + 1, style: 'marker' }); }
    if (type === 'character' && /\^$/.test(value)) { const at = line.from + line.text.lastIndexOf('^'); line.inline.push({ from: at, to: at + 1, style: 'marker' }); }
    if (type === 'scene') {
      const match = line.text.match(/#[^#]+#(?=\s*(?:\[\[.*?\]\]\s*)*$)/);
      if (match?.index !== undefined) line.inline.push({ from: line.from + match.index, to: line.from + match.index + match[0].length, style: 'marker' });
    }
    if (type === 'character') {
      if (/\^$/.test(value) && previousBlock && previousBlock.end < i && !lines[previousBlock.start].dualSide) {
        const pair = { leftStart: previousBlock.start, leftEnd: previousBlock.end, rightStart: i, rightEnd: i }; dualDialogue.push(pair);
        for (let j = pair.leftStart; j <= pair.leftEnd; j++) lines[j].dualSide = 'left'; line.dualSide = 'right';
      }
      cue = i; dialogue = true;
      characters.add(formattedRuns(line).map(run => run.text).join('').trim().replace(/^[@＠]/, '').replace(/\s*\^$/, '').replace(/\s*\([^)]*\)\s*$/, '').trim());
    } else if (type === 'dialogue' || type === 'parenthetical') {
      const pair = dualDialogue[dualDialogue.length - 1];
      if (pair?.rightStart === cue) { pair.rightEnd = i; line.dualSide = 'right'; }
      previousBlock = { start: cue, end: i };
    } else {
      dialogue = false; cue = -1; if (!['empty', 'note', 'boneyard'].includes(type)) previousBlock = null;
    }
    if (type === 'scene' || type === 'section') {
      const sceneNumber = value.match(/\s*#([^#]+)#\s*$/)?.[1];
      const color = line.text.match(/\[\[\s*COLOR\s+(red|blue|green|orange|purple|yellow|pink|cyan|gray|grey|#[a-f0-9]{6})\s*\]\]/i)?.[1]?.toLowerCase();
      outline.push({ line: i + 1, from: line.from, type, depth: type === 'section' ? value.match(/^[#＃]+/)![0].length : 0,
        title: formattedRuns(line).map(run => run.text).join('').replace(/\s*#[^#]+#\s*$/, '').trim(), number: type === 'scene' ? sceneNumber ?? String(scenes + 1) : undefined, color, synopsis: '' });
      if (type === 'scene') scenes++;
    } else if (type === 'synopsis' && outline.length) { const item = outline[outline.length - 1]; item.synopsis += (item.synopsis ? ' ' : '') + formattedRuns(line).map(run => run.text).join('').trim(); }
  }
  const printable = lines.filter(line => !['empty', 'title', 'section', 'synopsis', 'note', 'boneyard', 'page-break'].includes(line.type)).map(line => formattedRuns(line).map(run => run.text).join('')).join(' ');
  return { lines, outline, words: printable.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0, characters: [...characters].sort(), dualDialogue };
}
