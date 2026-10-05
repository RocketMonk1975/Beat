import { formattedRuns, type FountainLine, type ParsedScript } from './fountain';
/** Build from text nodes so screenplay text can never become executable markup. */
export function renderPreview(script: ParsedScript, container: HTMLElement): void {
  const fragment = document.createDocumentFragment();
  const pairs = new Map(script.dualDialogue.map(pair => [pair.leftStart, pair]));
  const appendLine = (line: FountainLine, parent: HTMLElement | DocumentFragment) => {
    if (['note', 'boneyard', 'section', 'synopsis'].includes(line.type)) return;
    const element = document.createElement('div');
    element.className = `preview-line element-${line.type}`;
    element.dataset.from = String(line.from);
    if (line.type === 'page-break') { element.textContent = 'Page break'; element.setAttribute('role', 'separator'); }
    else for (const run of formattedRuns(line)) {
      const span = document.createElement('span'); span.textContent = run.text;
      span.className = run.styles.map(style => `inline-${style}`).join(' '); element.append(span);
    }
    parent.append(element);
  };
  for (let i = 0; i < script.lines.length; i++) {
    const pair = pairs.get(i);
    if (pair) {
      const group = document.createElement('div'); group.className = 'dual-dialogue';
      group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Simultaneous dialogue');
      for (const [side, start, end] of [['left', pair.leftStart, pair.leftEnd], ['right', pair.rightStart, pair.rightEnd]] as const) {
        const column = document.createElement('div'); column.className = `dual-column dual-${side}`;
        for (let j = start; j <= end; j++) appendLine(script.lines[j], column);
        group.append(column);
      }
      fragment.append(group); i = pair.rightEnd;
    } else appendLine(script.lines[i], fragment);
  }
  container.replaceChildren(fragment);
}
