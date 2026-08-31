import type {
  RenderTiptapOptions,
  RenderTiptapResult,
  TiptapDocument,
  TiptapHeading,
  TiptapMark
} from './types.js';

interface RenderContext {
  storageBaseURL: string;
  headingIds: Map<string, number>;
  headings: TiptapHeading[];
}

const blockTags: Record<string, keyof HTMLElementTagNameMap> = {
  paragraph: 'p',
  blockquote: 'blockquote',
  bulletList: 'ul',
  orderedList: 'ol',
  listItem: 'li',
  codeBlock: 'pre',
  table: 'table',
  tableRow: 'tr',
  tableHeader: 'th',
  tableCell: 'td'
};

/**
 * A `<colgroup>` mirroring the column widths a writer dragged in the editor.
 *
 * ProseMirror stores those widths as `colwidth` on every cell of the row they
 * belong to. Without replaying them here, resizing a column would look like it
 * worked while editing and then be silently thrown away in the published
 * article — the kind of mismatch that makes people stop trusting the feature.
 */
function renderColumnGroup(table: TiptapDocument): HTMLTableColElement[] | null {
  const firstRow = (table.content || [])[0];

  if (!firstRow) {
    return null;
  }

  const columns: HTMLTableColElement[] = [];
  let sized = false;

  for (const cell of firstRow.content || []) {
    const widths = cell.attrs?.colwidth as number[] | null | undefined;
    const span = Number(cell.attrs?.colspan) || 1;

    // A merged cell carries one width per column it spans.
    for (let index = 0; index < span; index += 1) {
      const column = document.createElement('col');
      const width = Array.isArray(widths) ? Number(widths[index]) : 0;

      if (width > 0) {
        column.style.width = `${width}px`;
        sized = true;
      }

      columns.push(column);
    }
  }

  return sized ? columns : null;
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'section';
}

function getTextContent(node: TiptapDocument): string {
  if (node.type === 'text') {
    return node.text || '';
  }

  return (node.content || []).map(getTextContent).join('');
}

/**
 * Where a bare storage path is served from when the host page says nothing.
 *
 * Laravel's `storage:link` publishes the public disk under `/storage`, which
 * is what this module's uploads use. Falling back to the raw path instead
 * would resolve it against the *current page* — an article opened at
 * /view-admin/sistema/users asks for
 * /view-admin/sistema/users/docs-images/... and every image 404s.
 */
export const DEFAULT_STORAGE_BASE_URL = '/storage';

export function resolveImageUrl(
  source: string,
  storageBaseURL: string = DEFAULT_STORAGE_BASE_URL
): string {
  if (!source) {
    return '';
  }

  if (/^(?:https?:|blob:)/i.test(source)) {
    return source;
  }

  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(source)) {
    return source;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(source)) {
    return '';
  }

  // Already rooted at the origin: "/storage/docs-images/..." is a finished
  // URL and prefixing it again would produce "/storage/storage/...".
  if (source.startsWith('/')) {
    return source;
  }

  const base = (storageBaseURL || DEFAULT_STORAGE_BASE_URL).replace(/\/+$/, '');

  return `${base}/${source.replace(/^\/+/, '')}`;
}

function applyMark(element: Node, mark: TiptapMark): Node {
  const wrappers: Record<string, keyof HTMLElementTagNameMap> = {
    bold: 'strong',
    italic: 'em',
    underline: 'u',
    strike: 's',
    code: 'code'
  };

  if (wrappers[mark.type]) {
    const wrapper = document.createElement(wrappers[mark.type]);
    wrapper.append(element);
    return wrapper;
  }

  if (mark.type === 'link') {
    const link = document.createElement('a');
    const href = String(mark.attrs?.href || '');

    if (/^(https?:|mailto:|tel:|\/|#)/i.test(href)) {
      link.href = href;
    }

    if (mark.attrs?.target === '_blank') {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }

    link.append(element);
    return link;
  }

  return element;
}

function renderText(node: TiptapDocument): Node {
  let element: Node = document.createTextNode(node.text || '');

  (node.marks || []).forEach((mark) => {
    element = applyMark(element, mark);
  });

  return element;
}

function renderNode(node: TiptapDocument, context: RenderContext): Node {
  if (!node || typeof node !== 'object') {
    return document.createDocumentFragment();
  }

  if (node.type === 'text') {
    return renderText(node);
  }

  if (node.type === 'hardBreak') {
    return document.createElement('br');
  }

  if (node.type === 'horizontalRule') {
    return document.createElement('hr');
  }

  if (node.type === 'image') {
    const image = document.createElement('img');
    image.src = resolveImageUrl(
      String(node.attrs?.src || node.attrs?.path || ''),
      context.storageBaseURL
    );
    image.alt = String(node.attrs?.alt || '');
    image.loading = 'lazy';

    if (node.attrs?.title) {
      image.title = String(node.attrs.title);
    }

    return image;
  }

  let tagName: string | undefined = blockTags[node.type || ''];

  if (node.type === 'doc') {
    tagName = 'div';
  }

  if (node.type === 'heading') {
    const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 2));
    tagName = `h${level}`;
  }

  if (!tagName) {
    const unknownFragment = document.createDocumentFragment();
    (node.content || []).forEach((child) => unknownFragment.append(renderNode(child, context)));
    return unknownFragment;
  }

  const element = document.createElement(tagName);

  if (node.type === 'codeBlock') {
    const code = document.createElement('code');
    code.dataset.language = String(node.attrs?.language || '');
    (node.content || []).forEach((child) => code.append(renderNode(child, context)));
    element.append(code);
    return element;
  }

  if (node.type === 'heading') {
    const label = getTextContent(node);
    const baseId = slugify(label);
    const occurrence = context.headingIds.get(baseId) || 0;
    const id = occurrence ? `${baseId}-${occurrence + 1}` : baseId;
    context.headingIds.set(baseId, occurrence + 1);
    element.id = id;
    context.headings.push({ id, level: Number(node.attrs?.level) || 2, label });
  }

  if (node.type === 'table') {
    const columns = renderColumnGroup(node);

    if (columns) {
      const group = document.createElement('colgroup');
      group.append(...columns);
      element.append(group);
      element.classList.add('docs-module__table--sized');
    }
  }

  if (node.attrs?.colspan) {
    (element as HTMLTableCellElement).colSpan = Number(node.attrs.colspan);
  }

  if (node.attrs?.rowspan) {
    (element as HTMLTableCellElement).rowSpan = Number(node.attrs.rowspan);
  }

  (node.content || []).forEach((child) => element.append(renderNode(child, context)));

  if (node.type === 'table') {
    // A wide table has to scroll inside the article instead of pushing the
    // whole layout sideways. That scroll belongs on a wrapper, not on the
    // table: `display: block` on a table makes the browser discard the
    // <colgroup>, and with it every column width the writer set.
    const wrapper = document.createElement('div');
    wrapper.className = 'docs-module__table-scroll';
    wrapper.append(element);
    return wrapper;
  }

  return element;
}

export function renderTiptapDocument(
  documentValue: TiptapDocument,
  options: RenderTiptapOptions = {}
): RenderTiptapResult {
  const container = document.createElement('div');
  const context = {
    storageBaseURL: options.storageBaseURL || DEFAULT_STORAGE_BASE_URL,
    headingIds: new Map(),
    headings: []
  };

  container.className = options.className || 'docs-module__prose';
  container.append(renderNode(documentValue, context));

  return { element: container, headings: context.headings };
}
