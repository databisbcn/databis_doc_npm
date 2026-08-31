import { Editor, Extension } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';

import { allowedLinkSchemes, emptyDocument } from './schema.js';
import { resolveImageUrl } from './tiptap-renderer.js';
import type {
  ArticleEditor,
  ArticleEditorOptions,
  DocsEditorExtensions,
  DocsImageResource,
  EditorExtensionOptions,
  TiptapDocument
} from './types.js';

type EditorChain = ReturnType<Editor['chain']>;

interface UploadExtensionOptions {
  uploadImage: (file: File) => Promise<DocsImageResource>;
  onError: ((error: unknown) => void) | null;
}

interface ToolbarButtonDefinition {
  separator?: false;
  groupLabel?: false;
  action: string;
  label: string;
  title: string;
  isActive?: (editor: Editor) => boolean;
  run?: (chain: EditorChain) => EditorChain;
  prompt?: boolean;
  file?: boolean;
  /**
   * Grey the button out when its command cannot run right now — asked by
   * running the command against `editor.can()`. "Delete column" on a
   * one-column table is a no-op, and a button that looks available but does
   * nothing reads as a bug.
   */
  disableWhenUnavailable?: boolean;
}

interface ToolbarSeparatorDefinition {
  separator: true;
  groupLabel?: false;
}

/** A small caption naming the group of buttons that follows it. */
interface ToolbarGroupLabelDefinition {
  separator?: false;
  groupLabel: true;
  title: string;
}

type ToolbarDefinition =
  | ToolbarButtonDefinition
  | ToolbarSeparatorDefinition
  | ToolbarGroupLabelDefinition;

/**
 * The rich text editor.
 *
 * TipTap is the one real dependency in this package. Everything else here is
 * DOM and fetch, but a usable editing surface is not something worth
 * reimplementing: ProseMirror's schema, input rules, history and paste handling
 * are the hard parts, and getting them subtly wrong is how documents get
 * corrupted.
 *
 * The extension set is pinned to the schema the backend accepts. StarterKit v3
 * already covers everything except images and tables.
 */

/**
 * Images are stored by their internal path, not by absolute URL, so content
 * survives a change of domain or storage disk — the same reasoning that keeps
 * `path` rather than a URL in the database.
 *
 * That means the stored attribute is not directly usable as an `src`, so
 * rendering resolves it against storageBaseURL — `/storage` unless the host
 * says otherwise. The editor has to do this too, or every image would appear
 * broken while you are writing.
 */
function createImageExtension(storageBaseURL: string) {
  return Image.extend({
    renderHTML({ HTMLAttributes }) {
      return [
        'img',
        {
          ...HTMLAttributes,
          src: resolveImageUrl(HTMLAttributes.src, storageBaseURL),
          loading: 'lazy'
        }
      ];
    }
  }).configure({ inline: false, allowBase64: false });
}

/**
 * The `src` to store for a freshly uploaded image.
 *
 * The internal `path` wins over the absolute `url`: storing the URL would bake
 * today's domain into the article body. Rendering puts the storage prefix back
 * on. The URL is only a fallback for a backend that returns no path.
 */
function imageSource(image: DocsImageResource | null | undefined): string {
  return String(image?.path || image?.url || '');
}

/**
 * Uploads pasted and dropped image files, then inserts them.
 *
 * Without this, pasting a screenshot inserts a base64 data URI. The backend
 * sanitizer would reject it — `data:` is not an allowed scheme — so the image
 * would simply vanish on save, which is the kind of silent loss that makes
 * people stop trusting an editor.
 */
function createUploadExtension({ uploadImage, onError }: UploadExtensionOptions) {
  const isImage = (file: File): boolean => file.type.startsWith('image/');

  const upload = async (editor: Editor, files: File[], position?: number): Promise<void> => {
    for (const file of files) {
      try {
        const image = await uploadImage(file);
        const src = imageSource(image);

        if (!src) {
          continue;
        }

        const node = {
          type: 'image',
          attrs: { src, alt: image.alt || '' }
        };

        if (typeof position === 'number') {
          editor.chain().focus().insertContentAt(position, node).run();
        } else {
          editor.chain().focus().insertContent(node).run();
        }
      } catch (error) {
        onError?.(error);
      }
    }
  };

  return Extension.create({
    name: 'docsImageUpload',

    addProseMirrorPlugins() {
      const { editor } = this;

      // Must be a real Plugin instance — ProseMirror reads `spec` and `key`
      // off it while reconfiguring state, and a plain object throws deep
      // inside the constructor with no useful message.
      return [
        new Plugin({
          key: new PluginKey('docsImageUpload'),
          props: {
            handlePaste(view, event) {
              const files = Array.from(event.clipboardData?.files || []).filter(isImage);

              if (files.length === 0) {
                return false;
              }

              event.preventDefault();
              upload(editor, files);
              return true;
            },

            handleDrop(view, event) {
              const files = Array.from(event.dataTransfer?.files || []).filter(isImage);

              if (files.length === 0) {
                return false;
              }

              event.preventDefault();

              // Drop where the pointer is, not where the caret happens to be.
              const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
              upload(editor, files, coordinates?.pos);
              return true;
            }
          }
        })
      ];
    }
  });
}

export function createEditorExtensions(options: EditorExtensionOptions = {}): DocsEditorExtensions {
  const {
    storageBaseURL = '',
    uploadImage = null,
    onError = null
  } = options;
  const extensions: DocsEditorExtensions = [
    StarterKit.configure({
      link: {
        openOnClick: false,
        protocols: [...allowedLinkSchemes],
        HTMLAttributes: { rel: 'noopener noreferrer' }
      }
    }),
    createImageExtension(storageBaseURL),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell
  ];

  if (uploadImage) {
    extensions.push(createUploadExtension({ uploadImage, onError }));
  }

  return extensions;
}

/** Node and mark names this extension set can produce. Used by the schema test. */
export function editorSchemaNames(
  options: EditorExtensionOptions = {}
): { nodes: string[]; marks: string[] } {
  const editor = new Editor({
    extensions: createEditorExtensions(options),
    content: emptyDocument()
  });

  const names = {
    nodes: Object.keys(editor.schema.nodes),
    marks: Object.keys(editor.schema.marks)
  };

  editor.destroy();

  return names;
}

const toolbarButtons: ToolbarDefinition[] = [
  { action: 'bold', label: 'B', title: 'bold', isActive: (e) => e.isActive('bold'), run: (c) => c.toggleBold() },
  { action: 'italic', label: 'I', title: 'italic', isActive: (e) => e.isActive('italic'), run: (c) => c.toggleItalic() },
  { action: 'strike', label: 'S', title: 'strike', isActive: (e) => e.isActive('strike'), run: (c) => c.toggleStrike() },
  { action: 'code', label: '<>', title: 'inlineCode', isActive: (e) => e.isActive('code'), run: (c) => c.toggleCode() },
  { separator: true },
  { action: 'h2', label: 'H2', title: 'heading2', isActive: (e) => e.isActive('heading', { level: 2 }), run: (c) => c.toggleHeading({ level: 2 }) },
  { action: 'h3', label: 'H3', title: 'heading3', isActive: (e) => e.isActive('heading', { level: 3 }), run: (c) => c.toggleHeading({ level: 3 }) },
  { separator: true },
  { action: 'bulletList', label: '••', title: 'bulletList', isActive: (e) => e.isActive('bulletList'), run: (c) => c.toggleBulletList() },
  { action: 'orderedList', label: '1.', title: 'orderedList', isActive: (e) => e.isActive('orderedList'), run: (c) => c.toggleOrderedList() },
  { action: 'blockquote', label: '❝', title: 'blockquote', isActive: (e) => e.isActive('blockquote'), run: (c) => c.toggleBlockquote() },
  { action: 'codeBlock', label: '{ }', title: 'codeBlock', isActive: (e) => e.isActive('codeBlock'), run: (c) => c.toggleCodeBlock() },
  { separator: true },
  { action: 'link', label: '🔗', title: 'link', isActive: (e) => e.isActive('link'), prompt: true },
  { action: 'image', label: '🖼', title: 'image', file: true },
  { action: 'table', label: '▦', title: 'table', run: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }) },
  { action: 'horizontalRule', label: '—', title: 'horizontalRule', run: (c) => c.setHorizontalRule() },
  { separator: true },
  { action: 'undo', label: '↶', title: 'undo', run: (c) => c.undo() },
  { action: 'redo', label: '↷', title: 'redo', run: (c) => c.redo() }
];

/**
 * The contextual table toolbar.
 *
 * Inserting a table used to be the only thing the toolbar could do to one:
 * every other change — a fourth column, one more row, a header — meant knowing
 * ProseMirror's undocumented keyboard shortcuts or giving up and rewriting the
 * table. These are the same TipTap commands, surfaced where they are needed.
 *
 * The row is only shown while the selection is inside a table, so the main
 * toolbar keeps its length for the far more common case of writing prose.
 */
const tableToolbarButtons: ToolbarDefinition[] = [
  { groupLabel: true, title: 'tableColumns' },
  { action: 'addColumnBefore', label: '+←', title: 'addColumnBefore', run: (c) => c.addColumnBefore(), disableWhenUnavailable: true },
  { action: 'addColumnAfter', label: '+→', title: 'addColumnAfter', run: (c) => c.addColumnAfter(), disableWhenUnavailable: true },
  { action: 'deleteColumn', label: '✕', title: 'deleteColumn', run: (c) => c.deleteColumn(), disableWhenUnavailable: true },
  { separator: true },
  { groupLabel: true, title: 'tableRows' },
  { action: 'addRowBefore', label: '+↑', title: 'addRowBefore', run: (c) => c.addRowBefore(), disableWhenUnavailable: true },
  { action: 'addRowAfter', label: '+↓', title: 'addRowAfter', run: (c) => c.addRowAfter(), disableWhenUnavailable: true },
  { action: 'deleteRow', label: '✕', title: 'deleteRow', run: (c) => c.deleteRow(), disableWhenUnavailable: true },
  { separator: true },
  { groupLabel: true, title: 'tableCells' },
  // One button rather than two: TipTap picks merge or split from the
  // selection, and a "split" button is meaningless on 95% of cells.
  { action: 'mergeOrSplit', label: '⧉', title: 'mergeOrSplit', run: (c) => c.mergeOrSplit(), disableWhenUnavailable: true },
  { separator: true },
  { groupLabel: true, title: 'tableHeader' },
  { action: 'toggleHeaderRow', label: 'H—', title: 'toggleHeaderRow', run: (c) => c.toggleHeaderRow(), disableWhenUnavailable: true },
  { action: 'toggleHeaderColumn', label: 'H|', title: 'toggleHeaderColumn', run: (c) => c.toggleHeaderColumn(), disableWhenUnavailable: true },
  { separator: true },
  { action: 'deleteTable', label: '🗑', title: 'deleteTable', run: (c) => c.deleteTable(), disableWhenUnavailable: true }
];

/**
 * Mounts a full editing surface — toolbar plus editable area — into `mount`.
 *
 * Returns the TipTap editor alongside a `destroy` that also detaches the
 * toolbar listeners. Custom elements are removed from the DOM at arbitrary
 * times, and a ProseMirror view that outlives its host leaks the whole document.
 */
export function createArticleEditor(options: ArticleEditorOptions): ArticleEditor {
  const {
    mount,
    content,
    storageBaseURL = '',
    uploadImage = null,
    translate = (key: string) => key,
    onUpdate = null,
    onError = null
  } = options;
  // Both rows share one sticky container so the table controls stay pinned
  // directly under the main toolbar instead of scrolling out of reach while
  // you work down a long table.
  const toolbars = document.createElement('div');
  toolbars.className = 'docs-module__toolbars';

  const toolbar = document.createElement('div');
  toolbar.className = 'docs-module__toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', translate('formatting'));

  const tableToolbar = document.createElement('div');
  tableToolbar.className = 'docs-module__toolbar docs-module__toolbar--table';
  tableToolbar.setAttribute('role', 'toolbar');
  tableToolbar.setAttribute('aria-label', translate('tableTools'));
  tableToolbar.hidden = true;

  const surface = document.createElement('div');
  surface.className = 'docs-module__editor-surface';

  const filePicker = document.createElement('input');
  filePicker.type = 'file';
  filePicker.accept = 'image/*';
  filePicker.hidden = true;

  toolbars.append(toolbar, tableToolbar);
  mount.append(toolbars, surface, filePicker);

  const editor = new Editor({
    element: surface,
    content: content || emptyDocument(),
    extensions: createEditorExtensions({ storageBaseURL, uploadImage, onError }),
    editorProps: {
      attributes: {
        class: 'docs-module__prose docs-module__editable',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': translate('content')
      }
    },
    onUpdate: () => onUpdate?.()
  });

  const buttons = new Map<string, {
    button: HTMLButtonElement;
    definition: ToolbarButtonDefinition;
    container: HTMLElement;
  }>();

  const buildToolbar = (container: HTMLElement, definitions: ToolbarDefinition[]): void => {
    definitions.forEach((definition) => {
      if (definition.separator) {
        const separator = document.createElement('span');
        separator.className = 'docs-module__toolbar-separator';
        separator.setAttribute('aria-hidden', 'true');
        container.append(separator);
        return;
      }

      if (definition.groupLabel) {
        const label = document.createElement('span');
        label.className = 'docs-module__toolbar-group-label';
        label.textContent = translate(definition.title);
        // Decorative for a screen reader: every button already carries its own
        // full label, so reading the group caption too only adds noise.
        label.setAttribute('aria-hidden', 'true');
        container.append(label);
        return;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'docs-module__toolbar-button';
      button.dataset.editorAction = definition.action;
      button.textContent = definition.label;
      button.title = translate(definition.title);
      button.setAttribute('aria-label', translate(definition.title));
      container.append(button);
      buttons.set(definition.action, { button, definition, container });
    });
  };

  buildToolbar(toolbar, toolbarButtons);
  buildToolbar(tableToolbar, tableToolbarButtons);

  /** Whether a command would do anything, asked without touching the document. */
  const isAvailable = (definition: ToolbarButtonDefinition): boolean =>
    Boolean(definition.run?.(editor.can().chain()).run());

  const syncToolbar = () => {
    // Only shown with the caret inside a table: the controls are meaningless
    // anywhere else, and a permanent second row of buttons would crowd out the
    // prose the editor exists to write.
    const inTable = editor.isActive('table');
    tableToolbar.hidden = !inTable;

    buttons.forEach(({ button, definition, container }) => {
      if (definition.isActive) {
        const active = definition.isActive(editor);
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      }

      if (definition.disableWhenUnavailable) {
        // Skip the dry run for a hidden toolbar: nobody can see the result and this runs on every keystroke.
        button.disabled = Boolean(container.hidden) || !isAvailable(definition);
      }
    });
  };

  const handleToolbarClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const button = event.target.closest<HTMLButtonElement>('[data-editor-action]');

    if (!button) {
      return;
    }

    event.preventDefault();
    const entry = buttons.get(button.dataset.editorAction || '');

    if (!entry) {
      return;
    }

    const { definition } = entry;

    if (definition.file) {
      filePicker.click();
      return;
    }

    if (definition.prompt) {
      const previous = editor.getAttributes('link').href || '';
      const href = window.prompt(translate('linkPrompt'), previous);

      if (href === null) {
        return;
      }

      if (href.trim() === '') {
        editor.chain().focus().unsetLink().run();
        return;
      }

      editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
      return;
    }

    definition.run?.(editor.chain().focus()).run();
  };

  const handleFileChange = async (): Promise<void> => {
    const file = filePicker.files?.[0];
    filePicker.value = '';

    if (!file || !uploadImage) {
      return;
    }

    try {
      const image = await uploadImage(file);
      const src = imageSource(image);

      if (src) {
        editor.chain().focus().setImage({ src, alt: image.alt || '' }).run();
      }
    } catch (error) {
      onError?.(error);
    }
  };

  toolbar.addEventListener('click', handleToolbarClick);
  tableToolbar.addEventListener('click', handleToolbarClick);
  filePicker.addEventListener('change', handleFileChange);
  editor.on('selectionUpdate', syncToolbar);
  editor.on('transaction', syncToolbar);
  syncToolbar();

  return {
    editor,

    getJSON: () => editor.getJSON() as TiptapDocument,

    focus: () => editor.commands.focus('start'),

    destroy() {
      toolbar.removeEventListener('click', handleToolbarClick);
      tableToolbar.removeEventListener('click', handleToolbarClick);
      filePicker.removeEventListener('change', handleFileChange);
      editor.destroy();
    }
  };
}
