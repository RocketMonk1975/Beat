import { paginate, printHTML, type PaperSize, type PageLayout } from './pagination';
import type { ParsedScript } from './fountain';
export function browserLayout(script: ParsedScript, size: PaperSize): PageLayout {
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!;
  return paginate(script, size, (text, styles) => {
    context.font = `${styles.includes('italic') ? 'italic ' : ''}${styles.includes('bold') ? 'bold ' : ''}16px "Courier New", monospace`;
    return context.measureText(text).width * 0.75;
  });
}
export function renderPreview(script: ParsedScript, container: HTMLElement, size: PaperSize = 'Letter'): PageLayout {
  const layout = browserLayout(script, size);
  const rendered = new DOMParser().parseFromString(printHTML(layout), 'text/html');
  container.replaceChildren(...rendered.body.children);
  container.style.setProperty('--page-width', `${layout.width}pt`);
  container.style.setProperty('--page-height', `${layout.height}pt`);
  return layout;
}
