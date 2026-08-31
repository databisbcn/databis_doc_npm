import { DocsApiError } from './api-client.js';
import { emptyDocument } from './schema.js';
import type {
  DocsArticle,
  DocsArticleInput,
  DocsCategory,
  DocsCategoryInput,
  DocsClient,
  DocsCollectionResponse,
  DocsImageResource,
  DocsLocalData,
  DocsModuleOptions,
  DocsRecord,
  DocsRequestOptions,
  DocsRevision,
  DocsSearchResult,
  Identifier,
  LocalCounterName,
  TiptapDocument
} from './types.js';

export const defaultLocalStorageKey = '@databis/docs-module/testing';
export const defaultLocalGlobalKey = '__DATBIS_DOCS_MODULE_TESTING__';

function cloneValue<T>(value: T): T {
  if (value === undefined) {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function maximumId(records: Array<{ id: number }>): number {
  return records.reduce((maximum, record) => Math.max(maximum, Number(record.id) || 0), 0);
}

function normalizeLocalData(value: Partial<DocsLocalData> = {}): DocsLocalData {
  const categories = Array.isArray(value.categories) ? cloneValue(value.categories) : [];
  const articles = Array.isArray(value.articles) ? cloneValue(value.articles) : [];
  const revisions = Array.isArray(value.revisions) ? cloneValue(value.revisions) : [];
  const images = Array.isArray(value.images) ? cloneValue(value.images) : [];

  return {
    version: 1,
    counters: {
      category: Math.max(Number(value.counters?.category) || 0, maximumId(categories)),
      article: Math.max(Number(value.counters?.article) || 0, maximumId(articles)),
      revision: Math.max(Number(value.counters?.revision) || 0, maximumId(revisions)),
      image: Math.max(Number(value.counters?.image) || 0, maximumId(images))
    },
    categories,
    articles,
    revisions,
    images
  };
}

function slugify(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'item';
}

function uniqueSlug<T extends { id: number; slug: string }>(
  value: unknown,
  records: T[],
  excludeId: Identifier | null,
  matchesScope: (record: T) => boolean
): string {
  const base = slugify(value);
  let candidate = base;
  let suffix = 2;

  while (records.some((record) => (
    Number(record.id) !== Number(excludeId)
    && matchesScope(record)
    && record.slug === candidate
  ))) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function compareOrder(
  first: { id: number; order?: number },
  second: { id: number; order?: number }
): number {
  const orderDifference = (Number(first.order) || 0) - (Number(second.order) || 0);
  return orderDifference || (Number(first.id) || 0) - (Number(second.id) || 0);
}

function extractDocumentText(node?: TiptapDocument): string {
  if (!node || typeof node !== 'object') {
    return '';
  }

  if (node.type === 'text') {
    return node.text || '';
  }

  return (node.content || []).map(extractDocumentText).join(' ');
}

/**
 * Search terms are compared without accents and without case: "instalacion"
 * has to find "Instalación", which is what people actually type.
 */
function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();
}

function searchWords(term: string): string[] {
  return normalizeForSearch(String(term || ''))
    .split(/\s+/)
    .filter(Boolean);
}

/** Collapses newlines and runs of spaces so a snippet always fits on one line. */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * A window of text around the first matching word, so the result shows why it
 * matched instead of just that it did.
 */
function buildSnippet(text: string, words: string[], length = 160): string {
  const collapsed = collapseWhitespace(text);

  if (!collapsed) {
    return '';
  }

  const haystack = normalizeForSearch(collapsed);
  const position = words
    .map((word) => haystack.indexOf(word))
    .filter((index) => index >= 0)
    .sort((first, second) => first - second)[0];

  if (position === undefined) {
    return collapsed.length > length ? `${collapsed.slice(0, length).trim()}…` : collapsed;
  }

  const start = Math.max(0, position - Math.round(length / 3));
  const snippet = collapsed.slice(start, start + length).trim();

  return `${start > 0 ? '…' : ''}${snippet}${start + length < collapsed.length ? '…' : ''}`;
}

function localError(message: string, status: number, data: DocsRecord = {}): DocsApiError {
  return new DocsApiError(message, {
    status,
    data: { message, ...data }
  });
}

async function fileToDataURL(file: File): Promise<string> {
  if (!file?.arrayBuffer || !file.type?.startsWith('image/')) {
    throw localError('Testing image uploads require an image File.', 422);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  if (typeof globalThis.btoa !== 'function') {
    throw localError('This environment cannot encode testing images.', 500);
  }

  return `data:${file.type};base64,${globalThis.btoa(binary)}`;
}

export function createLocalData(value: Partial<DocsLocalData> = {}): DocsLocalData {
  return normalizeLocalData(value);
}

export class LocalWorker implements DocsClient {
  private storageKey: string;
  private globalKey: string;
  private globalScope: Record<string, unknown>;
  private storage: Storage | null;
  private _data: DocsLocalData;

  constructor(options: DocsModuleOptions = {}) {
    this.storageKey = options.testingStorageKey || defaultLocalStorageKey;
    this.globalKey = options.testingGlobalKey || defaultLocalGlobalKey;
    this.globalScope = options.testingGlobalScope || globalThis;
    this.storage = this.resolveStorage(options.testingStorage);

    const storedData = this.readStoredData();
    const initialData = storedData ?? options.testingData ?? {};
    this._data = normalizeLocalData(initialData);
    this.persist();
  }

  resolveStorage(testingStorage: DocsModuleOptions['testingStorage']): Storage | null {
    if (testingStorage === 'global' || testingStorage === false) {
      return null;
    }

    if (
      testingStorage
      && testingStorage !== 'localStorage'
      && typeof testingStorage.getItem === 'function'
    ) {
      return testingStorage;
    }

    try {
      return globalThis.localStorage || null;
    } catch {
      return null;
    }
  }

  readStoredData(): Partial<DocsLocalData> | null {
    if (!this.storage) {
      return (this.globalScope[this.globalKey] as Partial<DocsLocalData> | undefined) || null;
    }

    try {
      const serialized = this.storage.getItem(this.storageKey);
      return serialized ? JSON.parse(serialized) : null;
    } catch {
      return (this.globalScope[this.globalKey] as Partial<DocsLocalData> | undefined) || null;
    }
  }

  persist(): void {
    if (this.storage) {
      try {
        this.storage.setItem(this.storageKey, JSON.stringify(this._data));
        return;
      } catch {
        this.storage = null;
      }
    }

    this.globalScope[this.globalKey] = this._data;
  }

  get data(): DocsLocalData {
    return cloneValue(this._data);
  }

  reset(value: Partial<DocsLocalData> = {}): DocsLocalData {
    this._data = normalizeLocalData(value);
    this.persist();
    return this.data;
  }

  nextId(type: LocalCounterName): number {
    this._data.counters[type] += 1;
    return this._data.counters[type];
  }

  findCategoryById(id: Identifier): DocsCategory | null {
    return this._data.categories.find((category) => Number(category.id) === Number(id)) || null;
  }

  findCategoryBySlug(slug: string): DocsCategory | null {
    return this._data.categories.find((category) => category.slug === slug) || null;
  }

  findArticleById(id: Identifier): DocsArticle | null {
    return this._data.articles.find((article) => Number(article.id) === Number(id)) || null;
  }

  categoryResource(category: DocsCategory, children: DocsCategory[] = []): DocsCategory {
    const articlesCount = this._data.articles.filter((article) => (
      Number(article.doc_category_id) === Number(category.id)
    )).length;

    return {
      ...cloneValue(category),
      articles_count: articlesCount,
      children,
      can: {
        update: true,
        delete: true
      }
    };
  }

  articleResource(article: DocsArticle, includeContent = true): DocsArticle {
    const category = this.findCategoryById(article.doc_category_id);
    const resource = {
      ...cloneValue(article),
      category: category
        ? {
            id: category.id,
            name: category.name,
            slug: category.slug
          }
        : null,
      can: {
        update: true,
        delete: true,
        publish: true
      }
    };

    if (!includeContent) {
      delete resource.content;
    }

    return resource;
  }

  categoryTree(
    parentId: Identifier | null = null,
    visitedIds: Set<number> = new Set<number>()
  ): DocsCategory[] {
    return this._data.categories
      .filter((category) => (
        parentId === null
          ? category.parent_id === null || category.parent_id === undefined
          : Number(category.parent_id) === Number(parentId)
      ))
      .sort(compareOrder)
      .filter((category) => !visitedIds.has(Number(category.id)))
      .map((category) => {
        const branchIds = new Set(visitedIds);
        branchIds.add(Number(category.id));
        return this.categoryResource(category, this.categoryTree(category.id, branchIds));
      });
  }

  async getCategories(): Promise<{ data: DocsCategory[] }> {
    return { data: this.categoryTree() };
  }

  async getCategory(slug: string): Promise<{ data: DocsCategory }> {
    const category = this.findCategoryBySlug(slug);

    if (!category) {
      throw localError('Category not found.', 404);
    }

    return {
      data: this.categoryResource(category, this.categoryTree(category.id))
    };
  }

  async getArticles(
    categorySlug: string,
    options: DocsRequestOptions = {}
  ): Promise<DocsCollectionResponse<DocsArticle>> {
    const category = this.findCategoryBySlug(categorySlug);

    if (!category) {
      throw localError('Category not found.', 404);
    }

    const articles = this._data.articles
      .filter((article) => Number(article.doc_category_id) === Number(category.id))
      .filter((article) => !options.locale || article.locale === options.locale)
      .filter((article) => options.drafts || article.is_published)
      .sort(compareOrder)
      .map((article) => this.articleResource(article, false));

    return {
      data: articles,
      meta: {
        total: articles.length,
        per_page: articles.length,
        current_page: 1,
        last_page: 1
      }
    };
  }

  async getArticle(
    categorySlug: string,
    articleSlug: string,
    options: DocsRequestOptions = {}
  ): Promise<{ data: DocsArticle }> {
    const category = this.findCategoryBySlug(categorySlug);
    const article = this._data.articles.find((candidate) => (
      candidate.slug === articleSlug
      && Number(candidate.doc_category_id) === Number(category?.id)
      && (!options.locale || candidate.locale === options.locale)
    ));

    if (!article) {
      throw localError('Article not found.', 404);
    }

    return { data: this.articleResource(article) };
  }

  async getCapabilities(): Promise<DocsRecord> {
    return {
      data: {
        authenticated: true,
        is_admin: true,
        can: {
          create_category: true,
          create_article: true,
          view_drafts: true
        }
      }
    };
  }

  async search(
    term: string,
    options: DocsRequestOptions = {}
  ): Promise<DocsCollectionResponse<DocsSearchResult>> {
    const words = searchWords(term);

    if (!words.length) {
      return { data: [], meta: { total: 0, per_page: 0, current_page: 1, last_page: 1 } };
    }

    const results = this._data.articles
      .filter((article) => article.is_published)
      .filter((article) => !options.locale || article.locale === options.locale)
      .map((article) => {
        const title = normalizeForSearch(article.title || '');
        const body = [article.excerpt, extractDocumentText(article.content)]
          .filter(Boolean)
          .join(' ');
        const content = normalizeForSearch(body);

        // Every word has to appear somewhere in the article, but each one is
        // free to appear in the title or in the body. Requiring them all in
        // the same field is what made multi-word searches come back empty.
        const matchesAll = words.every((word) => title.includes(word) || content.includes(word));

        if (!matchesAll) {
          return null;
        }

        return {
          article,
          body,
          titleMatch: words.some((word) => title.includes(word)),
          contentMatch: words.some((word) => content.includes(word))
        };
      })
      .filter((match): match is NonNullable<typeof match> => match !== null)
      // Title hits first: they are the ones people are usually looking for.
      .sort((first, second) => {
        const byTitle = Number(second.titleMatch) - Number(first.titleMatch);
        return byTitle || compareOrder(first.article, second.article);
      })
      .map(({ article, body, titleMatch, contentMatch }) => {
        const category = this.findCategoryById(article.doc_category_id);

        return {
          id: article.id,
          title: article.title,
          slug: article.slug,
          locale: article.locale,
          snippet: buildSnippet(body, words),
          title_match: titleMatch,
          content_match: contentMatch,
          category: category
            ? {
                id: category.id,
                name: category.name,
                slug: category.slug
              }
            : null
        };
      });

    return {
      data: results,
      meta: {
        total: results.length,
        per_page: results.length,
        current_page: 1,
        last_page: 1
      }
    };
  }

  async createCategory(categoryData: DocsCategoryInput): Promise<{ data: DocsCategory }> {
    const name = String(categoryData.name || '').trim();

    if (!name) {
      throw localError('The category name is required.', 422, {
        errors: { name: ['Required'] }
      });
    }

    if (categoryData.parent_id && !this.findCategoryById(categoryData.parent_id)) {
      throw localError('The parent category does not exist.', 422);
    }

    const now = new Date().toISOString();
    const category = {
      id: this.nextId('category'),
      parent_id: categoryData.parent_id ? Number(categoryData.parent_id) : null,
      name,
      slug: uniqueSlug(
        categoryData.slug || name,
        this._data.categories,
        null,
        () => true
      ),
      description: categoryData.description || null,
      order: Number.isFinite(Number(categoryData.order))
        ? Number(categoryData.order)
        : this._data.categories.length,
      is_published: categoryData.is_published !== false,
      updated_at: now
    };

    this._data.categories.push(category);
    this.persist();
    return { data: this.categoryResource(category) };
  }

  async updateCategory(
    id: number,
    categoryData: DocsCategoryInput
  ): Promise<{ data: DocsCategory }> {
    const category = this.findCategoryById(id);

    if (!category) {
      throw localError('Category not found.', 404);
    }

    if (categoryData.parent_id && !this.findCategoryById(categoryData.parent_id)) {
      throw localError('The parent category does not exist.', 422);
    }

    if (categoryData.name !== undefined) {
      const name = String(categoryData.name).trim();

      if (!name) {
        throw localError('The category name is required.', 422);
      }

      category.name = name;
    }

    ['description', 'order', 'is_published'].forEach((key) => {
      if (categoryData[key] !== undefined) {
        category[key] = categoryData[key];
      }
    });

    if (categoryData.parent_id !== undefined) {
      category.parent_id = categoryData.parent_id ? Number(categoryData.parent_id) : null;
    }

    if (categoryData.slug !== undefined) {
      category.slug = uniqueSlug(
        categoryData.slug,
        this._data.categories,
        category.id,
        () => true
      );
    }

    category.updated_at = new Date().toISOString();
    this.persist();
    return { data: this.categoryResource(category, this.categoryTree(category.id)) };
  }

  async deleteCategory(id: number): Promise<null> {
    const category = this.findCategoryById(id);

    if (!category) {
      throw localError('Category not found.', 404);
    }

    const articlesCount = this._data.articles.filter((article) => (
      Number(article.doc_category_id) === Number(category.id)
    )).length;
    const childrenCount = this._data.categories.filter((candidate) => (
      Number(candidate.parent_id) === Number(category.id)
    )).length;

    if (articlesCount > 0 || childrenCount > 0) {
      throw localError('The category must be empty before it can be deleted.', 422, {
        errors: {
          articles_count: articlesCount,
          children_count: childrenCount
        }
      });
    }

    this._data.categories = this._data.categories.filter((candidate) => (
      Number(candidate.id) !== Number(id)
    ));
    this.persist();
    return null;
  }

  async reorderCategories(ids: number[]): Promise<{ message: string }> {
    ids.forEach((id, order) => {
      const category = this.findCategoryById(id);

      if (category) {
        category.order = order;
      }
    });
    this.persist();
    return { message: 'Category order updated.' };
  }

  async createArticle(articleData: DocsArticleInput): Promise<{ data: DocsArticle }> {
    const category = articleData.doc_category_id === undefined
      ? null
      : this.findCategoryById(articleData.doc_category_id);
    const title = String(articleData.title || '').trim();

    if (!category || !title) {
      throw localError('The article title and category are required.', 422);
    }

    const locale = articleData.locale || 'es';
    const now = new Date().toISOString();
    const article = {
      id: this.nextId('article'),
      doc_category_id: Number(category.id),
      title,
      slug: uniqueSlug(
        articleData.slug || title,
        this._data.articles,
        null,
        (candidate) => (
          Number(candidate.doc_category_id) === Number(category.id)
          && candidate.locale === locale
        )
      ),
      excerpt: articleData.excerpt || null,
      order: Number.isFinite(Number(articleData.order))
        ? Number(articleData.order)
        : this._data.articles.filter((candidate) => (
            Number(candidate.doc_category_id) === Number(category.id)
          )).length,
      locale,
      is_published: articleData.is_published === true,
      published_at: articleData.is_published ? now : null,
      content: cloneValue(articleData.content || emptyDocument()),
      updated_at: now
    };

    this._data.articles.push(article);
    this.persist();
    return { data: this.articleResource(article) };
  }

  async updateArticle(
    id: number,
    articleData: DocsArticleInput
  ): Promise<{ data: DocsArticle }> {
    const article = this.findArticleById(id);

    if (!article) {
      throw localError('Article not found.', 404);
    }

    if (
      article.updated_at
      && articleData.updated_at
      && article.updated_at !== articleData.updated_at
    ) {
      throw localError('The article has changed since it was loaded.', 409, {
        current: this.articleResource(article)
      });
    }

    const categoryId = articleData.doc_category_id ?? article.doc_category_id;
    const category = this.findCategoryById(categoryId);
    const title = articleData.title === undefined
      ? article.title
      : String(articleData.title).trim();

    if (!category || !title) {
      throw localError('The article title and category are required.', 422);
    }

    this._data.revisions.push({
      id: this.nextId('revision'),
      doc_article_id: article.id,
      title: article.title,
      content: cloneValue(article.content || emptyDocument()),
      edited_by: null,
      created_at: new Date().toISOString()
    });

    article.doc_category_id = Number(category.id);
    article.title = title;

    ['excerpt', 'order', 'locale', 'content'].forEach((key) => {
      if (articleData[key] !== undefined) {
        article[key] = cloneValue(articleData[key]);
      }
    });

    article.updated_at = new Date().toISOString();
    this.persist();
    return { data: this.articleResource(article) };
  }

  async deleteArticle(id: number): Promise<null> {
    const article = this.findArticleById(id);

    if (!article) {
      throw localError('Article not found.', 404);
    }

    this._data.articles = this._data.articles.filter((candidate) => (
      Number(candidate.id) !== Number(id)
    ));
    this._data.revisions = this._data.revisions.filter((revision) => (
      Number(revision.doc_article_id) !== Number(id)
    ));
    this.persist();
    return null;
  }

  async publishArticle(
    id: number,
    isPublished: boolean
  ): Promise<{ data: DocsArticle }> {
    const article = this.findArticleById(id);

    if (!article) {
      throw localError('Article not found.', 404);
    }

    article.is_published = Boolean(isPublished);
    article.published_at = article.is_published ? new Date().toISOString() : null;
    article.updated_at = new Date().toISOString();
    this.persist();
    return { data: this.articleResource(article) };
  }

  async getArticlePreview(id: number): Promise<{ data: DocsArticle }> {
    const article = this.findArticleById(id);

    if (!article) {
      throw localError('Article not found.', 404);
    }

    return { data: this.articleResource(article) };
  }

  async getRevisions(id: number): Promise<DocsCollectionResponse<Partial<DocsRevision>>> {
    const revisions = this._data.revisions
      .filter((revision) => Number(revision.doc_article_id) === Number(id))
      .sort((first, second) => second.id - first.id)
      .map((revision) => {
        const resource: Partial<DocsRevision> = cloneValue(revision);
        delete resource.content;
        return resource;
      });

    return {
      data: revisions,
      meta: {
        total: revisions.length,
        per_page: revisions.length,
        current_page: 1,
        last_page: 1
      }
    };
  }

  async restoreRevision(
    articleId: number,
    revisionId: number
  ): Promise<{ data: DocsArticle }> {
    const article = this.findArticleById(articleId);
    const revision = this._data.revisions.find((candidate) => (
      Number(candidate.id) === Number(revisionId)
      && Number(candidate.doc_article_id) === Number(articleId)
    ));

    if (!article || !revision) {
      throw localError('Article revision not found.', 404);
    }

    this._data.revisions.push({
      id: this.nextId('revision'),
      doc_article_id: article.id,
      title: article.title,
      content: cloneValue(article.content || emptyDocument()),
      edited_by: null,
      created_at: new Date().toISOString()
    });
    article.title = revision.title;
    article.content = cloneValue(revision.content);
    article.updated_at = new Date().toISOString();
    this.persist();
    return { data: this.articleResource(article) };
  }

  async uploadImage(
    file: File,
    options: DocsRequestOptions = {}
  ): Promise<{ data: DocsImageResource }> {
    const dataURL = await fileToDataURL(file);
    const image = {
      id: this.nextId('image'),
      doc_article_id: options.articleId ? Number(options.articleId) : null,
      path: dataURL,
      url: dataURL,
      original_name: file.name,
      mime_type: file.type,
      size: file.size,
      width: null,
      height: null,
      alt: options.alt || null
    };

    this._data.images.push(image);
    this.persist();
    return { data: cloneValue(image) };
  }

  async deleteImage(id: number): Promise<null> {
    const imageExists = this._data.images.some((image) => Number(image.id) === Number(id));

    if (!imageExists) {
      throw localError('Image not found.', 404);
    }

    this._data.images = this._data.images.filter((image) => Number(image.id) !== Number(id));
    this.persist();
    return null;
  }
}
