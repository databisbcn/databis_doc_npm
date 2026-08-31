import assert from 'node:assert/strict';
import test, { before } from 'node:test';

import { installDom } from './dom.js';
import type { TiptapDocument } from '../src/types.js';

let renderTiptapDocument: typeof import('../src/tiptap-renderer.js').renderTiptapDocument;

before(async () => {
  installDom();
  ({ renderTiptapDocument } = await import('../src/tiptap-renderer.js'));
});

function cell(colwidth: number[] | null, text: string): TiptapDocument {
  return {
    type: 'tableCell',
    attrs: { colspan: 1, rowspan: 1, colwidth },
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
  };
}

function table(cells: TiptapDocument[]): TiptapDocument {
  return {
    type: 'doc',
    content: [{ type: 'table', content: [{ type: 'tableRow', content: cells }] }]
  };
}

test('a table scrolls inside its own wrapper, not the article', () => {
  // A wide table used to be `display: block` so it could scroll, which makes
  // the browser throw the colgroup away.
  const { element } = renderTiptapDocument(table([cell(null, 'a')]));
  const rendered = element.querySelector('table');

  assert.equal(rendered?.parentElement?.className, 'docs-module__table-scroll');
});

test('column widths dragged in the editor survive into the article', () => {
  const { element } = renderTiptapDocument(table([cell([220], 'a'), cell([90], 'b')]));
  const columns = element.querySelectorAll('colgroup col');

  assert.equal(columns.length, 2);
  assert.equal((columns[0] as HTMLElement).style.width, '220px');
  assert.equal((columns[1] as HTMLElement).style.width, '90px');
  assert.ok(element.querySelector('table')?.classList.contains('docs-module__table--sized'));
});

test('a table nobody resized is left to size itself', () => {
  // Without this, every unsized table would get a fixed layout with zero-width
  // columns and collapse.
  const { element } = renderTiptapDocument(table([cell(null, 'a'), cell(null, 'b')]));

  assert.equal(element.querySelector('colgroup'), null);
  assert.equal(element.querySelector('table')?.className, '');
});

test('a merged cell contributes one column per column it spans', () => {
  const merged: TiptapDocument = {
    type: 'tableCell',
    attrs: { colspan: 2, rowspan: 1, colwidth: [120, 80] },
    content: [{ type: 'paragraph' }]
  };
  const { element } = renderTiptapDocument(table([merged, cell([60], 'c')]));
  const columns = element.querySelectorAll('colgroup col');

  assert.equal(columns.length, 3);
  assert.equal((columns[1] as HTMLElement).style.width, '80px');
});
