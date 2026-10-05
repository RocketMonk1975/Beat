export type ElementType = 'empty' | 'title' | 'scene' | 'action' | 'character' | 'dialogue' | 'parenthetical' | 'transition' | 'section' | 'synopsis' | 'note' | 'boneyard' | 'centered' | 'lyrics' | 'page-break';
export interface FountainLine { number: number; from: number; to: number; text: string; type: ElementType; }
export interface OutlineItem { line: number; from: number; title: string; type: 'scene' | 'section'; depth: number; number?: string; color?: string; synopsis: string; }
export interface ParsedScript { lines: FountainLine[]; outline: OutlineItem[]; words: number; characters: string[]; }

export function parseFountain(text: string): ParsedScript {
  const rawLines = text.split('\n');
  const lines: FountainLine[] = [];
  const outline: OutlineItem[] = [];
  const characters = new Set<string>();
  let from = 0, dialogue = false, boneyard = false, note = false, title = false, titleDone = false, scenes = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i], value = raw.trim();
    const prevBlank = i === 0 || rawLines[i - 1].trim() === '';
    const next = rawLines[i + 1]?.trim() ?? '';
    let type: ElementType = 'action';
    // Ignore comments in classification while retaining the exact source in the editor.
    let visible = raw.replace(/\[\[.*?\]\]/g, '').trim();
    if (boneyard || value.startsWith('/*')) {
      type = 'boneyard'; boneyard = !value.includes('*/'); dialogue = false;
    } else if (note || value.startsWith('[[')) {
      type = 'note'; note = !value.includes(']]'); dialogue = false;
    } else if (!value) {
      type = 'empty'; dialogue = false;
      if (title) { title = false; titleDone = true; }
    } else if (!titleDone && (i === 0 || title) && /^(title|credit|author[s]?|source|draft date|date|contact|copyright|notes):/i.test(value)) {
      type = 'title'; title = true;
    } else if (title) {
      type = 'title';
    } else {
      titleDone = true;
      if (/^#{1,6}(?:\s|$)/.test(value)) type = 'section';
      else if (/^={3,}\s*$/.test(value)) type = 'page-break';
      else if (/^=(?!=)/.test(value)) type = 'synopsis';
      else if ((/^\.(?!\.)/.test(visible) && visible.length > 1) || /^(?:INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT\.?|EXT\.?|I\/E\.?|EST\.?)(?:\s|$)/i.test(visible)) type = 'scene';
      else if (/^>.*<\s*$/.test(value)) type = 'centered';
      else if (/^>/.test(value) || (prevBlank && /TO:$/.test(visible) && visible === visible.toUpperCase())) type = 'transition';
      else if (/^~/.test(value)) type = 'lyrics';
      else if (/^!/.test(value)) type = 'action';
      else if (/^@/.test(value) || (prevBlank && !!next && !/^[.!#=>~]|^(?:INT\.?|EXT\.?)(?:\s|$)/i.test(next) && /\p{L}/u.test(visible) && visible === visible.toUpperCase() && visible.length <= 80 && !/[.!?:]$/.test(visible))) type = 'character';
      else if (dialogue) type = /^\(.*\)\s*$/.test(value) ? 'parenthetical' : 'dialogue';
      if (type === 'character') {
        dialogue = true;
        characters.add(visible.replace(/^@/, '').replace(/\s*\^$/, '').replace(/\s*\([^)]*\)\s*$/, '').trim());
      } else if (type !== 'dialogue' && type !== 'parenthetical') dialogue = false;
    }
    lines.push({ number: i + 1, from, to: from + raw.length, text: raw, type });
    if (type === 'scene' || type === 'section') {
      const sceneNumber = visible.match(/\s+#([^#]+)#\s*$/)?.[1];
      const color = raw.match(/\[\[\s*COLOR\s+(red|blue|green|orange|purple|yellow|pink|cyan|gray|grey)\s*\]\]/i)?.[1]?.toLowerCase();
      outline.push({ line: i + 1, from, type, depth: type === 'section' ? value.match(/^#+/)![0].length : 0,
        title: visible.replace(/^\.(?!\.)|^#+\s*/g, '').replace(/\s+#[^#]+#\s*$/, '').trim(),
        number: type === 'scene' ? sceneNumber ?? String(++scenes) : undefined, color, synopsis: '' });
      if (type === 'scene' && sceneNumber) scenes++;
    } else if (type === 'synopsis' && outline.length) {
      const item = outline[outline.length - 1];
      item.synopsis += (item.synopsis ? ' ' : '') + value.replace(/^=\s*/, '');
    }
    from += raw.length + 1;
  }
  const printable = lines.filter(line => !['empty', 'title', 'section', 'synopsis', 'note', 'boneyard', 'page-break'].includes(line.type)).map(line => line.text.replace(/\[\[.*?\]\]/g, '')).join(' ');
  return { lines, outline, words: printable.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0, characters: [...characters].sort() };
}
