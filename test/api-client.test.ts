import assert from 'node:assert/strict';
import test from 'node:test';
import { DocsApiClient, DocsApiError } from '../src/api-client.js';

function createJsonResponse(data: unknown, options: { status?: number } = {}): Response {
  return new Response(JSON.stringify(data), {
    status: options.status || 200,
    headers: {
      'Content-Type': 'application/json',
      'X-Docs-Api-Version': '1'
    }
  });
}

test('builds encoded article URLs and forwards the locale', async () => {
  let requestedURL = '';
  const client = new DocsApiClient({
    baseURL: 'https://example.test/api/docs/',
    fetch: async (url) => {
      requestedURL = String(url);
      return createJsonResponse({ data: {} });
    }
  });

  await client.getArticle('guías', 'instalación básica', { locale: 'es' });

  assert.equal(
    requestedURL,
    'https://example.test/api/docs/categories/gu%C3%ADas/articles/instalaci%C3%B3n%20b%C3%A1sica?locale=es'
  );
});

test('adds a bearer token without mutating configured headers', async () => {
  let requestedHeaders: Headers | undefined;
  const configuredHeaders = { 'X-Host': 'example' };
  const client = new DocsApiClient({
    baseURL: 'https://example.test/api/docs',
    headers: configuredHeaders,
    getAuthToken: () => 'secret',
    fetch: async (url, options) => {
      requestedHeaders = options?.headers as Headers;
      return createJsonResponse({ data: [] });
    }
  });

  await client.getCategories();

  assert.ok(requestedHeaders);
  assert.equal(requestedHeaders.get('Authorization'), 'Bearer secret');
  assert.equal(requestedHeaders.get('X-Host'), 'example');
  assert.deepEqual(configuredHeaders, { 'X-Host': 'example' });
});

test('throws DocsApiError with the validation response', async () => {
  const client = new DocsApiClient({
    baseURL: 'https://example.test/api/docs',
    fetch: async () => createJsonResponse(
      { message: 'The title field is required.', errors: { title: ['Required'] } },
      { status: 422 }
    )
  });

  await assert.rejects(
    client.createArticle({}),
    (error) => {
      assert.ok(error instanceof DocsApiError);
      assert.equal(error.status, 422);
      const errorData = error.data as { errors: { title: string[] } };
      assert.equal(errorData.errors.title[0], 'Required');
      return true;
    }
  );
});

test('serializes JSON request bodies', async () => {
  let requestOptions: RequestInit | undefined;
  const client = new DocsApiClient({
    baseURL: 'https://example.test/api/docs',
    fetch: async (url, options) => {
      requestOptions = options;
      return createJsonResponse({ data: { id: 12 } });
    }
  });

  await client.updateArticle(12, { title: 'Updated', updated_at: '2026-07-28T10:00:00Z' });

  assert.ok(requestOptions);
  const requestHeaders = requestOptions.headers as Headers;
  assert.equal(typeof requestOptions.body, 'string');
  assert.equal(requestOptions.method, 'PUT');
  assert.equal(requestHeaders.get('Content-Type'), 'application/json');
  assert.deepEqual(JSON.parse(requestOptions.body as string), {
    title: 'Updated',
    updated_at: '2026-07-28T10:00:00Z'
  });
});

test('requests drafts only when explicitly enabled', async () => {
  const requestedURLs: string[] = [];
  const client = new DocsApiClient({
    baseURL: 'https://example.test/api/docs',
    fetch: async (url) => {
      requestedURLs.push(String(url));
      return createJsonResponse({ data: [] });
    }
  });

  await client.getArticles('guides', { locale: 'en' });
  await client.getArticles('guides', { locale: 'en', drafts: true });

  assert.equal(
    requestedURLs[0],
    'https://example.test/api/docs/categories/guides/articles?locale=en'
  );
  assert.equal(
    requestedURLs[1],
    'https://example.test/api/docs/categories/guides/articles?locale=en&drafts=1'
  );
});

test('adds the decoded XSRF token to write requests', async () => {
  let requestedHeaders: Headers | undefined;
  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, 'document', {
    value: { cookie: 'theme=dark; XSRF-TOKEN=decoded-xsrf-token%3D' },
    configurable: true
  });
  const client = new DocsApiClient({
    baseURL: 'https://example.test/api/docs',
    credentials: 'include',
    fetch: async (url, options) => {
      requestedHeaders = options?.headers as Headers;
      return createJsonResponse({ data: { id: 12 } });
    }
  });

  try {
    await client.createArticle({ title: 'Protected request' });
  } finally {
    Object.defineProperty(globalThis, 'document', {
      value: previousDocument,
      configurable: true
    });
  }

  assert.ok(requestedHeaders);
  assert.equal(requestedHeaders.get('X-XSRF-TOKEN'), 'decoded-xsrf-token=');
});

test('does not add an XSRF header to read requests', async () => {
  let requestedHeaders: Headers | undefined;
  const client = new DocsApiClient({
    baseURL: 'https://example.test/api/docs',
    getXsrfToken: () => 'unused-token',
    fetch: async (url, options) => {
      requestedHeaders = options?.headers as Headers;
      return createJsonResponse({ data: [] });
    }
  });

  await client.getCategories();

  assert.ok(requestedHeaders);
  assert.equal(requestedHeaders.has('X-XSRF-TOKEN'), false);
});
