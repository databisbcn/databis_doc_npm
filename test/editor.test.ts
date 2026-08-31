import assert from 'node:assert/strict';
import test, { before } from 'node:test';

import { installDom } from './dom.js';
import type { TiptapDocument } from '../src/types.js';

let createArticleEditor: typeof import('../src/editor.js').createArticleEditor;

before(async () => {
  installDom();
  ({ createArticleEditor } = await import('../src/editor.js'));
});

function paragraph(text: string): TiptapDocument {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
  };
}

function mountPoint(): HTMLDivElement {
  const mount = document.createElement('div');
  document.body.append(mount);
  return mount;
}

/**
 * Drives the toolbar's hidden file input the way a real pick would.
 *
 * JSDOM will not let a test populate `files`, so it is stubbed before the
 * change event. The handler is async and nothing awaits it, hence the tick.
 */
async function pickImage(mount: HTMLElement, name: string): Promise<void> {
  const picker = mount.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File(['binary'], name, { type: 'image/webp' });

  Object.defineProperty(picker, 'files', { value: [file], configurable: true });
  picker.dispatchEvent(new Event('change'));

  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('it mounts a toolbar and an editable surface', () => {
  const mount = mountPoint();
  const instance = createArticleEditor({ mount, content: paragraph('Hello') });

  assert.ok(mount.querySelector('.docs-module__toolbar'));
  assert.ok(mount.querySelector('.docs-module__editable'));
  assert.ok(mount.querySelectorAll('[data-editor-action]').length > 10);

  instance.destroy();
});

test('it round-trips a document without touching the JSON', () => {
  const mount = mountPoint();
  const content = paragraph('Round trip');
  const instance = createArticleEditor({ mount, content });

  assert.deepEqual(instance.getJSON(), content);

  instance.destroy();
});

test('destroy tears the ProseMirror view down', () => {
  // A view that outlives its host keeps the whole document alive, and custom
  // elements are removed from the DOM at arbitrary times.
  const mount = mountPoint();
  const instance = createArticleEditor({ mount, content: paragraph('Bye') });

  instance.destroy();

  assert.equal(instance.editor.isDestroyed, true);
});

test('onUpdate fires when the document changes', () => {
  const mount = mountPoint();
  let updates = 0;
  const instance = createArticleEditor({
    mount,
    content: paragraph('Before'),
    onUpdate: () => { updates += 1; }
  });

  instance.editor.commands.insertContent(' and after');

  assert.equal(updates, 1);

  instance.destroy();
});

test('uploaded images are stored by path, not by absolute URL', async () => {
  // Storing the internal path is what lets content survive a change of domain
  // or storage disk, matching how the backend stores it.
  const mount = mountPoint();
  const instance = createArticleEditor({
    mount,
    content: paragraph('Body'),
    storageBaseURL: 'https://cdn.example.test',
    uploadImage: async () => ({
      id: 1,
      path: 'docs-images/2026/07/a.webp',
      url: 'https://cdn.example.test/storage/docs-images/2026/07/a.webp'
    })
  });

  await pickImage(mount, 'a.webp');

  const image = instance.getJSON().content?.find((node) => node.type === 'image');

  assert.equal(image?.attrs?.src, 'docs-images/2026/07/a.webp');

  instance.destroy();
});

test('an uploaded image displays under /storage without any host configuration', async () => {
  // The regression this guards: with no storageBaseURL the bare path used to
  // resolve against the current page, so an article opened at
  // /view-admin/sistema/users requested /view-admin/sistema/users/docs-images/…
  const mount = mountPoint();
  const instance = createArticleEditor({
    mount,
    content: paragraph('Body'),
    uploadImage: async () => ({ id: 1, path: 'docs-images/2026/07/a.webp', url: null })
  });

  await pickImage(mount, 'a.webp');

  const rendered = mount.querySelector<HTMLImageElement>('.docs-module__editable img');

  assert.ok(rendered);
  assert.equal(rendered.getAttribute('src'), '/storage/docs-images/2026/07/a.webp');

  instance.destroy();
});

test('images render against storageBaseURL when only the path is stored', () => {
  // Without this the editor would show a broken image for everything you
  // insert, because a bare path resolves against the page, not the storage.
  const mount = mountPoint();
  const instance = createArticleEditor({
    mount,
    content: {
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'docs-images/2026/07/a.webp', alt: '' } }]
    },
    storageBaseURL: 'https://cdn.example.test'
  });

  const rendered = mount.querySelector<HTMLImageElement>('.docs-module__editable img');

  assert.ok(rendered);
  assert.equal(rendered.getAttribute('src'), 'https://cdn.example.test/docs-images/2026/07/a.webp');

  instance.destroy();
});

test('a link mark survives with an allowed scheme', () => {
  const mount = mountPoint();
  const instance = createArticleEditor({ mount, content: paragraph('Docs') });

  instance.editor.chain().selectAll().setLink({ href: 'https://example.test/docs' }).run();

  const text = instance.getJSON().content?.[0]?.content?.[0];

  assert.equal(text?.marks?.[0]?.type, 'link');
  assert.equal(text?.marks?.[0]?.attrs?.href, 'https://example.test/docs');

  instance.destroy();
});

test('tables can be inserted', () => {
  const mount = mountPoint();
  const instance = createArticleEditor({ mount, content: paragraph('Body') });

  instance.editor.chain().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();

  const table = instance.getJSON().content?.find((node) => node.type === 'table');

  assert.ok(table, 'The editor should be able to produce a table node.');
  assert.equal(table.content?.[0]?.content?.[0]?.type, 'tableHeader');

  instance.destroy();
});

/** Clicks a toolbar button the way a user would, through the delegated handler. */
function clickAction(mount: HTMLElement, action: string): void {
  const button = mount.querySelector<HTMLButtonElement>(`[data-editor-action="${action}"]`)!;
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function tableOf(instance: { getJSON: () => TiptapDocument }) {
  return instance.getJSON().content?.find((node) => node.type === 'table');
}

test('the table toolbar only appears with the caret inside a table', () => {
  const mount = mountPoint();
  const instance = createArticleEditor({ mount, content: paragraph('Body') });
  const tableToolbar = mount.querySelector<HTMLElement>('.docs-module__toolbar--table')!;

  assert.equal(tableToolbar.hidden, true, 'Prose should not carry a row of table controls.');

  clickAction(mount, 'table');

  assert.equal(tableToolbar.hidden, false);

  instance.destroy();
});

test('rows and columns can be added and removed from the toolbar', () => {
  // The whole point of the contextual row: before it, the only way to reshape
  // a table was through undocumented keyboard shortcuts.
  const mount = mountPoint();
  const instance = createArticleEditor({ mount, content: paragraph('Body') });

  clickAction(mount, 'table');

  const rows = () => tableOf(instance)?.content?.length;
  const columns = () => tableOf(instance)?.content?.[0]?.content?.length;

  assert.equal(rows(), 3);
  assert.equal(columns(), 3);

  clickAction(mount, 'addRowAfter');
  clickAction(mount, 'addColumnAfter');

  assert.equal(rows(), 4);
  assert.equal(columns(), 4);

  clickAction(mount, 'deleteRow');
  clickAction(mount, 'deleteColumn');

  assert.equal(rows(), 3);
  assert.equal(columns(), 3);

  instance.destroy();
});

test('the header row can be toggled off and back on', () => {
  const mount = mountPoint();
  const instance = createArticleEditor({ mount, content: paragraph('Body') });

  clickAction(mount, 'table');

  const firstCellType = () => tableOf(instance)?.content?.[0]?.content?.[0]?.type;

  assert.equal(firstCellType(), 'tableHeader');

  clickAction(mount, 'toggleHeaderRow');

  assert.equal(firstCellType(), 'tableCell');

  clickAction(mount, 'toggleHeaderRow');

  assert.equal(firstCellType(), 'tableHeader');

  instance.destroy();
});

test('table controls are disabled while the caret is outside a table', () => {
  // A button that looks available but does nothing is indistinguishable from
  // a broken one.
  const mount = mountPoint();
  const instance = createArticleEditor({ mount, content: paragraph('Body') });
  const deleteTable = mount.querySelector<HTMLButtonElement>('[data-editor-action="deleteTable"]')!;

  assert.equal(deleteTable.disabled, true);

  clickAction(mount, 'table');

  assert.equal(deleteTable.disabled, false);

  clickAction(mount, 'deleteTable');

  assert.equal(tableOf(instance), undefined);
  assert.equal(deleteTable.disabled, true);

  instance.destroy();
});
