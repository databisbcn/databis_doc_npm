import { DocsApiClient, DocsApiError } from './api-client.js';
import { createTranslator } from './messages.js';
import { createArticleEditor } from './editor.js';
import { renderTiptapDocument } from './tiptap-renderer.js';
import { emptyDocument } from './schema.js';
import { LocalWorker } from './localWorker.js';
import type {
  ArticleEditor,
  ArticleSelectionOptions,
  Identifier,
  CategorySelectionOptions,
  DocsArticle,
  DocsCapabilities,
  DocsCategory,
  DocsClient,
  DocsImageResource,
  DocsModuleOptions,
  DocsRoleOption,
  DocsSearchResult,
  ResolvedDocsModuleOptions,
  TiptapHeading,
  Translate
} from './types.js';

interface CategoryFormControls extends HTMLFormControlsCollection {
  name: HTMLInputElement;
  description: HTMLTextAreaElement;
  parent_id: HTMLSelectElement;
}

interface CategoryFormElement extends HTMLFormElement {
  readonly elements: CategoryFormControls;
}

interface ArticleFormControls extends HTMLFormControlsCollection {
  category: HTMLSelectElement;
  title: HTMLInputElement;
  excerpt: HTMLTextAreaElement;
}

interface ArticleFormElement extends HTMLFormElement {
  readonly elements: ArticleFormControls;
}

const defaultOptions: ResolvedDocsModuleOptions = {
  baseURL: '',
  storageBaseURL: '',
  locale: 'es',
  messages: {},
  primaryColor: '#3176A1',
  credentials: 'include',
  getAuthToken: null,
  syncHash: false,
  autoSelectFirstArticle: true,
  testing: false
};

/**
 * Trash glyph for the delete buttons.
 *
 * Inline rather than a font or an external file: the module ships as a single
 * bundle and must render the same wherever it is embedded.
 */
const trashIcon = `
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
    <path d="M4 7h16M10 4h4M9 7v11M12 7v11M15 7v11M6 7l1 13h10l1-13"
      fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"></path>
  </svg>
`;

/** Every `src` of an image node in a TipTap document, at any depth. */
function collectImageSources(node: unknown, sources: string[] = []): string[] {
  if (!node || typeof node !== 'object') {
    return sources;
  }

  const candidate = node as { type?: string; attrs?: { src?: string }; content?: unknown[] };

  if (candidate.type === 'image' && candidate.attrs?.src) {
    sources.push(String(candidate.attrs.src));
  }

  (candidate.content || []).forEach((child) => collectImageSources(child, sources));

  return sources;
}

/** Pencil glyph for the edit buttons. Inline for the same reason as the trash. */
const pencilIcon = `
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
    <path d="M4 20h4l10-10a2.83 2.83 0 0 0-4-4L4 16v4zM13.5 6.5l4 4"
      fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"></path>
  </svg>
`;

function flattenCategories(categories: DocsCategory[], depth = 0): DocsCategory[] {
  return categories.flatMap((category) => [
    { ...category, depth },
    ...flattenCategories(category.children || [], depth + 1)
  ]);
}

function unwrapData<T>(response: unknown): T {
  if (response && typeof response === 'object' && 'data' in response) {
    return (response as { data: T }).data;
  }

  return response as T;
}

function escapeHTML(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/**
 * Matching ignores case and accents so "instalacion" finds "Instalación".
 */
function normalizeForSearch(value: string): string {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();
}

function searchWords(term: string): string[] {
  return normalizeForSearch(term)
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Wraps every occurrence of a search word in its own span. It works on the
 * normalized copy of the text but slices the original one, so accents and
 * casing survive the highlight; the nodes are built by hand rather than with
 * innerHTML because the text comes from the API.
 *
 * A span rather than <mark> on purpose: the browser default for <mark> is a
 * flat yellow, and any reset in the host application overrides it just as
 * easily. The class carries the whole appearance instead.
 */
function highlightMatches(text: string, words: string[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const value = String(text || '');

  if (!value) {
    return fragment;
  }

  const haystack = normalizeForSearch(value);
  const ranges: Array<[number, number]> = [];

  words.forEach((word) => {
    let index = haystack.indexOf(word);

    while (index !== -1) {
      ranges.push([index, index + word.length]);
      index = haystack.indexOf(word, index + word.length);
    }
  });

  if (!ranges.length) {
    fragment.append(value);
    return fragment;
  }

  ranges.sort((first, second) => first[0] - second[0]);

  let cursor = 0;

  ranges.forEach(([start, end]) => {
    if (start < cursor) {
      return; // Overlapping hit, already covered by the previous mark.
    }

    if (start > cursor) {
      fragment.append(value.slice(cursor, start));
    }

    const mark = document.createElement('span');
    mark.className = 'docs-module__search-mark';
    mark.textContent = value.slice(start, end);
    fragment.append(mark);
    cursor = end;
  });

  if (cursor < value.length) {
    fragment.append(value.slice(cursor));
  }

  return fragment;
}

function resolvePrimaryColor(value: unknown): string {
  const primaryColor = typeof value === 'string' ? value.trim() : '';

  if (!primaryColor) {
    return defaultOptions.primaryColor;
  }

  if (globalThis.CSS?.supports && !globalThis.CSS.supports('color', primaryColor)) {
    return defaultOptions.primaryColor;
  }

  return primaryColor;
}

const HTMLElementBase: typeof HTMLElement = globalThis.HTMLElement
  || class {} as typeof HTMLElement;

export class DatabisDocsElement extends HTMLElementBase {
  private _options: ResolvedDocsModuleOptions;
  private _client: DocsClient | null;
  private _categories: DocsCategory[];
  private _articles: DocsArticle[];
  private _article: DocsArticle | null;
  private _capabilities: DocsCapabilities;
  private _roleOptions: DocsRoleOption[];
  private _sessionUploads: DocsImageResource[];
  private _selectedCategory: string;
  private _selectedArticle: string;
  private _requestSequence: number;
  private _searchTimer: number | null;
  private _searchTerm: string;
  private _statusTimer: number | null;
  private _editing: boolean;
  private _creating: boolean;
  private _dirty: boolean;
  private _editor: ArticleEditor | null;
  private _translate: Translate;
  private readonly _boundHashChange: () => void;
  private readonly _boundBeforeUnload: (event: BeforeUnloadEvent) => void;
  private readonly _boundClearAnnouncement: () => void;

  static get observedAttributes(): string[] {
    return [
      'base-url',
      'storage-base-url',
      'locale',
      'primary-color',
      'category',
      'article',
      'sync-hash',
      'testing'
    ];
  }

  constructor() {
    super();
    this._options = { ...defaultOptions };
    this._client = null;
    this._categories = [];
    this._articles = [];
    this._article = null;
    this._capabilities = {
      authenticated: false,
      is_admin: false,
      can: {
        create_category: false,
        create_article: false,
        view_drafts: false
      }
    };
    this._roleOptions = [];
    this._sessionUploads = [];
    this._selectedCategory = '';
    this._selectedArticle = '';
    this._requestSequence = 0;
    this._searchTimer = null;
    this._searchTerm = '';
    this._statusTimer = null;
    this._editing = false;
    this._creating = false;
    this._dirty = false;
    this._editor = null;
    this._translate = createTranslator(defaultOptions.locale);
    this._boundHashChange = this.handleHashChange.bind(this);
    this._boundBeforeUnload = this.handleBeforeUnload.bind(this);
    this._boundClearAnnouncement = this.clearAnnouncement.bind(this);
  }

  set options(value: DocsModuleOptions) {
    this._options = {
      ...this._options,
      ...value,
      messages: { ...this._options.messages, ...(value?.messages || {}) }
    };

    if (this.isConnected) {
      this.configure();
      this.load();
    }
  }

  get options(): ResolvedDocsModuleOptions {
    return { ...this._options };
  }

  get capabilities(): DocsCapabilities {
    return {
      ...this._capabilities,
      can: { ...this._capabilities.can }
    };
  }

  set testing(value: boolean) {
    this.options = { testing: Boolean(value) };
  }

  get testing(): boolean {
    return Boolean(this._options.testing);
  }

  get testingData() {
    return this._client instanceof LocalWorker ? this._client.data : null;
  }

  set primaryColor(value: string) {
    this.options = { primaryColor: value };
  }

  get primaryColor(): string {
    return this.getAttribute('primary-color')
      || this._options.primaryColor
      || defaultOptions.primaryColor;
  }

  set category(value: string) {
    this.selectCategory(value || '');
  }

  get category(): string {
    return this._selectedCategory;
  }

  set article(value: string) {
    this.selectArticle(value || '');
  }

  get article(): string {
    return this._selectedArticle;
  }

  connectedCallback(): void {
    this.configure();
    this.renderShell();
    this.addEventListener('click', this);
    this.addEventListener('input', this);
    this.addEventListener('submit', this);
    window.addEventListener('hashchange', this._boundHashChange);
    window.addEventListener('beforeunload', this._boundBeforeUnload);
    this.load();
  }

  disconnectedCallback(): void {
    this.removeEventListener('click', this);
    this.removeEventListener('input', this);
    this.removeEventListener('submit', this);
    window.removeEventListener('hashchange', this._boundHashChange);
    window.removeEventListener('beforeunload', this._boundBeforeUnload);
    if (this._searchTimer !== null) {
      window.clearTimeout(this._searchTimer);
    }

    if (this._statusTimer !== null) {
      window.clearTimeout(this._statusTimer);
    }
    this._statusTimer = null;
    this.destroyEditor();
  }

  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null
  ): void {
    if (oldValue === newValue || !this.isConnected) {
      return;
    }

    if (name === 'category') {
      if ((newValue || '') === this._selectedCategory) {
        return;
      }

      this.selectCategory(newValue || '');
      return;
    }

    if (name === 'article') {
      if ((newValue || '') === this._selectedArticle) {
        return;
      }

      this.selectArticle(newValue || '');
      return;
    }

    if (name === 'testing') {
      this._options.testing = newValue !== null;
    }

    this.configure();

    if (name === 'base-url' || name === 'locale' || name === 'testing') {
      this.load();
    }
  }

  configure(): void {
    this._options = {
      ...this._options,
      baseURL: this.getAttribute('base-url') || this._options.baseURL,
      storageBaseURL: this.getAttribute('storage-base-url') || this._options.storageBaseURL,
      locale: this.getAttribute('locale') || this._options.locale,
      syncHash: this.hasAttribute('sync-hash') || this._options.syncHash,
      testing: this.hasAttribute('testing') || this._options.testing
    };
    this.style.setProperty(
      '--docs-color-primary',
      resolvePrimaryColor(this.getAttribute('primary-color') || this._options.primaryColor)
    );
    this._translate = createTranslator(this._options.locale, this._options.messages);

    if (this._options.testing) {
      this._client = new LocalWorker(this._options);
    } else if (this._options.baseURL) {
      this._client = new DocsApiClient(this._options);
    } else {
      this._client = null;
    }
  }

  renderShell(): void {
    this.classList.add('docs-module');
    this.innerHTML = `
      <div class="docs-module__status" role="status" aria-live="polite"></div>
      <header class="docs-module__header">
        <a class="docs-module__brand" href="https://databis.net" target="_blank" rel="noopener noreferrer">
          <svg id="layer_1" xmlns="http://www.w3.org/2000/svg" class="docs-module__brand-logo" version="1.1" viewBox="0 0 100 106.72" role="img" aria-hidden="true" focusable="false">
            <defs>
              <style>
                .st0 {
                  fill: #2b77a4;
                }
              </style>
            </defs>
            <path class="st0" d="M75.7,84.81l-18.6-18.7c-.9.3-1.8.5-2.8.5-2.1,0-4.1-.9-5.5-2.3l-22.2,6.3c-.7,3.5-3.8,6.2-7.5,6.2-4.2,0-7.6-3.4-7.6-7.6s3.4-7.6,7.6-7.6c2.3,0,4.3,1,5.7,2.6l22-6.2c.1-.9.4-1.7.8-2.5l-7.6-9.7c-.5.1-1.1.2-1.6.2-4.2,0-7.6-3.4-7.6-7.6s3.4-7.6,7.6-7.6,7.6,3.4,7.6,7.6c0,1.2-.3,2.3-.8,3.3l7.8,9.9c.2,0,.4-.1.7-.1l7.8-23.5c-1.4-1.4-2.3-3.3-2.3-5.4,0-4.2,3.4-7.6,7.6-7.6s7.6,3.4,7.6,7.6c0,3.8-2.8,7-6.5,7.5l-7.9,23.9c1.2,1.3,1.9,3.1,1.9,5.1,0,.7-.1,1.4-.3,2.1l19.2,19.1c.9-.3,1.8-.5,2.8-.5,2.1,0,4.1.8,5.6,2.1,5.7-8,9.1-17.9,9.1-28.5,0-26.9-21.5-48.8-48.1-48.8S2.1,26.41,2.1,53.41s21.6,48.7,48.2,48.7c9.8,0,18.9-3,26.5-8.1-1.2-1.5-1.9-3.4-1.9-5.5,0-1.3.3-2.6.8-3.7Z"/>
          </svg>
          <span class="docs-module__brand-text">Developed by Databis</span>
        </a>
        <button class="docs-module__menu" type="button" data-action="toggle-navigation"
          aria-expanded="false" aria-controls="docs-navigation">${escapeHTML(this._translate('menu'))}</button>
        <form class="docs-module__search" role="search">
          <label class="docs-module__visually-hidden" for="docs-search">${escapeHTML(this._translate('search'))}</label>
          <input id="docs-search" name="search" type="search" autocomplete="off"
            placeholder="${escapeHTML(this._translate('search'))}">
          <button type="submit">${escapeHTML(this._translate('searchButton'))}</button>
        </form>
      </header>
      <div class="docs-module__layout">
        <nav id="docs-navigation" class="docs-module__navigation" aria-label="${escapeHTML(this._translate('categories'))}">
          <section>
            <div class="docs-module__navigation-heading">
              <h2>${escapeHTML(this._translate('categories'))}</h2>
              <button class="docs-module__add-button" type="button" data-action="create-category"
                hidden aria-label="${escapeHTML(this._translate('newCategory'))}"
                title="${escapeHTML(this._translate('newCategory'))}">+ ${escapeHTML(this._translate('newCategory'))}</button>
            </div>
            <div class="docs-module__categories"></div>
          </section>
          <section>
            <div class="docs-module__navigation-heading">
              <h2>${escapeHTML(this._translate('articles'))}</h2>
              <button class="docs-module__add-button" type="button" data-action="create-article"
                hidden aria-label="${escapeHTML(this._translate('newArticle'))}"
                title="${escapeHTML(this._translate('newArticle'))}">+ ${escapeHTML(this._translate('newArticle'))}</button>
            </div>
            <div class="docs-module__articles"></div>
          </section>
        </nav>
        <main class="docs-module__main" tabindex="-1">
          <div class="docs-module__content"></div>
        </main>
        <aside class="docs-module__toc" aria-label="${escapeHTML(this._translate('contents'))}"></aside>
      </div>
    `;
  }

  async load(): Promise<void> {
    if (!this._client) {
      this.showError('Databis Docs requires a base-url attribute or a baseURL option.');
      return;
    }

    const requestId = ++this._requestSequence;
    this.setBusy(true);

    try {
      this.readHash();
      const initialArticle = this.getAttribute('article') || this._selectedArticle || '';
      const [response, capabilitiesResponse] = await Promise.all([
        this._client.getCategories({ locale: this._options.locale }),
        this.loadCapabilities()
      ]);

      if (requestId !== this._requestSequence) {
        return;
      }

      this._categories = unwrapData<DocsCategory[]>(response) || [];
      this._capabilities = capabilitiesResponse;
      this._roleOptions = await this.loadRoleOptions();
      this.renderCategories();
      this.renderAdminActions();

      const initialCategory = this.getAttribute('category')
        || this._selectedCategory
        || flattenCategories(this._categories)[0]?.slug
        || '';

      if (initialCategory) {
        await this.selectCategory(initialCategory, {
          article: initialArticle,
          silent: true
        });
      } else {
        this.renderEmptyContent(this._translate('emptyCategories'));
      }

      this.dispatchEvent(new CustomEvent('docs:ready', {
        bubbles: true,
        detail: {
          categories: this._categories,
          capabilities: this._capabilities
        }
      }));
    } catch (error) {
      if (requestId === this._requestSequence) {
        this.handleError(error, this._translate('loadError'));
      }
    } finally {
      if (requestId === this._requestSequence) {
        this.setBusy(false);
      }
    }
  }

  async loadCapabilities(): Promise<DocsCapabilities> {
    if (!this._client) {
      return this._capabilities;
    }

    try {
      const response = await this._client.getCapabilities();
      return unwrapData<DocsCapabilities>(response) || this._capabilities;
    } catch (error) {
      if (error instanceof DocsApiError && [401, 403].includes(error.status)) {
        return this._capabilities;
      }

      this.dispatchEvent(new CustomEvent('docs:error', {
        bubbles: true,
        detail: { error }
      }));
      return this._capabilities;
    }
  }

  /**
   * Options for the visibility dropdown.
   *
   * Sequential rather than part of the Promise.all above because the answer
   * depends on the capabilities: the endpoint is closed to non-editors, and
   * nobody else renders the field anyway. A failure here is not worth breaking
   * the whole load over — the editor simply comes up without the field.
   */
  async loadRoleOptions(): Promise<DocsRoleOption[]> {
    if (!this._client?.getRoles
      || !this._capabilities.roles_enabled
      || !this._capabilities.is_admin) {
      return [];
    }

    try {
      const response = await this._client.getRoles();
      return unwrapData<DocsRoleOption[]>(response) || [];
    } catch {
      return [];
    }
  }

  /**
   * The "who sees this" field, or null when there is nothing to choose from.
   *
   * A native multiple select: it is the only multi-value control the module
   * needs, and it already matches the two single selects in these forms.
   */
  buildRolesField(selected: string[] = []): HTMLElement | null {
    if (this._roleOptions.length === 0) {
      return null;
    }

    const field = document.createElement('div');
    field.className = 'docs-module__field docs-module__roles';

    const title = document.createElement('span');
    title.className = 'docs-module__field-label';
    title.textContent = this._translate('visibleRoles');

    const body = document.createElement('div');
    body.className = 'docs-module__roles-body';

    const select = document.createElement('select');
    select.className = 'docs-module__roles-select';
    select.setAttribute('aria-label', this._translate('addRole'));

    // The list is the state, so the select is only ever a way to add to it and
    // never carries a value of its own. It has no name for that reason: what
    // gets saved is read off the list.
    const list = document.createElement('ul');
    list.className = 'docs-module__roles-list';

    body.append(select, list);

    const hint = document.createElement('small');
    hint.className = 'docs-module__hint';
    hint.textContent = this._translate('visibleRolesHint');

    field.append(title, body, hint);

    selected.forEach((value) => this.appendRole(list, String(value)));
    this.refreshRolesField(field);

    return field;
  }

  /** One row of the list: the role, and the button that takes it off again. */
  appendRole(list: HTMLElement, value: string): void {
    const option = this._roleOptions.find((role) => role.value === value);

    if (!option || this.roleItem(list, value)) {
      return;
    }

    const item = document.createElement('li');
    item.className = 'docs-module__roles-item';
    item.dataset.role = value;

    const label = document.createElement('span');
    label.textContent = option.label;

    const remove = document.createElement('button');
    // Without this a button inside a form defaults to submit, and removing a
    // role would save the article.
    remove.type = 'button';
    remove.className = 'docs-module__roles-remove';
    remove.dataset.action = 'remove-role';
    remove.dataset.role = value;
    remove.setAttribute('aria-label', `${this._translate('removeRole')}: ${option.label}`);
    remove.title = this._translate('removeRole');
    remove.textContent = '×';

    item.append(label, remove);
    list.append(item);
  }

  /**
   * Redraws the two halves around the list.
   *
   * The select only offers what is not on the list yet, so the same role
   * cannot be added twice and there is nothing to deduplicate later. An empty
   * list says so in words rather than sitting there blank, since "nothing
   * selected" is a meaningful state here and not an unfinished one.
   */
  refreshRolesField(field: HTMLElement): void {
    const select = field.querySelector<HTMLSelectElement>('.docs-module__roles-select')!;
    const list = field.querySelector<HTMLElement>('.docs-module__roles-list')!;
    const chosen = new Set(this.rolesIn(list));

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = this._translate('addRole');
    select.replaceChildren(placeholder);

    this._roleOptions
      .filter((role) => !chosen.has(role.value))
      .forEach((role) => {
        const option = document.createElement('option');
        option.value = role.value;
        option.textContent = role.label;
        select.append(option);
      });

    select.value = '';
    select.disabled = select.options.length === 1;

    const empty = list.querySelector('.docs-module__roles-empty');

    if (chosen.size === 0 && !empty) {
      const item = document.createElement('li');
      item.className = 'docs-module__roles-empty';
      item.textContent = this._translate('visibleToEveryone');
      list.append(item);
    } else if (chosen.size > 0 && empty) {
      empty.remove();
    }
  }

  /**
   * The row for one role, if it is on the list.
   *
   * Compared in JavaScript rather than through a selector: role values come
   * from the host's own roles table and can be anything, and CSS.escape is not
   * available in every DOM this component is exercised in.
   */
  roleItem(list: HTMLElement, value: string): HTMLElement | undefined {
    return Array.from(list.querySelectorAll<HTMLElement>('.docs-module__roles-item[data-role]'))
      .find((item) => item.dataset.role === value);
  }

  /** @return the role values on a list, in the order they were added. */
  rolesIn(list: HTMLElement): string[] {
    return Array.from(list.querySelectorAll<HTMLElement>('.docs-module__roles-item[data-role]'))
      .map((item) => item.dataset.role || '')
      .filter(Boolean);
  }

  addRole(select: HTMLSelectElement): void {
    const value = select.value;
    const field = select.closest<HTMLElement>('.docs-module__roles');

    if (!value || !field) {
      return;
    }

    this.appendRole(field.querySelector<HTMLElement>('.docs-module__roles-list')!, value);
    this.refreshRolesField(field);
  }

  removeRole(button: HTMLElement): void {
    const field = button.closest<HTMLElement>('.docs-module__roles');
    const value = button.dataset.role || '';

    if (!field || !value) {
      return;
    }

    const list = field.querySelector<HTMLElement>('.docs-module__roles-list')!;

    this.roleItem(list, value)?.remove();
    this.refreshRolesField(field);
  }

  /**
   * What to send as `roles`. Undefined when the field was never rendered, so
   * the backend leaves the existing assignment alone instead of wiping it.
   */
  selectedRoles(form: HTMLFormElement): string[] | undefined {
    const list = form.querySelector<HTMLElement>('.docs-module__roles-list');

    return list ? this.rolesIn(list) : undefined;
  }

  renderAdminActions(): void {
    const createCategoryButton = this.querySelector<HTMLButtonElement>(
      '[data-action="create-category"]'
    );
    const createArticleButton = this.querySelector<HTMLButtonElement>(
      '[data-action="create-article"]'
    );

    if (!createCategoryButton || !createArticleButton) {
      return;
    }

    const hasCategories = flattenCategories(this._categories).length > 0;
    createCategoryButton.hidden = !this._capabilities.can?.create_category;
    createArticleButton.hidden = !this._capabilities.can?.create_article || !hasCategories;
  }

  selectedCategoryId(): number | null {
    return flattenCategories(this._categories)
      .find((category) => category.slug === this._selectedCategory)?.id || null;
  }

  async selectCategory(
    slug: string,
    options: CategorySelectionOptions = {}
  ): Promise<void> {
    if (!slug || !this._client) {
      return;
    }

    const requestedArticle = options.article
      || (options.keepArticle ? this._selectedArticle : '');
    this._selectedCategory = slug;
    this._selectedArticle = options.keepArticle ? this._selectedArticle : '';
    this._article = null;
    this._editing = false;
    this._creating = false;
    this.reflectSelection();
    this.highlightSelection();
    this.setBusy(true);

    try {
      const response = await this._client.getArticles(slug, {
        locale: this._options.locale,
        drafts: this._capabilities.can?.view_drafts
      });
      this._articles = unwrapData<DocsArticle[]>(response) || [];
      this.renderArticles();

      const hasRequestedArticle = this._articles
        .some((article) => article.slug === requestedArticle);
      const firstArticle = this._options.autoSelectFirstArticle ? this._articles[0]?.slug : '';
      const articleToSelect = hasRequestedArticle ? requestedArticle : firstArticle;

      if (articleToSelect) {
        await this.selectArticle(articleToSelect, { silent: true });
      } else {
        this.renderEmptyContent(
          this._articles.length
            ? this._translate('selectArticle')
            : this._translate('emptyArticles')
        );
      }

      if (!options.silent) {
        this.emitNavigation();
      }
    } catch (error) {
      this.handleError(error, this._translate('loadError'));
    } finally {
      this.setBusy(false);
    }
  }

  async selectArticle(
    slug: string,
    options: ArticleSelectionOptions = {}
  ): Promise<void> {
    if (!slug || !this._selectedCategory || !this._client) {
      return;
    }

    this._selectedArticle = slug;
    this._editing = false;
    this.reflectSelection();
    this.highlightSelection();
    this.setBusy(true);

    try {
      const response = await this._client.getArticle(
        this._selectedCategory,
        slug,
        { locale: this._options.locale }
      );
      this._article = unwrapData<DocsArticle>(response);
      this.renderArticle();

      if (!options.silent) {
        this.emitNavigation();
      }

      this.querySelector<HTMLElement>('.docs-module__main')?.focus({ preventScroll: true });
    } catch (error) {
      this.handleError(error, this._translate('loadError'));
    } finally {
      this.setBusy(false);
    }
  }

  renderCategories(): void {
    const container = this.querySelector<HTMLElement>('.docs-module__categories')!;
    container.replaceChildren();
    const categories = flattenCategories(this._categories);

    if (!categories.length) {
      container.textContent = this._translate('emptyCategories');
      return;
    }

    const list = document.createElement('ul');
    list.className = 'docs-module__list';

    categories.forEach((category) => {
      const item = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'docs-module__list-row';
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = 'select-category';
      button.dataset.slug = category.slug;
      button.style.setProperty('--docs-category-depth', String(category.depth || 0));
      button.textContent = category.name;
      row.append(button);

      // Edit before delete: same order as the buttons on the article header,
      // and the destructive one stays furthest from the name it belongs to.
      if (category.can?.update) {
        row.append(this.rowActionButton(
          'edit-category',
          category.id,
          this._translate('editCategory'),
          pencilIcon,
          'docs-module__edit-button'
        ));
      }

      if (category.can?.delete) {
        row.append(this.deleteButton(
          'delete-category',
          category.id,
          this._translate('deleteCategory')
        ));
      }

      item.append(row);
      list.append(item);
    });

    container.append(list);
    this.highlightSelection();
  }

  renderArticles(): void {
    const container = this.querySelector<HTMLElement>('.docs-module__articles')!;
    container.replaceChildren();

    if (!this._articles.length) {
      container.textContent = this._translate('emptyArticles');
      return;
    }

    const list = document.createElement('ul');
    list.className = 'docs-module__list';

    this._articles.forEach((article) => {
      const item = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'docs-module__list-row';
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = 'select-article';
      button.dataset.slug = article.slug;
      button.textContent = article.title;
      row.append(button);

      // Administrators see the drafts too, so the row has to say which is
      // which. The state comes first and the destructive action last.
      if (this._capabilities.is_admin) {
        row.append(this.publishStateIcon(Boolean(article.is_published)));
      }

      if (article.can?.delete) {
        row.append(this.deleteButton(
          'delete-article',
          article.id,
          this._translate('deleteArticle')
        ));
      }

      item.append(row);
      list.append(item);
    });

    container.append(list);
    this.highlightSelection();
  }

  /** Dot telling an administrator whether the article is live or still a draft. */
  publishStateIcon(isPublished: boolean): HTMLElement {
    const label = this._translate(isPublished ? 'published' : 'draft');
    const icon = document.createElement('span');
    icon.className = 'docs-module__publish-state';
    icon.dataset.state = isPublished ? 'published' : 'draft';
    icon.setAttribute('role', 'img');
    icon.setAttribute('aria-label', label);
    icon.title = label;

    return icon;
  }

  /** Icon-only button; the label lives in the tooltip and the accessible name. */
  rowActionButton(
    action: 'delete-article' | 'delete-category' | 'edit-category',
    id: Identifier,
    label: string,
    icon: string,
    modifier: string
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `docs-module__row-action ${modifier}`;
    button.dataset.action = action;
    button.dataset.id = String(id);
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = icon;

    return button;
  }

  deleteButton(
    action: 'delete-article' | 'delete-category',
    id: Identifier,
    label: string
  ): HTMLButtonElement {
    return this.rowActionButton(action, id, label, trashIcon, 'docs-module__delete-button');
  }

  renderArticle(): void {
    const container = this.querySelector<HTMLElement>('.docs-module__content')!;
    const toc = this.querySelector<HTMLElement>('.docs-module__toc')!;
    this.destroyEditor();
    container.replaceChildren();
    toc.replaceChildren();

    if (!this._article) {
      this.renderEmptyContent(this._translate('selectArticle'));
      return;
    }

    const header = document.createElement('header');
    header.className = 'docs-module__article-header';
    const title = document.createElement('h1');
    title.textContent = this._article.title;
    header.append(title);

    const actions = document.createElement('div');
    actions.className = 'docs-module__article-actions';

    if (this._article.can?.update) {
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.dataset.action = 'edit';
      editButton.textContent = this._translate('edit');
      actions.append(editButton);
    }

    if (this._article.can?.publish) {
      const publishButton = document.createElement('button');
      publishButton.type = 'button';
      publishButton.dataset.action = 'toggle-publish';
      publishButton.textContent = this._article.is_published
        ? this._translate('unpublish')
        : this._translate('publish');
      actions.append(publishButton);
    }

    if (actions.childElementCount > 0) {
      header.append(actions);
    }

    const rendered = renderTiptapDocument(this._article.content || emptyDocument(), {
      storageBaseURL: this._options.storageBaseURL
    });
    container.append(header, rendered.element);
    this.renderToc(rendered.headings);
  }

  renderToc(headings: TiptapHeading[]): void {
    const toc = this.querySelector<HTMLElement>('.docs-module__toc')!;

    if (!headings.length) {
      toc.hidden = true;
      return;
    }

    toc.hidden = false;
    const title = document.createElement('h2');
    title.textContent = this._translate('contents');
    const list = document.createElement('ul');

    headings.forEach((heading) => {
      const item = document.createElement('li');
      item.className = `docs-module__toc-level-${heading.level}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = 'scroll-heading';
      button.dataset.heading = heading.id;
      button.textContent = heading.label;
      item.append(button);
      list.append(item);
    });

    toc.append(title, list);
  }

  /**
   * The category form, for a new category or for an existing one.
   *
   * @param category  the category being edited; omit to create a new one.
   */
  renderCategoryForm(category: DocsCategory | null = null): void {
    const container = this.querySelector<HTMLElement>('.docs-module__content')!;
    this.destroyEditor();
    container.replaceChildren();
    this.querySelector<HTMLElement>('.docs-module__toc')!.replaceChildren();
    this._editing = true;
    this._creating = false;
    this._dirty = false;

    const form = document.createElement('form');
    form.className = 'docs-module__editor';
    form.dataset.form = 'category';

    // What tells saveCategory which of the two things it is doing.
    if (category) {
      form.dataset.id = String(category.id);
    }

    const heading = document.createElement('h1');
    heading.textContent = this._translate(category ? 'editCategory' : 'newCategory');

    const nameLabel = document.createElement('label');
    nameLabel.textContent = this._translate('name');
    const nameInput = document.createElement('input');
    nameInput.name = 'name';
    nameInput.required = true;
    nameInput.maxLength = 255;
    nameInput.value = category?.name || '';
    nameLabel.append(nameInput);

    const descriptionLabel = document.createElement('label');
    descriptionLabel.textContent = this._translate('description');
    const descriptionInput = document.createElement('textarea');
    descriptionInput.name = 'description';
    descriptionInput.rows = 3;
    descriptionInput.value = category?.description || '';
    descriptionLabel.append(descriptionInput);

    const parentLabel = document.createElement('label');
    parentLabel.textContent = this._translate('parentCategory');
    const parentSelect = document.createElement('select');
    parentSelect.name = 'parent_id';
    const rootOption = document.createElement('option');
    rootOption.value = '';
    rootOption.textContent = this._translate('noParentCategory');
    rootOption.selected = !category?.parent_id;
    parentSelect.append(rootOption);

    // A category cannot be moved under itself or under one of its own
    // descendants. The backend refuses it with a 422, but offering the choice
    // at all only invites the error.
    const forbidden = this.subtreeIds(category);

    flattenCategories(this._categories)
      .filter((option) => !forbidden.has(Number(option.id)))
      .forEach((option) => {
        const element = document.createElement('option');
        element.value = String(option.id);
        element.textContent = `${'— '.repeat(option.depth || 0)}${option.name}`;
        element.selected = Number(category?.parent_id) === Number(option.id);
        parentSelect.append(element);
      });
    parentLabel.append(parentSelect);

    const actions = document.createElement('div');
    actions.className = 'docs-module__editor-actions';
    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    saveButton.textContent = this._translate(category ? 'save' : 'createCategory');
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.dataset.action = 'cancel-category';
    cancelButton.textContent = this._translate('cancel');
    actions.append(saveButton, cancelButton);

    const rolesLabel = this.buildRolesField(category?.visible_roles || []);

    form.append(heading, nameLabel, descriptionLabel, parentLabel);
    if (rolesLabel) {
      form.append(rolesLabel);
    }
    form.append(actions);
    container.append(form);
    nameInput.focus();
  }

  /**
   * A category and everything under it, as ids.
   *
   * Empty for a category being created, which has no subtree yet and nothing
   * to forbid.
   */
  subtreeIds(category: DocsCategory | null): Set<number> {
    if (!category) {
      return new Set();
    }

    // The node from the tree rather than the argument: the one handed in came
    // from the flattened list and its children are what matter here.
    const node = flattenCategories(this._categories)
      .find((item) => Number(item.id) === Number(category.id));

    return new Set([
      Number(category.id),
      ...flattenCategories(node?.children || []).map((item) => Number(item.id))
    ]);
  }

  async saveCategory(form: CategoryFormElement): Promise<void> {
    const editingId = form.dataset.id ? Number(form.dataset.id) : null;

    this.setBusy(true);

    try {
      const parentId = form.elements.parent_id.value;
      if (!this._client) {
        return;
      }

      const roles = this.selectedRoles(form);

      const payload = {
        name: form.elements.name.value.trim(),
        description: form.elements.description.value.trim() || null,
        parent_id: parentId ? Number(parentId) : null,
        ...(roles ? { roles } : {})
      };

      const response = editingId
        // is_published is left out on an update: it is not on this form, and
        // sending it would quietly republish a category somebody had retired.
        ? await this._client.updateCategory(editingId, payload)
        : await this._client.createCategory({ ...payload, is_published: true });

      const category = unwrapData<DocsCategory>(response);
      this._selectedCategory = category.slug;
      this._selectedArticle = editingId ? this._selectedArticle : '';
      this._editing = false;
      this._dirty = false;
      this.reflectSelection();
      await this.load();

      if (editingId) {
        this.announce(this._translate('categoryUpdateSuccess'), 'success');
      } else {
        this.announce(this._translate('categoryCreateSuccess'), 'success');
        this.emitCategoryCreate(category);
      }
    } catch (error) {
      this.handleError(error, this._translate(
        editingId ? 'categoryUpdateError' : 'categoryCreateError'
      ));
    } finally {
      this.setBusy(false);
    }
  }

  renderEditor(mode: 'create' | 'edit' = 'edit'): void {
    const container = this.querySelector<HTMLElement>('.docs-module__content')!;
    this.destroyEditor();
    container.replaceChildren();
    this.querySelector<HTMLElement>('.docs-module__toc')!.replaceChildren();

    // Only when the editor is being opened, not when it is redrawn in place —
    // a save conflict re-renders it, and the uploads made before the conflict
    // still have to be accounted for when the editor is finally left.
    if (!this._editing) {
      this._sessionUploads = [];
    }

    this._editing = true;
    this._creating = mode === 'create';
    this._dirty = false;

    const sourceArticle = this._creating
      ? {
          title: '',
          excerpt: '',
          content: emptyDocument(),
          doc_category_id: this.selectedCategoryId(),
          visible_roles: [] as string[]
        }
      : this._article;

    if (!sourceArticle) {
      this.renderEmptyContent(this._translate('selectArticle'));
      return;
    }

    const form = document.createElement('form');
    form.className = 'docs-module__editor';
    form.dataset.form = 'article';
    form.dataset.mode = mode;

    const heading = document.createElement('h1');
    heading.textContent = this._creating
      ? this._translate('newArticle')
      : this._translate('editArticle');

    const categoryLabel = document.createElement('label');
    categoryLabel.textContent = this._translate('category');
    const categorySelect = document.createElement('select');
    categorySelect.name = 'category';
    categorySelect.required = true;

    flattenCategories(this._categories).forEach((category) => {
      const option = document.createElement('option');
      option.value = String(category.id);
      option.textContent = `${'— '.repeat(category.depth || 0)}${category.name}`;
      option.selected = Number(sourceArticle.doc_category_id) === Number(category.id);
      categorySelect.append(option);
    });
    categoryLabel.append(categorySelect);

    const titleLabel = document.createElement('label');
    titleLabel.textContent = this._translate('title');
    const titleInput = document.createElement('input');
    titleInput.name = 'title';
    titleInput.required = true;
    titleInput.maxLength = 255;
    titleInput.value = sourceArticle.title;
    titleLabel.append(titleInput);

    const excerptLabel = document.createElement('label');
    excerptLabel.textContent = this._translate('excerpt');
    const excerptInput = document.createElement('textarea');
    excerptInput.name = 'excerpt';
    excerptInput.maxLength = 1000;
    excerptInput.rows = 3;
    excerptInput.value = sourceArticle.excerpt || '';
    excerptLabel.append(excerptInput);

    // TipTap manages its own DOM, so it gets a plain mount point rather than a
    // form control. The document never round-trips through a string.
    const contentLabel = document.createElement('div');
    contentLabel.className = 'docs-module__field';
    const contentTitle = document.createElement('span');
    contentTitle.className = 'docs-module__field-label';
    contentTitle.textContent = this._translate('content');
    const mount = document.createElement('div');
    mount.className = 'docs-module__editor-mount';
    contentLabel.append(contentTitle, mount);

    const actions = document.createElement('div');
    actions.className = 'docs-module__editor-actions';
    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    saveButton.textContent = this._creating
      ? this._translate('createArticle')
      : this._translate('save');
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.dataset.action = 'cancel-edit';
    cancelButton.textContent = this._translate('cancel');
    actions.append(saveButton, cancelButton);

    const rolesLabel = this.buildRolesField(sourceArticle.visible_roles || []);

    form.append(heading, categoryLabel, titleLabel, excerptLabel);
    if (rolesLabel) {
      form.append(rolesLabel);
    }
    form.append(contentLabel, actions);
    container.append(form);

    this._editor = createArticleEditor({
      mount,
      content: sourceArticle.content,
      storageBaseURL: this._options.storageBaseURL,
      translate: this._translate,
      uploadImage: (file) => this.uploadImage(file),
      onUpdate: () => {
        this._dirty = true;
      },
      onError: (error) => this.handleError(error, this._translate('uploadError'))
    });

    titleInput.focus();
  }

  /**
   * Uploads a file and returns the image resource.
   *
   * The editor stores the internal path rather than the absolute URL, so
   * content survives a change of domain or storage disk. Display resolves it
   * under `storageBaseURL`, which defaults to `/storage`.
   */
  async uploadImage(file: File): Promise<DocsImageResource> {
    if (!this._client) {
      throw new TypeError('The documentation client is not configured.');
    }

    const response = await this._client.uploadImage(file);
    const image = unwrapData<DocsImageResource>(response);

    // Remembered for the length of the editing session. The upload happens the
    // moment the file is dropped, long before anything is saved, so this is the
    // only place that knows the picture exists at all: nothing on the server
    // can tell an image being written into an article right now from one that
    // was abandoned.
    this._sessionUploads.push(image);

    return image;
  }

  /**
   * Deletes the images uploaded during this editing session that did not make
   * it into the document that ended up stored.
   *
   * Called when leaving the editor. On cancel that is the article as it stands
   * on the server, so every upload of this session goes; on a successful save
   * it is what was just written, which catches the picture that was inserted
   * and then taken out again before saving.
   *
   * Nothing was uploaded, nothing is requested — the common case costs no
   * round trip at all. Failures are swallowed: the article is already saved or
   * already discarded, and docs:prune-images is the backstop for a file that
   * outlives its request.
   */
  async discardUnusedUploads(storedContent?: unknown): Promise<void> {
    const uploads = this._sessionUploads;
    this._sessionUploads = [];

    if (uploads.length === 0 || !this._client) {
      return;
    }

    const kept = collectImageSources(storedContent);
    const unused = uploads.filter((image) => {
      const reference = image.path || image.url || '';

      return reference !== '' && !kept.some((src) => src.includes(reference));
    });

    await Promise.all(unused.map(async (image) => {
      try {
        await this._client!.deleteImage(image.id);
      } catch (error) {
        this.dispatchEvent(new CustomEvent('docs:error', {
          bubbles: true,
          detail: { error }
        }));
      }
    }));
  }

  /**
   * ProseMirror keeps listeners and a view around; dropping the DOM is not
   * enough. Anything that replaces the editor has to tear it down first.
   */
  destroyEditor(): void {
    this._editor?.destroy();
    this._editor = null;
  }

  async saveEditor(form: ArticleFormElement): Promise<void> {
    if (!this._editor || !this._client) {
      return;
    }

    const content = this._editor.getJSON();

    this.setBusy(true);

    try {
      const roles = this.selectedRoles(form);

      const articleData = {
        doc_category_id: Number(form.elements.category.value),
        title: form.elements.title.value.trim(),
        excerpt: form.elements.excerpt.value.trim() || null,
        content,
        locale: this._options.locale,
        // Omitted, not empty, when the field was never rendered: the backend
        // reads an absent key as "leave the assignment alone".
        ...(roles ? { roles } : {})
      };
      const response = this._creating
        ? await this._client.createArticle(articleData)
        : await this._client.updateArticle(this._article!.id, {
            ...articleData,
            updated_at: this._article!.updated_at
          });
      const wasCreating = this._creating;
      const savedArticle = unwrapData<DocsArticle>(response);

      // The backend already collected what this save dropped from the article.
      // What it cannot see is an upload that never reached the document at
      // all — inserted and then taken out again before saving.
      this.discardUnusedUploads(content);

      this._article = savedArticle;
      const category = flattenCategories(this._categories)
        .find((item) => Number(item.id) === Number(savedArticle.doc_category_id));
      this._selectedArticle = savedArticle.slug;
      this._selectedCategory = category?.slug || this._selectedCategory;
      this._editing = false;
      this._creating = false;
      this._dirty = false;
      this.destroyEditor();
      this.reflectSelection();

      await this.selectCategory(this._selectedCategory, {
        article: this._selectedArticle,
        silent: true
      });

      if (wasCreating) {
        this.announce(this._translate('createSuccess'), 'success');
        this.emitCreate();
      } else {
        this.announce(this._translate('saveSuccess'), 'success');
      }

      this.emitChange();
    } catch (error) {
      const conflictData = error instanceof DocsApiError
        && error.data
        && typeof error.data === 'object'
        && 'current' in error.data
        ? error.data as { current: DocsArticle }
        : null;

      if (error instanceof DocsApiError && error.status === 409 && conflictData?.current) {
        this._article = conflictData.current;
        this.renderEditor();
        this.announce(this._translate('conflict'), 'error');
      } else {
        this.handleError(error, this._translate('saveError'));
      }
    } finally {
      this.setBusy(false);
    }
  }

  async togglePublish(): Promise<void> {
    if (!this._article?.can?.publish || !this._client) {
      return;
    }

    const isPublished = !this._article.is_published;
    this.setBusy(true);

    try {
      const response = await this._client.publishArticle(this._article.id, isPublished);
      this._article = {
        ...this._article,
        ...unwrapData<Partial<DocsArticle>>(response)
      };
      this.renderArticle();
      this.renderArticles();
      this.announce(
        isPublished ? this._translate('publishSuccess') : this._translate('unpublishSuccess'),
        'success'
      );
      this.emitChange();
    } catch (error) {
      this.handleError(error, this._translate('publishError'));
    } finally {
      this.setBusy(false);
    }
  }

  /**
   * Confirms a destructive action.
   *
   * Falls back to going ahead where there is no dialog available (a headless
   * environment), because the button was already gated by the delete policy.
   */
  confirmDelete(message: string): boolean {
    const dialog = globalThis.window?.confirm;

    if (typeof dialog !== 'function') {
      return true;
    }

    return dialog.call(globalThis.window, message) === true;
  }

  async deleteArticle(id: Identifier): Promise<void> {
    const article = this._articles
      .find((candidate) => Number(candidate.id) === Number(id));

    if (!article?.can?.delete || !this._client) {
      return;
    }

    if (!this.confirmDelete(this._translate('confirmDeleteArticle'))) {
      return;
    }

    const wasSelected = this._selectedArticle === article.slug;
    this.setBusy(true);

    try {
      await this._client.deleteArticle(Number(article.id));

      if (wasSelected) {
        this._article = null;
        this._editing = false;
        this._creating = false;
        this._dirty = false;
        this.destroyEditor();
      }

      this.emitArticleDelete(article);

      // Reloading the category is what keeps the list, the selection and the
      // open article consistent, whichever article was removed.
      await this.selectCategory(this._selectedCategory, {
        keepArticle: !wasSelected,
        silent: true
      });
      this.announce(this._translate('deleteArticleSuccess'), 'success');
    } catch (error) {
      this.announceError(error, this._translate('deleteArticleError'));
    } finally {
      this.setBusy(false);
    }
  }

  async deleteCategory(id: Identifier): Promise<void> {
    const category = flattenCategories(this._categories)
      .find((candidate) => Number(candidate.id) === Number(id));

    if (!category?.can?.delete || !this._client) {
      return;
    }

    if (!this.confirmDelete(this._translate('confirmDeleteCategory'))) {
      return;
    }

    this.setBusy(true);

    try {
      // The API refuses a category that still holds articles or children, and
      // answers 422 with the reason, which handleError surfaces as-is.
      await this._client.deleteCategory(Number(category.id));

      if (this._selectedCategory === category.slug) {
        this._selectedCategory = '';
        this._selectedArticle = '';
        this._article = null;
        this._articles = [];
        this._editing = false;
        this._creating = false;
        this._dirty = false;
        this.destroyEditor();
        this.removeAttribute('category');
        this.removeAttribute('article');
        this.reflectSelection();
        this.renderArticles();
      }

      this.emitCategoryDelete(category);
      await this.load();
      this.announce(this._translate('deleteCategorySuccess'), 'success');
    } catch (error) {
      this.announceError(error, this._translate('deleteCategoryError'));
    } finally {
      this.setBusy(false);
    }
  }

  async runSearch(term: string): Promise<void> {
    const normalizedTerm = term.trim();

    if (normalizedTerm.length < 3) {
      // Going back under the minimum clears the results instead of leaving the
      // last ones on screen, which looked like the search had frozen.
      if (this._searchTerm) {
        this._searchTerm = '';
        this.renderArticle();
      }

      return;
    }

    if (!this._client) {
      return;
    }

    this.setBusy(true);

    try {
      const response = await this._client.search(normalizedTerm, { locale: this._options.locale });
      this._searchTerm = normalizedTerm;
      this.renderSearchResults(unwrapData<DocsSearchResult[]>(response) || []);
    } catch (error) {
      this.handleError(error, this._translate('loadError'));
    } finally {
      this.setBusy(false);
    }
  }

  renderSearchResults(results: DocsSearchResult[]): void {
    const container = this.querySelector<HTMLElement>('.docs-module__content')!;
    container.replaceChildren();
    this.querySelector<HTMLElement>('.docs-module__toc')!.replaceChildren();
    const title = document.createElement('h1');
    title.textContent = this._translate('searchResults');
    container.append(title);

    if (!results.length) {
      const empty = document.createElement('p');
      empty.textContent = this._translate('emptySearch');
      container.append(empty);
      return;
    }

    const words = searchWords(this._searchTerm);
    const list = document.createElement('ul');
    list.className = 'docs-module__search-results';

    results.forEach((result) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = 'search-result';
      button.dataset.category = result.category?.slug || '';
      button.dataset.article = result.slug;

      const heading = document.createElement('strong');
      heading.className = 'docs-module__search-title';

      // The title goes inside its own box: the heading is a flex row (title
      // plus badge) and without this every highlighted fragment would become
      // a separate flex item, so a partial hit split the word apart.
      const headingText = document.createElement('div');
      headingText.className = 'docs-module__search-title-text';
      headingText.append(highlightMatches(result.title, words));
      heading.append(headingText);

      // The flags are optional: an older API just sends the snippet, so fall
      // back to looking for the words in the text we already have.
      const titleMatch = result.title_match
        ?? words.some((word) => normalizeForSearch(result.title).includes(word));
      const contentMatch = result.content_match
        ?? words.some((word) => normalizeForSearch(result.snippet || '').includes(word));

      if (titleMatch) {
        heading.append(this.matchBadge('title'));
      }

      button.append(heading);

      if (result.snippet) {
        const snippet = document.createElement('span');
        snippet.className = 'docs-module__search-snippet';
        snippet.append(highlightMatches(result.snippet, words));
        // One line only: the list stays scannable when a term matches dozens
        // of articles. The full text is one click away.
        snippet.title = result.snippet;
        button.append(snippet);

        if (contentMatch) {
          snippet.classList.add('is-match');
        }
      }

      if (contentMatch && !titleMatch) {
        button.append(this.matchBadge('content'));
      }

      item.append(button);
      list.append(item);
    });

    container.append(list);
  }

  /** Small muted tag saying where the term was found. */
  matchBadge(kind: 'title' | 'content'): HTMLElement {
    const badge = document.createElement('span');
    badge.className = `docs-module__search-badge docs-module__search-badge--${kind}`;
    badge.textContent = this._translate(kind === 'title' ? 'matchInTitle' : 'matchInContent');

    return badge;
  }

  renderEmptyContent(message: string): void {
    const container = this.querySelector<HTMLElement>('.docs-module__content')!;
    const paragraph = document.createElement('p');
    paragraph.className = 'docs-module__empty';
    paragraph.textContent = message;
    container.replaceChildren(paragraph);
    this.querySelector('.docs-module__toc')?.replaceChildren();
  }

  highlightSelection(): void {
    this.querySelectorAll<HTMLElement>('[data-action="select-category"]').forEach((button) => {
      const selected = button.dataset.slug === this._selectedCategory;
      button.classList.toggle('is-active', selected);
      button.toggleAttribute('aria-current', selected);
    });

    this.querySelectorAll<HTMLElement>('[data-action="select-article"]').forEach((button) => {
      const selected = button.dataset.slug === this._selectedArticle;
      button.classList.toggle('is-active', selected);
      button.toggleAttribute('aria-current', selected);
    });
  }

  reflectSelection(): void {
    if (this._selectedCategory) {
      this.setAttribute('category', this._selectedCategory);
    }

    if (this._selectedArticle) {
      this.setAttribute('article', this._selectedArticle);
    } else {
      this.removeAttribute('article');
    }

    if (this._options.syncHash) {
      const hash = [this._selectedCategory, this._selectedArticle]
        .filter(Boolean)
        .map(encodeURIComponent)
        .join('/');
      history.replaceState(null, '', `#${hash}`);
    }
  }

  readHash(): void {
    if (!this._options.syncHash || !location.hash) {
      return;
    }

    const [category, article] = location.hash
      .slice(1)
      .split('/')
      .map(decodeURIComponent);
    this._selectedCategory = category || this._selectedCategory;
    this._selectedArticle = article || this._selectedArticle;
  }

  handleHashChange(): void {
    if (!this._options.syncHash) {
      return;
    }

    const previousCategory = this._selectedCategory;
    this.readHash();

    if (this._selectedCategory !== previousCategory) {
      this.selectCategory(this._selectedCategory, { article: this._selectedArticle });
    } else if (this._selectedArticle) {
      this.selectArticle(this._selectedArticle);
    }
  }

  handleEvent(event: Event): void {
    if (!(event.target instanceof Element)) {
      return;
    }

    const eventTarget = event.target;

    if (event.type === 'submit') {
      event.preventDefault();

      if (!(eventTarget instanceof HTMLFormElement)) {
        return;
      }

      if (eventTarget.matches('.docs-module__search')) {
        const searchInput = eventTarget.elements.namedItem('search') as HTMLInputElement | null;
        this.runSearch(searchInput?.value || '');
      } else if (eventTarget.matches('[data-form="article"]')) {
        this.saveEditor(eventTarget as ArticleFormElement);
      } else if (eventTarget.matches('[data-form="category"]')) {
        this.saveCategory(eventTarget as CategoryFormElement);
      }

      return;
    }

    if (event.type === 'input' && eventTarget.matches('[name="search"]')) {
      if (this._searchTimer !== null) {
        window.clearTimeout(this._searchTimer);
      }

      const searchInput = eventTarget as HTMLInputElement;
      this._searchTimer = window.setTimeout(() => this.runSearch(searchInput.value), 300);
      return;
    }

    // Ahead of the two "mark the form dirty" branches below, which return.
    if (event.type === 'input' && eventTarget.matches('.docs-module__roles-select')) {
      this.addRole(eventTarget as HTMLSelectElement);
      this._dirty = true;
      return;
    }

    if (event.type === 'input' && eventTarget.closest('[data-form="article"]')) {
      this._dirty = true;
      return;
    }

    if (event.type === 'input' && eventTarget.closest('[data-form="category"]')) {
      this._dirty = true;
      return;
    }

    const actionTarget = eventTarget.closest<HTMLElement>('[data-action]');

    if (!actionTarget || !this.contains(actionTarget)) {
      return;
    }

    const action = actionTarget.dataset.action;

    if (action === 'select-category') {
      this.selectCategory(actionTarget.dataset.slug || '');
    } else if (action === 'select-article') {
      this.selectArticle(actionTarget.dataset.slug || '');
    } else if (action === 'search-result') {
      this.selectCategory(actionTarget.dataset.category || '', {
        article: actionTarget.dataset.article || ''
      });
    } else if (action === 'create-category' && this._capabilities.can?.create_category) {
      this.renderCategoryForm();
    } else if (action === 'create-article' && this._capabilities.can?.create_article) {
      this.renderEditor('create');
    } else if (action === 'edit-category') {
      const category = flattenCategories(this._categories)
        .find((item) => String(item.id) === actionTarget.dataset.id);

      if (category?.can?.update) {
        this.renderCategoryForm(category);
      }
    } else if (action === 'remove-role') {
      this.removeRole(actionTarget);
      this._dirty = true;
    } else if (action === 'edit') {
      this.renderEditor('edit');
    } else if (action === 'toggle-publish') {
      this.togglePublish();
    } else if (action === 'delete-article') {
      this.deleteArticle(actionTarget.dataset.id || '');
    } else if (action === 'delete-category') {
      this.deleteCategory(actionTarget.dataset.id || '');
    } else if (action === 'cancel-edit') {
      // Against the stored article, which cancelling goes back to. On a new
      // article there is nothing stored, so every upload of the session goes.
      this.discardUnusedUploads(this._creating ? null : this._article?.content);
      this._editing = false;
      this._creating = false;
      this._dirty = false;
      this.destroyEditor();
      this.renderArticle();
    } else if (action === 'cancel-category') {
      this._editing = false;
      this._dirty = false;

      if (this._article) {
        this.renderArticle();
      } else {
        this.renderEmptyContent(
          this._selectedCategory
            ? this._translate('emptyArticles')
            : this._translate('emptyCategories')
        );
      }
    } else if (action === 'toggle-navigation') {
      const navigation = this.querySelector<HTMLElement>('.docs-module__navigation');

      if (!navigation) {
        return;
      }
      const expanded = navigation.classList.toggle('is-open');
      actionTarget.setAttribute('aria-expanded', String(expanded));
    } else if (action === 'scroll-heading') {
      this.querySelector(`#${actionTarget.dataset.heading}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  }

  emitNavigation(): void {
    const detail = {
      category: this._selectedCategory,
      article: this._selectedArticle
    };
    this.dispatchEvent(new CustomEvent('docs:navigate', { bubbles: true, detail }));
  }

  emitChange(): void {
    this.dispatchEvent(new CustomEvent('docs:change', {
      bubbles: true,
      detail: { article: this._article }
    }));
  }

  emitCreate(): void {
    this.dispatchEvent(new CustomEvent('docs:create', {
      bubbles: true,
      detail: { article: this._article }
    }));
  }

  emitCategoryCreate(category: DocsCategory): void {
    this.dispatchEvent(new CustomEvent('docs:category-create', {
      bubbles: true,
      detail: { category }
    }));
  }

  emitArticleDelete(article: DocsArticle): void {
    this.dispatchEvent(new CustomEvent('docs:delete', {
      bubbles: true,
      detail: { article }
    }));
  }

  emitCategoryDelete(category: DocsCategory): void {
    this.dispatchEvent(new CustomEvent('docs:category-delete', {
      bubbles: true,
      detail: { category }
    }));
  }

  handleBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this._dirty) {
      return;
    }

    event.preventDefault();
    event.returnValue = '';
  }

  setBusy(isBusy: boolean): void {
    this.toggleAttribute('aria-busy', isBusy);
  }

  announce(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
    const status = this.querySelector<HTMLElement>('.docs-module__status')!;
    if (this._statusTimer !== null) {
      window.clearTimeout(this._statusTimer);
    }

    this._statusTimer = null;
    status.textContent = message;
    status.dataset.type = type;

    if (type === 'success') {
      this._statusTimer = window.setTimeout(this._boundClearAnnouncement, 2000);
    }
  }

  clearAnnouncement(): void {
    const status = this.querySelector<HTMLElement>('.docs-module__status');

    if (status?.dataset.type === 'success') {
      status.textContent = '';
      delete status.dataset.type;
    }

    this._statusTimer = null;
  }

  showError(message: string): void {
    if (!this.querySelector('.docs-module__content')) {
      this.textContent = message;
      return;
    }

    this.renderEmptyContent(message);
    this.announce(message, 'error');
  }

  /**
   * Reports a failed action without clearing the reading pane.
   *
   * A refused delete — a category that still holds articles — changes nothing
   * on screen, so replacing the open article with the error text would lose
   * the reader's place for no reason.
   */
  announceError(error: unknown, fallbackMessage: string): void {
    const message = error instanceof DocsApiError ? error.message : fallbackMessage;
    this.announce(message || fallbackMessage, 'error');
    this.dispatchEvent(new CustomEvent('docs:error', {
      bubbles: true,
      detail: { error }
    }));
  }

  handleError(error: unknown, fallbackMessage: string): void {
    const message = error instanceof DocsApiError ? error.message : fallbackMessage;
    this.showError(message || fallbackMessage);
    this.dispatchEvent(new CustomEvent('docs:error', {
      bubbles: true,
      detail: { error }
    }));
  }
}

export function defineDocsElement(tagName = 'databis-docs'): CustomElementConstructor {
  if (!globalThis.customElements) {
    return DatabisDocsElement;
  }

  if (!globalThis.customElements.get(tagName)) {
    globalThis.customElements.define(tagName, DatabisDocsElement);
  }

  return globalThis.customElements.get(tagName) || DatabisDocsElement;
}
