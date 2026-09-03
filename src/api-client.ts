import type {
  DocsApiErrorOptions,
  DocsArticleInput,
  DocsCategoryInput,
  DocsClient,
  DocsModuleOptions,
  DocsRecord,
  DocsRequestOptions
} from './types.js';

export class DocsApiError extends Error {
  readonly status: number;
  readonly data: unknown;
  readonly response?: Response;

  constructor(message: string, options: DocsApiErrorOptions = {}) {
    super(message);
    this.name = 'DocsApiError';
    this.status = options.status || 0;
    this.data = options.data;
    this.response = options.response;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function createQueryString(parameters: Record<string, unknown>): string {
  const query = new URLSearchParams();

  Object.entries(parameters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });

  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

function readCookie(name: string): string | null {
  if (!globalThis.document?.cookie) {
    return null;
  }

  const prefix = `${encodeURIComponent(name)}=`;
  const cookie = globalThis.document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  if (!cookie) {
    return null;
  }

  const value = cookie.slice(prefix.length);

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function requiresXsrfToken(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

export class DocsApiClient implements DocsClient {
  readonly baseURL: string;
  readonly getAuthToken: DocsModuleOptions['getAuthToken'];
  readonly credentials: RequestCredentials;
  readonly headers: HeadersInit;
  readonly fetch: typeof fetch;
  readonly expectedApiVersion: string;
  readonly xsrfCookieName: string;
  readonly xsrfHeaderName: string;
  readonly getXsrfToken: DocsModuleOptions['getXsrfToken'];
  readonly withXsrfToken: boolean;

  constructor(options: DocsModuleOptions = {}) {
    if (!options.baseURL) {
      throw new TypeError('DocsApiClient requires a baseURL.');
    }

    this.baseURL = trimTrailingSlash(options.baseURL);
    this.getAuthToken = options.getAuthToken || null;
    this.credentials = options.credentials || 'include';
    this.headers = options.headers || {};
    const fetchImplementation = options.fetch || globalThis.fetch?.bind(globalThis);
    this.expectedApiVersion = String(options.expectedApiVersion || '1');
    this.xsrfCookieName = options.xsrfCookieName || 'XSRF-TOKEN';
    this.xsrfHeaderName = options.xsrfHeaderName || 'X-XSRF-TOKEN';
    this.getXsrfToken = options.getXsrfToken || null;
    this.withXsrfToken = options.withXsrfToken !== false;

    if (!fetchImplementation) {
      throw new TypeError('No fetch implementation is available.');
    }

    this.fetch = fetchImplementation;
  }

  async request<T = unknown>(path: string, options: DocsRequestOptions = {}): Promise<T> {
    const method = options.method || 'GET';
    const token = this.getAuthToken ? await this.getAuthToken() : null;
    const headers = new Headers(this.headers);
    const isFormData = options.body instanceof FormData;

    headers.set('Accept', 'application/json');

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    if (
      this.withXsrfToken
      && requiresXsrfToken(method)
      && !headers.has(this.xsrfHeaderName)
    ) {
      const xsrfToken = this.getXsrfToken
        ? await this.getXsrfToken()
        : readCookie(this.xsrfCookieName);

      if (xsrfToken) {
        headers.set(this.xsrfHeaderName, xsrfToken);
      }
    }

    if (options.body !== undefined && !isFormData) {
      headers.set('Content-Type', 'application/json');
    }

    const requestBody: BodyInit | undefined = options.body === undefined
      ? undefined
      : isFormData
        ? options.body as FormData
        : JSON.stringify(options.body);

    const response = await this.fetch(`${this.baseURL}${path}`, {
      method,
      credentials: this.credentials,
      headers,
      signal: options.signal,
      body: requestBody
    });

    const apiVersion = response.headers.get('X-Docs-Api-Version');

    if (apiVersion && apiVersion !== this.expectedApiVersion) {
      console.warn(
        `@databis/docs-module expects API v${this.expectedApiVersion}, but the server returned v${apiVersion}.`
      );
    }

    const contentType = response.headers.get('content-type') || '';
    const data: unknown = response.status === 204
      ? null
      : contentType.includes('application/json')
        ? await response.json()
        : await response.text();

    if (!response.ok) {
      const errorData = data && typeof data === 'object'
        ? data as { message?: string }
        : null;
      const message = errorData?.message
        || response.statusText
        || 'Documentation API request failed.';
      throw new DocsApiError(message, { status: response.status, data, response });
    }

    return data as T;
  }

  getCategories(options: DocsRequestOptions = {}): Promise<unknown> {
    return this.request(`/categories${createQueryString({ locale: options.locale })}`, options);
  }

  getCategory(slug: string, options: DocsRequestOptions = {}): Promise<unknown> {
    return this.request(`/categories/${encodeURIComponent(slug)}${createQueryString({ locale: options.locale })}`, options);
  }

  getArticles(categorySlug: string, options: DocsRequestOptions = {}): Promise<unknown> {
    const query = createQueryString({
      locale: options.locale,
      page: options.page,
      per_page: options.perPage,
      drafts: options.drafts ? 1 : undefined
    });
    return this.request(`/categories/${encodeURIComponent(categorySlug)}/articles${query}`, options);
  }

  getArticle(
    categorySlug: string,
    articleSlug: string,
    options: DocsRequestOptions = {}
  ): Promise<unknown> {
    const query = createQueryString({ locale: options.locale });
    return this.request(
      `/categories/${encodeURIComponent(categorySlug)}/articles/${encodeURIComponent(articleSlug)}${query}`,
      options
    );
  }

  getCapabilities(options: DocsRequestOptions = {}): Promise<unknown> {
    return this.request('/me/capabilities', options);
  }

  /** Options for the "who sees this" dropdown. Editors only, server-side. */
  getRoles(options: DocsRequestOptions = {}): Promise<unknown> {
    return this.request('/roles', options);
  }

  search(term: string, options: DocsRequestOptions = {}): Promise<unknown> {
    const query = createQueryString({ q: term, locale: options.locale, page: options.page, per_page: options.perPage });
    return this.request(`/search${query}`, options);
  }

  createCategory(category: DocsCategoryInput, options: DocsRequestOptions = {}): Promise<unknown> {
    return this.request('/categories', { ...options, method: 'POST', body: category });
  }

  updateCategory(
    id: number,
    category: DocsRecord,
    options: DocsRequestOptions = {}
  ): Promise<unknown> {
    return this.request(`/categories/${id}`, { ...options, method: 'PUT', body: category });
  }

  deleteCategory(id: number, options: DocsRequestOptions = {}): Promise<unknown> {
    return this.request(`/categories/${id}`, { ...options, method: 'DELETE' });
  }

  reorderCategories(ids: number[], options: DocsRequestOptions = {}): Promise<unknown> {
    return this.request('/categories/reorder', { ...options, method: 'POST', body: { ids } });
  }

  createArticle(article: DocsArticleInput, options: DocsRequestOptions = {}): Promise<unknown> {
    return this.request('/articles', { ...options, method: 'POST', body: article });
  }

  updateArticle(
    id: number,
    article: DocsArticleInput,
    options: DocsRequestOptions = {}
  ): Promise<unknown> {
    return this.request(`/articles/${id}`, { ...options, method: 'PUT', body: article });
  }

  deleteArticle(id: number, options: DocsRequestOptions = {}): Promise<unknown> {
    return this.request(`/articles/${id}`, { ...options, method: 'DELETE' });
  }

  publishArticle(
    id: number,
    isPublished: boolean,
    options: DocsRequestOptions = {}
  ): Promise<unknown> {
    return this.request(`/articles/${id}/publish`, {
      ...options,
      method: 'PATCH',
      body: { is_published: isPublished }
    });
  }

  getArticlePreview(id: number, options: DocsRequestOptions = {}): Promise<unknown> {
    return this.request(`/articles/${id}/preview`, options);
  }

  getRevisions(id: number, options: DocsRequestOptions = {}): Promise<unknown> {
    return this.request(`/articles/${id}/revisions${createQueryString({ page: options.page })}`, options);
  }

  restoreRevision(
    articleId: number,
    revisionId: number,
    options: DocsRequestOptions = {}
  ): Promise<unknown> {
    return this.request(`/articles/${articleId}/revisions/${revisionId}/restore`, {
      ...options,
      method: 'POST'
    });
  }

  uploadImage(file: File, options: DocsRequestOptions = {}): Promise<unknown> {
    const body = new FormData();
    body.append('file', file);

    if (options.articleId) {
      body.append('doc_article_id', String(options.articleId));
    }

    if (options.alt) {
      body.append('alt', options.alt);
    }

    return this.request('/images', { ...options, method: 'POST', body });
  }

  deleteImage(id: number, options: DocsRequestOptions = {}): Promise<unknown> {
    return this.request(`/images/${id}`, { ...options, method: 'DELETE' });
  }
}
