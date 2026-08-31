import type { Editor, Extensions, JSONContent } from '@tiptap/core';

export type AuthTokenProvider = () => string | null | Promise<string | null>;
export type Translate = (key: string) => string;
export type Identifier = string | number;

export interface DocsRecord {
  [key: string]: unknown;
}

export interface DocsResourceActions {
  update?: boolean;
  delete?: boolean;
  publish?: boolean;
}

export interface DocsCategory extends DocsRecord {
  id: number;
  parent_id: number | null;
  name: string;
  slug: string;
  description?: string | null;
  order?: number;
  is_published?: boolean;
  updated_at?: string;
  articles_count?: number;
  depth?: number;
  children?: DocsCategory[];
  can?: DocsResourceActions;
}

export interface DocsArticle extends DocsRecord {
  id: number;
  doc_category_id: number;
  title: string;
  slug: string;
  excerpt?: string | null;
  order?: number;
  locale: string;
  is_published: boolean;
  published_at?: string | null;
  content?: TiptapDocument;
  updated_at?: string;
  category?: Pick<DocsCategory, 'id' | 'name' | 'slug'> | null;
  can?: DocsResourceActions;
}

export interface DocsRevision extends DocsRecord {
  id: number;
  doc_article_id: number;
  title: string;
  content: TiptapDocument;
  edited_by?: number | null;
  created_at: string;
}

export interface DocsImageResource extends DocsRecord {
  id: number;
  doc_article_id?: number | null;
  path: string;
  url: string | null;
  original_name?: string;
  mime_type?: string;
  size?: number;
  alt?: string | null;
  width?: number | null;
  height?: number | null;
}

export interface DocsLocalData {
  version: number;
  counters: {
    category: number;
    article: number;
    revision: number;
    image: number;
  };
  categories: DocsCategory[];
  articles: DocsArticle[];
  revisions: DocsRevision[];
  images: DocsImageResource[];
}

export interface DocsCapabilities {
  authenticated: boolean;
  is_admin: boolean;
  can: {
    create_category: boolean;
    create_article: boolean;
    view_drafts: boolean;
  };
}

export interface DocsModuleOptions {
  baseURL?: string;
  storageBaseURL?: string;
  locale?: string;
  messages?: Record<string, string>;
  /** Base color used to derive the complete UI palette. Defaults to #3176A1. */
  primaryColor?: string;
  credentials?: RequestCredentials;
  getAuthToken?: AuthTokenProvider | null;
  /** Cookie authentication: defaults to XSRF-TOKEN. */
  xsrfCookieName?: string;
  /** Cookie authentication: defaults to X-XSRF-TOKEN. */
  xsrfHeaderName?: string;
  /** Override cookie reading, useful outside a browser. */
  getXsrfToken?: AuthTokenProvider | null;
  /** Set false to disable automatic XSRF headers on write requests. */
  withXsrfToken?: boolean;
  headers?: HeadersInit;
  fetch?: typeof fetch;
  expectedApiVersion?: string | number;
  syncHash?: boolean;
  autoSelectFirstArticle?: boolean;
  /** Uses LocalWorker and prevents every HTTP request. */
  testing?: boolean;
  /** Defaults to localStorage. Use "global" or false to store on globalThis. */
  testingStorage?: Storage | 'localStorage' | 'global' | false;
  testingStorageKey?: string;
  testingGlobalKey?: string;
  testingGlobalScope?: Record<string, unknown>;
  /** Initial content, only used when the selected testing storage is empty. */
  testingData?: Partial<DocsLocalData>;
}

export interface ResolvedDocsModuleOptions extends DocsModuleOptions {
  baseURL: string;
  storageBaseURL: string;
  locale: string;
  messages: Record<string, string>;
  primaryColor: string;
  credentials: RequestCredentials;
  getAuthToken: AuthTokenProvider | null;
  syncHash: boolean;
  autoSelectFirstArticle: boolean;
  testing: boolean;
}

export interface DocsRequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal | null;
  locale?: string;
  page?: number;
  perPage?: number;
  drafts?: boolean;
  articleId?: Identifier;
  alt?: string;
}

export interface DocsCategoryInput extends DocsRecord {
  name?: string;
  slug?: string;
  parent_id?: Identifier | null;
  description?: string | null;
  order?: number;
  is_published?: boolean;
}

export interface DocsArticleInput extends DocsRecord {
  doc_category_id?: Identifier;
  title?: string;
  slug?: string;
  excerpt?: string | null;
  order?: number;
  locale?: string;
  is_published?: boolean;
  content?: TiptapDocument;
  updated_at?: string;
}

export interface DocsApiErrorOptions {
  status?: number;
  data?: unknown;
  response?: Response;
}

export interface DocsNavigationDetail {
  category: string;
  article: string;
}

export interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface TiptapDocument extends JSONContent {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: TiptapDocument[];
  marks?: TiptapMark[];
  text?: string;
}

export interface TiptapHeading {
  id: string;
  level: number;
  label: string;
}

export interface ArticleEditorOptions {
  mount: HTMLElement;
  content?: TiptapDocument;
  storageBaseURL?: string;
  /** Receives the picked, pasted or dropped file and resolves to the stored image. */
  uploadImage?: ((file: File) => Promise<DocsImageResource>) | null;
  translate?: Translate;
  onUpdate?: (() => void) | null;
  onError?: ((error: unknown) => void) | null;
}

export interface EditorExtensionOptions {
  storageBaseURL?: string;
  uploadImage?: ((file: File) => Promise<DocsImageResource>) | null;
  onError?: ((error: unknown) => void) | null;
}

export interface ArticleEditor {
  /** The underlying TipTap editor, for commands this package does not wrap. */
  editor: Editor;
  getJSON(): TiptapDocument;
  focus(): void;
  destroy(): void;
}

export type DocsEditorExtensions = Extensions;

export interface RenderTiptapOptions {
  storageBaseURL?: string;
  className?: string;
}

export interface RenderTiptapResult {
  element: HTMLDivElement;
  headings: TiptapHeading[];
}

export interface DocsSearchResult extends DocsRecord {
  id: number;
  title: string;
  slug: string;
  locale: string;
  snippet: string;
  title_match?: boolean;
  content_match?: boolean;
  category: Pick<DocsCategory, 'id' | 'name' | 'slug'> | null;
}

export interface DocsCollectionResponse<T> {
  data: T[];
  meta: {
    total: number;
    per_page: number;
    current_page: number;
    last_page: number;
  };
}

export interface SelectionOptions {
  updateHash?: boolean;
  selectFirstArticle?: boolean;
}

export interface CategorySelectionOptions {
  article?: string;
  keepArticle?: boolean;
  silent?: boolean;
}

export interface ArticleSelectionOptions {
  silent?: boolean;
}

export interface DocsClient {
  getCategories(options?: DocsRequestOptions): Promise<unknown>;
  getArticles(categorySlug: string, options?: DocsRequestOptions): Promise<unknown>;
  getArticle(
    categorySlug: string,
    articleSlug: string,
    options?: DocsRequestOptions
  ): Promise<unknown>;
  getCapabilities(options?: DocsRequestOptions): Promise<unknown>;
  search(term: string, options?: DocsRequestOptions): Promise<unknown>;
  createCategory(
    category: DocsCategoryInput,
    options?: DocsRequestOptions
  ): Promise<unknown>;
  deleteCategory(id: number, options?: DocsRequestOptions): Promise<unknown>;
  createArticle(article: DocsArticleInput, options?: DocsRequestOptions): Promise<unknown>;
  updateArticle(
    id: number,
    article: DocsArticleInput,
    options?: DocsRequestOptions
  ): Promise<unknown>;
  deleteArticle(id: number, options?: DocsRequestOptions): Promise<unknown>;
  publishArticle(
    id: number,
    isPublished: boolean,
    options?: DocsRequestOptions
  ): Promise<unknown>;
  uploadImage(file: File, options?: DocsRequestOptions): Promise<unknown>;
}

export type LocalCounterName = keyof DocsLocalData['counters'];
