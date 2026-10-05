import { formattedRuns, type FormattedRun, type FountainLine, type ParsedScript } from './fountain';
export type PaperSize = 'Letter' | 'A4';
export interface PrintOptions { header?: string; footer?: string; sceneNumbers?: boolean; sceneContinuations?: boolean; revisionMarks?: boolean; revisions?: { from: number; to: number; generation: number }[] }
export interface PrintRow { runs: FormattedRun[]; type: string; x: number; y: number; width: number; side?: 'left' | 'right'; generations?: number[]; sceneKey?: string; sceneNumber?: string; }
export interface PrintPage { title: boolean; rows: PrintRow[]; continued?: boolean; continues?: boolean; }
export interface PageLayout { size: PaperSize; width: number; height: number; pages: PrintPage[]; options?: Omit<PrintOptions, "revisions">; }
export type Measure = (text: string, styles: FormattedRun['styles']) => number;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
/** Widths and positions are PDF points; never split a grapheme or turn source text into HTML. */
export function wrapRuns(runs: FormattedRun[], width: number, measure: Measure): FormattedRun[][] {
  const chars = runs.flatMap(run => [...segmenter.segment(run.text)].map(part => ({ text: part.segment, styles: run.styles })));
  const rows: FormattedRun[][] = [];
  let start = 0;
  while (start < chars.length) {
    let end = start, total = 0, space = -1;
    while (end < chars.length) {
      const char = chars[end], advance = measure(char.text, char.styles);
      if (total + advance > width && end > start) break;
      total += advance; if (/\s/.test(char.text)) space = end; end++;
    }
    if (end < chars.length && space > start) end = space + 1;
    const row: FormattedRun[] = [];
    for (let i = start; i < end; i++) {
      const char = chars[i], last = row[row.length - 1];
      if (last && last.styles.join() === char.styles.join()) last.text += char.text;
      else row.push({ text: char.text, styles: [...char.styles] });
    }
    rows.push(row); start = end;
  }
  return rows.length ? rows : [[]];
}
export function paginate(script: ParsedScript, size: PaperSize, measure: Measure, options: PrintOptions = {}): PageLayout {
  const width = size === 'A4' ? 595.28 : 612, height = size === 'A4' ? 841.89 : 792;
  const textWidth = width - 180, capacity = Math.floor((height - 144) / 12);
  const layout: PageLayout = { size, width, height, pages: [], options: { header: options.header ?? "", footer: options.footer ?? "", sceneNumbers: !!options.sceneNumbers, sceneContinuations: !!options.sceneContinuations, revisionMarks: !!options.revisionMarks } };
  let page: PrintPage = { title: false, rows: [] }, used = 0;
  const nextPage = () => { if (page.rows.length) layout.pages.push(page); page = { title: false, rows: [] }; used = 0; };
  const add = (runs: FormattedRun[], type: string, x: number, row: number, rowWidth: number, side?: 'left' | 'right', generations?: number[], sceneKey?: string, sceneNumber?: string) => page.rows.push({ runs, type, x, y: 72 + row * 12, width: rowWidth, side, generations, sceneKey, sceneNumber });
  const geometry = (type: string, dual = false, right = false) => {
    if (dual) return { x: 108 + (right ? textWidth / 2 + 12 : 0), width: textWidth / 2 - 12, side: right ? 'right' as const : 'left' as const };
    if (type === 'character') return { x: 252, width: Math.max(72, textWidth - 144) };
    if (type === 'dialogue') return { x: 180, width: Math.min(252, textWidth - 72) };
    if (type === 'parenthetical') return { x: 216, width: Math.min(180, textWidth - 108) };
    return { x: 108, width: textWidth };
  };
  const scenes = new Map(script.outline.filter(o => o.type === 'scene').map(o => [o.from, o.number ?? '']));
  const sceneKeys = new Map<number, string>(); let activeScene = '';
  for (const line of script.lines) { if (line.type === 'scene') activeScene = String(line.from); sceneKeys.set(line.number, activeScene); }
  const rowsFor = (line: FountainLine, dual = false, right = false) => {
    const geo = geometry(line.type, dual, right);
    const generations = options.revisionMarks ? [...new Set((options.revisions ?? []).filter(r => r.from < line.to && r.to > line.from).map(r => r.generation))] : [];
    return wrapRuns(formattedRuns(line), geo.width, measure).map((runs, i) => ({ runs, type: line.type, ...geo, generations, sceneKey: sceneKeys.get(line.number), sceneNumber: line.type === 'scene' && i === 0 ? scenes.get(line.from) : undefined }));
  };
  const cueText = (line: FountainLine) => formattedRuns(line).map(run => run.text).join('').trim();
  const continued = (cue: FountainLine, dual = false, right = false) => {
    const geo = geometry('character', dual, right);
    return wrapRuns([{ text: cueText(cue) + " (CONT'D)", styles: [] }], geo.width, measure).slice(0, 2).map(runs => ({ runs, type: 'character' as const, ...geo, generations: [] as number[], sceneKey: sceneKeys.get(cue.number), sceneNumber: undefined }));
  };
  const titles = script.lines.filter(line => line.type === 'title');
  if (titles.length) {
    const titlePage: PrintPage = { title: true, rows: [] };
    let row = 18, field = '';
    for (const line of titles) {
      const runs = formattedRuns(line).map(run => ({ ...run }));
      const first = runs[0];
      if (first) { const match = first.text.match(/^\s*([^:]+):\s*/); if (match) { field = match[1].toLowerCase(); first.text = first.text.slice(match[0].length); } }
      if (['contact', 'copyright', 'draft date', 'date'].includes(field)) row = Math.max(row, capacity - 10);
      for (const content of wrapRuns(runs, textWidth, measure)) {
        if (row >= capacity) { layout.pages.push({ title: true, rows: titlePage.rows }); row = 0; titlePage.rows = []; }
        titlePage.rows.push({ runs: content, type: ['contact', 'copyright', 'draft date', 'date'].includes(field) ? 'action' : 'title', x: 108, y: 72 + row++ * 12, width: textWidth });
      }
    }
    if (titlePage.rows.length) layout.pages.push(titlePage);
  }
  const pairs = new Map(script.dualDialogue.map(pair => [pair.leftStart, pair]));
  for (let i = 0; i < script.lines.length; i++) {
    const line = script.lines[i];
    if (['title', 'note', 'boneyard', 'section', 'synopsis'].includes(line.type)) continue;
    if (line.type === 'empty') { if (used && used < capacity) used++; continue; }
    if (line.type === 'page-break') { nextPage(); continue; }
    const pair = pairs.get(i);
    if (line.type === 'character') {
      let end = i + 1;
      while (end < script.lines.length && ['dialogue', 'parenthetical'].includes(script.lines[end].type)) end++;
      const columns = pair ? [script.lines.slice(pair.leftStart, pair.leftEnd + 1), script.lines.slice(pair.rightStart, pair.rightEnd + 1)] : [script.lines.slice(i, end)];
      const pending = columns.map((column, index) => column.flatMap(source => rowsFor(source, !!pair, index === 1)));
      if (capacity - used < Math.min(capacity, Math.max(...pending.map(rows => Math.min(rows.length, 4))))) nextPage();
      while (pending.some(rows => rows.length)) {
        const available = capacity - used, continuing = pending.some(rows => rows.length > available);
        const take = continuing ? available - 1 : available;
        if (take < 2) { nextPage(); continue; }
        let advance = 0;
        for (let column = 0; column < pending.length; column++) {
          const rows = pending[column], count = Math.min(take, rows.length);
          // Avoid leaving a parenthetical stranded above a page boundary.
          let actual = count;
          if (actual > 1 && rows.length > actual && rows[actual - 1].type === 'parenthetical') actual--;
          for (let j = 0; j < actual; j++) { const row = rows.shift()!; add(row.runs, row.type, row.x, used + j, row.width, row.side, row.generations, row.sceneKey, row.sceneNumber); }
          advance = Math.max(advance, actual);
          if (rows.length) {
            const geo = geometry('character', !!pair, column === 1);
            add([{ text: '(MORE)', styles: [] }], 'character', geo.x, used + take, geo.width, geo.side, [], sceneKeys.get(columns[column][0].number));
            rows.unshift(...continued(columns[column][0], !!pair, column === 1));
          }
        }
        used += advance;
        if (pending.some(rows => rows.length)) nextPage();
      }
      i = pair ? pair.rightEnd : end - 1; continue;
    }
    const rows = rowsFor(line);
    // Keep a heading with at least two rows of the following content.
    if (line.type === 'scene' && used) {
      let following = i + 1, spacing = 0;
      while (following < script.lines.length && ['empty', 'note', 'boneyard', 'section', 'synopsis'].includes(script.lines[following].type)) {
        if (script.lines[following].type === 'empty') spacing++; following++;
      }
      const required = rows.length + Math.min(spacing, 1) + (following < script.lines.length ? Math.min(2, rowsFor(script.lines[following]).length) : 0);
      if (capacity - used < required) nextPage();
    }
    for (let j = 0; j < rows.length; j++) {
      if (used >= capacity || j === 0 && rows.length > 1 && capacity - used < 2) nextPage();
      const row = rows[j]; add(row.runs, row.type, row.x, used++, row.width, row.side, row.generations, row.sceneKey, row.sceneNumber);
    }
  }
  if (page.rows.length || !layout.pages.length) layout.pages.push(page);
  if (options.sceneContinuations) {
    for (let i = 1; i < layout.pages.length; i++) {
      const previous = layout.pages[i - 1], next = layout.pages[i];
      if (!previous.title && !next.title && previous.rows.at(-1)?.sceneKey && previous.rows.at(-1)?.sceneKey === next.rows[0]?.sceneKey) { previous.continues = true; next.continued = true; }
    }
  }
  return layout;
}
export function printHTML(layout: PageLayout): string {
  if (!layout || !['Letter', 'A4'].includes(layout.size) || !Array.isArray(layout.pages) || layout.pages.length > 5000) throw new Error('Invalid print layout.');
  const escape = (text: string) => text.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[value]!));
  const options = layout.options ?? {};
  for (const value of [options.header, options.footer]) if (value !== undefined && (typeof value !== 'string' || value.length > 200)) throw new Error('Invalid print header/footer');
  const markers = ['*', '**', '+', '++', '@', '@@', '#', '##'];
  let number = 0;
  const pages = layout.pages.map(page => {
    if (!Array.isArray(page.rows) || page.rows.length > 1000) throw new Error('Invalid print page.');
    const rows = page.rows.map(row => {
      if (![row.x, row.y, row.width].every(value => Number.isFinite(value) && value >= 0 && value <= 1000) || !Array.isArray(row.runs)) throw new Error('Invalid print row.');
      const content = row.runs.map(run => { if (typeof run.text !== 'string' || !Array.isArray(run.styles)) throw new Error('Invalid print text.'); return `<span class="${run.styles.filter(style => ['bold', 'italic', 'underline'].includes(style)).join(' ')}">${escape(run.text)}</span>`; }).join('');
      const align = ['centered', 'title', 'character'].includes(row.type) && page.title ? 'center' : row.type === 'centered' ? 'center' : row.type === 'transition' ? 'right' : 'left';
      const generations = row.generations ?? [];
      if (!Array.isArray(generations) || generations.length > 8 || generations.some(g => !Number.isInteger(g) || g < 0 || g > 7)) throw new Error('Invalid print revisions');
      const revision = options.revisionMarks && generations.length ? `<div class="revision-mark" style="top:${row.y}pt" aria-label="Revision ${Math.max(...generations) + 1}">${markers[Math.max(...generations)]}</div>` : '';
      const sceneNumber = options.sceneNumbers && row.sceneNumber !== undefined ? `<div class="scene-number-print" style="top:${row.y}pt">${escape(String(row.sceneNumber))}</div>` : '';
      return revision + sceneNumber + `<div class="row ${['character', 'scene', 'shot'].includes(row.type) ? 'uppercase' : ''} ${row.type === 'lyrics' ? 'italic' : ''} ${row.side === 'left' ? 'dual-left' : row.side === 'right' ? 'dual-right' : ''} ${['scene', 'shot'].includes(row.type) ? 'bold' : ''}" style="left:${row.x}pt;top:${row.y}pt;width:${row.width}pt;text-align:${align}">${content}</div>`;
      }).join('');
    const pageNumber = page.title ? '' : (++number > 1 ? `<div class="page-number">${number}.</div>` : '');
    return `<section class="screenplay-page" aria-label="${page.title ? 'Title page' : `Page ${number}`}">${pageNumber}${!page.title && options.header ? `<div class="print-header">${escape(options.header)}</div>` : ''}${!page.title && options.footer ? `<div class="print-footer">${escape(options.footer)}</div>` : ''}${page.continued ? '<div class="scene-continued">CONTINUED:</div>' : ''}${page.continues ? '<div class="scene-continues">(CONTINUED)</div>' : ''}${rows}</section>`;
  }).join('');
  const width = layout.size === 'A4' ? 595.28 : 612, height = layout.size === 'A4' ? 841.89 : 792;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src 'none'"><style>@page{size:${width}pt ${height}pt;margin:0}*{box-sizing:border-box}body{margin:0}.screenplay-page{position:relative;width:${width}pt;height:${height}pt;background:white;color:black;break-after:page;overflow:hidden;font:12pt/12pt 'Courier New',monospace}.screenplay-page:last-child{break-after:auto}.row{position:absolute;white-space:pre;height:12pt}.page-number{position:absolute;right:72pt;top:36pt}.revision-mark{position:absolute;right:48pt;width:24pt;text-align:right}.scene-number-print{position:absolute;left:54pt;width:42pt;text-align:right}.print-header{position:absolute;left:108pt;top:36pt;max-width:360pt;overflow:hidden;white-space:nowrap}.print-footer{position:absolute;left:108pt;bottom:24pt;max-width:360pt;overflow:hidden;white-space:nowrap}.scene-continued{position:absolute;left:108pt;top:54pt}.scene-continues{position:absolute;right:72pt;bottom:54pt}.uppercase{text-transform:uppercase}.bold{font-weight:bold}.italic{font-style:italic}.underline{text-decoration:underline}</style></head><body>${pages}</body></html>`;
}
