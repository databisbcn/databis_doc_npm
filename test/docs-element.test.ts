import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { setTimeout as waitForTimeout } from 'node:timers/promises';

import { installDom } from './dom.js';
import type { DatabisDocsElement } from '../src/docs-element.js';
import type { DocsArticle, DocsLocalData } from '../src/types.js';

type TestFetch = (url: string, options?: RequestInit) => Promise<Response>;

interface CapturedRequest {
  url: string;
  options: RequestInit;
}

let createDocsModule: typeof import('../src/index.js').createDocsModule;
let defineDocsElement: typeof import('../src/index.js').defineDocsElement;

before(async () => {
  installDom();
  ({ createDocsModule, defineDocsElement } = await import('../src/index.js'));
  defineDocsElement();
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Docs-Api-Version': '1'
    }
  });
}

function adminCapabilities(canCreateArticle = true) {
  return {
    data: {
      authenticated: true,
      is_admin: true,
      can: {
        create_category: true,
        create_article: canCreateArticle,
        view_drafts: true
      }
    }
  };
}

function categoryResponse() {
  return {
    data: [{
      id: 10,
      name: 'Guides',
      slug: 'guides',
      children: [],
      can: { update: true, delete: true }
    }]
  };
}

function createdArticle(): DocsArticle {
  return {
    id: 25,
    doc_category_id: 10,
    title: 'New guide',
    slug: 'new-guide',
    excerpt: null,
    locale: 'en',
    is_published: false,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    updated_at: '2026-07-28T12:00:00Z',
    can: { update: true, delete: true, publish: true }
  };
}

async function themeFetchImplementation(url: string): Promise<Response> {
  if (url.endsWith('/categories?locale=en')) {
    return jsonResponse(categoryResponse());
  }

  if (url.endsWith('/me/capabilities')) {
    return jsonResponse(adminCapabilities());
  }

  return jsonResponse({ data: [] });
}

async function settle(): Promise<void> {
  await waitForTimeout(20);
}

/** Picks a role the way a user would: choose it, and the list takes it. */
function addRole(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
}

function rolesOn(list: HTMLElement): string[] {
  return Array.from(list.querySelectorAll<HTMLElement>('.docs-module__roles-item[data-role]'))
    .map((item) => item.dataset.role || '');
}

function mountDocs(fetchImplementation: TestFetch): DatabisDocsElement {
  const element = document.createElement('databis-docs');
  element.options = {
    baseURL: 'https://example.test/api/docs',
    locale: 'en',
    fetch: fetchImplementation as typeof fetch,
    autoSelectFirstArticle: false
  };
  document.body.replaceChildren(element);
  return element;
}

test('shows article creation only when the capability allows it', async () => {
  const fetchImplementation = async (url: string): Promise<Response> => {
    if (url.endsWith('/categories?locale=en')) {
      return jsonResponse(categoryResponse());
    }

    if (url.endsWith('/me/capabilities')) {
      return jsonResponse(adminCapabilities(false));
    }

    return jsonResponse({ data: [] });
  };
  const element = mountDocs(fetchImplementation);

  await settle();

  assert.equal(
    element.querySelector<HTMLButtonElement>('[data-action="create-article"]')?.hidden,
    true
  );
});

test('derives the theme from the configured primary color', async () => {
  const element = mountDocs(themeFetchImplementation);

  element.primaryColor = '#6750A4';
  await settle();

  assert.equal(element.primaryColor, '#6750A4');
  assert.equal(element.style.getPropertyValue('--docs-color-primary'), '#6750A4');

  element.setAttribute('primary-color', '#EA5455');

  assert.equal(element.primaryColor, '#EA5455');
  assert.equal(element.style.getPropertyValue('--docs-color-primary'), '#EA5455');

  element.removeAttribute('primary-color');

  assert.equal(element.primaryColor, '#6750A4');
  assert.equal(element.style.getPropertyValue('--docs-color-primary'), '#6750A4');
});

test('success messages disappear automatically after two seconds', async () => {
  const element = mountDocs(themeFetchImplementation);

  await settle();
  const testElement = element as unknown as {
    announce(message: string, type: 'success'): void;
  };
  testElement.announce('Article saved.', 'success');

  const status = element.querySelector<HTMLElement>('.docs-module__status');
  assert.ok(status);
  assert.equal(status.textContent, 'Article saved.');
  assert.equal(status.dataset.type, 'success');

  await waitForTimeout(1900);
  assert.equal(status.textContent, 'Article saved.');

  await waitForTimeout(200);
  assert.equal(status.textContent, '');
  assert.equal(status.hasAttribute('data-type'), false);
});

test('changing category clears the previous article and renders the new article list', async () => {
  const testingScope: Record<string, unknown> = {};
  const container = document.createElement('div');
  document.body.replaceChildren(container);
  const element = createDocsModule(container, {
    testing: true,
    testingStorage: 'global',
    testingGlobalScope: testingScope,
    testingGlobalKey: 'categorySwitchData',
    locale: 'en',
    autoSelectFirstArticle: false,
    testingData: {
      categories: [
        {
          id: 10,
          parent_id: null,
          name: 'Guides',
          slug: 'guides',
          order: 0,
          is_published: true
        },
        {
          id: 20,
          parent_id: null,
          name: 'API',
          slug: 'api',
          order: 1,
          is_published: true
        }
      ],
      articles: [
        {
          id: 100,
          doc_category_id: 10,
          title: 'Introduction',
          slug: 'introduction',
          order: 0,
          locale: 'en',
          is_published: true,
          content: { type: 'doc', content: [{ type: 'paragraph' }] }
        },
        {
          id: 200,
          doc_category_id: 20,
          title: 'API reference',
          slug: 'api-reference',
          order: 0,
          locale: 'en',
          is_published: true,
          content: { type: 'doc', content: [{ type: 'paragraph' }] }
        }
      ]
    }
  });

  await settle();
  await element.selectArticle('introduction');

  assert.equal(element.article, 'introduction');
  assert.equal(
    element.querySelector('.docs-module__article-header h1')?.textContent,
    'Introduction'
  );

  element
    .querySelector<HTMLButtonElement>('[data-action="select-category"][data-slug="api"]')
    ?.click();
  await settle();

  assert.equal(element.category, 'api');
  assert.equal(element.article, '');
  assert.equal(
    element.querySelector('[data-action="select-article"]')?.textContent,
    'API reference'
  );
  assert.equal(
    element.querySelector('.docs-module__empty')?.textContent,
    'Select an article to get started.'
  );
});

test('an administrator can bootstrap an empty installation by creating a category', async () => {
  const requests: CapturedRequest[] = [];
  let categories: Array<Record<string, unknown>> = [];
  const fetchImplementation: TestFetch = async (url, options = {}) => {
    requests.push({ url, options });

    if (url.endsWith('/categories?locale=en')) {
      return jsonResponse({ data: categories });
    }

    if (url.endsWith('/me/capabilities')) {
      return jsonResponse(adminCapabilities());
    }

    if (url.endsWith('/categories') && options.method === 'POST') {
      const payload = JSON.parse(String(options.body));
      const category = {
        id: 10,
        name: payload.name,
        slug: 'guides',
        description: payload.description,
        parent_id: payload.parent_id,
        children: [],
        can: { update: true, delete: true }
      };
      categories = [category];
      return jsonResponse({ data: category }, 201);
    }

    if (url.includes('/categories/guides/articles?')) {
      return jsonResponse({ data: [] });
    }

    return jsonResponse({ data: [] });
  };
  const element = mountDocs(fetchImplementation);

  await settle();
  const createCategoryButton = element.querySelector<HTMLButtonElement>(
    '[data-action="create-category"]'
  );
  const createArticleButton = element.querySelector<HTMLButtonElement>(
    '[data-action="create-article"]'
  );
  assert.ok(createCategoryButton);
  assert.ok(createArticleButton);
  assert.equal(createCategoryButton.hidden, false);
  assert.equal(createArticleButton.hidden, true);

  createCategoryButton.click();
  const form = element.querySelector<HTMLFormElement>('[data-form="category"]');
  assert.ok(form);
  const nameInput = form.elements.namedItem('name') as HTMLInputElement;
  const descriptionInput = form.elements.namedItem('description') as HTMLTextAreaElement;
  nameInput.value = 'Guides';
  descriptionInput.value = 'Product guides';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

  await settle();
  await settle();

  const createRequest = requests.find(({ url, options }) => (
    url.endsWith('/categories') && options.method === 'POST'
  ));
  assert.ok(createRequest);
  const payload = JSON.parse(String(createRequest.options.body));

  assert.deepEqual(payload, {
    name: 'Guides',
    description: 'Product guides',
    parent_id: null,
    is_published: true
  });
  assert.equal(element.querySelector('[data-action="select-category"]')?.textContent, 'Guides');
  assert.equal(
    element.querySelector<HTMLButtonElement>('[data-action="create-article"]')?.hidden,
    false
  );
});

test('an administrator can create a draft article from the UI', async () => {
  const requests: CapturedRequest[] = [];
  let article: DocsArticle | null = null;
  const fetchImplementation: TestFetch = async (url, options = {}) => {
    requests.push({ url, options });

    if (url.endsWith('/categories?locale=en')) {
      return jsonResponse(categoryResponse());
    }

    if (url.endsWith('/me/capabilities')) {
      return jsonResponse(adminCapabilities());
    }

    if (url.includes('/categories/guides/articles?')) {
      return jsonResponse({ data: article ? [article] : [] });
    }

    if (url.endsWith('/articles') && options.method === 'POST') {
      article = createdArticle();
      return jsonResponse({ data: article }, 201);
    }

    if (url.includes('/categories/guides/articles/new-guide')) {
      return jsonResponse({ data: article });
    }

    return jsonResponse({ data: [] });
  };
  const element = mountDocs(fetchImplementation);

  await settle();
  const createButton = element.querySelector<HTMLButtonElement>(
    '[data-action="create-article"]'
  );
  assert.ok(createButton);
  assert.equal(createButton.hidden, false);

  createButton.click();
  const form = element.querySelector<HTMLFormElement>('[data-form="article"]');
  assert.ok(form);
  const titleInput = form.elements.namedItem('title') as HTMLInputElement;
  titleInput.value = 'New guide';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

  await settle();
  await settle();

  const createRequest = requests.find(({ url, options }) => (
    url.endsWith('/articles') && options.method === 'POST'
  ));
  assert.ok(createRequest);
  const payload = JSON.parse(String(createRequest.options.body));

  assert.equal(payload.doc_category_id, 10);
  assert.equal(payload.title, 'New guide');
  assert.equal(payload.locale, 'en');
  assert.equal(payload.is_published, undefined);
  assert.equal(element.querySelector('.docs-module__article-header h1')?.textContent, 'New guide');
  assert.equal(element.querySelector('[data-action="toggle-publish"]')?.textContent, 'Publish');
});

test('authorized article actions edit and unpublish through their dedicated endpoints', async () => {
  const requests: CapturedRequest[] = [];
  let article: DocsArticle = {
    ...createdArticle(),
    title: 'Existing guide',
    slug: 'existing-guide',
    is_published: true
  };
  const fetchImplementation: TestFetch = async (url, options = {}) => {
    requests.push({ url, options });

    if (url.endsWith('/categories?locale=en')) {
      return jsonResponse(categoryResponse());
    }

    if (url.endsWith('/me/capabilities')) {
      return jsonResponse(adminCapabilities());
    }

    if (url.includes('/categories/guides/articles?')) {
      return jsonResponse({ data: [article] });
    }

    if (url.includes('/categories/guides/articles/existing-guide')) {
      return jsonResponse({ data: article });
    }

    if (url.endsWith('/articles/25') && options.method === 'PUT') {
      const payload = JSON.parse(String(options.body));
      article = { ...article, ...payload, updated_at: '2026-07-28T12:05:00Z' };
      return jsonResponse({ data: article });
    }

    if (url.endsWith('/articles/25/publish') && options.method === 'PATCH') {
      article = { ...article, is_published: false };
      return jsonResponse({ data: article });
    }

    return jsonResponse({ data: [] });
  };
  const element = mountDocs(fetchImplementation);

  await settle();
  await element.selectArticle('existing-guide');

  element.querySelector<HTMLButtonElement>('[data-action="edit"]')?.click();
  const form = element.querySelector<HTMLFormElement>('[data-form="article"]');
  assert.ok(form);
  const titleInput = form.elements.namedItem('title') as HTMLInputElement;
  titleInput.value = 'Updated guide';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  await settle();

  const updateRequest = requests.find(({ url, options }) => (
    url.endsWith('/articles/25') && options.method === 'PUT'
  ));
  assert.ok(updateRequest);
  const updatePayload = JSON.parse(String(updateRequest.options.body));

  assert.equal(updatePayload.title, 'Updated guide');
  assert.equal(updatePayload.updated_at, '2026-07-28T12:00:00Z');
  assert.equal(
    element.querySelector('.docs-module__article-header h1')?.textContent,
    'Updated guide'
  );

  element.querySelector<HTMLButtonElement>('[data-action="toggle-publish"]')?.click();
  await settle();

  const publishRequest = requests.find(({ url, options }) => (
    url.endsWith('/articles/25/publish') && options.method === 'PATCH'
  ));

  assert.ok(publishRequest);
  assert.deepEqual(
    JSON.parse(String(publishRequest.options.body)),
    { is_published: false }
  );
  assert.equal(element.querySelector('[data-action="toggle-publish"]')?.textContent, 'Publish');
});

test('an administrator sees the publication state and deletes articles and categories', async () => {
  const requests: CapturedRequest[] = [];
  let articles: DocsArticle[] = [
    { ...createdArticle(), is_published: true },
    {
      ...createdArticle(),
      id: 26,
      title: 'Draft guide',
      slug: 'draft-guide',
      is_published: false
    }
  ];
  let categories = categoryResponse().data;
  const fetchImplementation: TestFetch = async (url, options = {}) => {
    requests.push({ url, options });

    if (url.endsWith('/categories?locale=en')) {
      return jsonResponse({ data: categories });
    }

    if (url.endsWith('/me/capabilities')) {
      return jsonResponse(adminCapabilities());
    }

    if (url.includes('/categories/guides/articles?')) {
      return jsonResponse({ data: articles });
    }

    if (url.endsWith('/articles/26') && options.method === 'DELETE') {
      articles = articles.filter((article) => article.id !== 26);
      return new Response(null, { status: 204 });
    }

    if (url.endsWith('/categories/10') && options.method === 'DELETE') {
      categories = [];
      articles = [];
      return new Response(null, { status: 204 });
    }

    return jsonResponse({ data: [] });
  };
  const confirmations: string[] = [];
  window.confirm = (message?: string) => {
    confirmations.push(String(message));
    return true;
  };

  const element = mountDocs(fetchImplementation);
  await settle();
  await element.selectCategory('guides');
  await settle();

  const states = [...element.querySelectorAll<HTMLElement>(
    '.docs-module__articles .docs-module__publish-state'
  )];
  assert.deepEqual(states.map((state) => state.dataset.state), ['published', 'draft']);
  assert.deepEqual(
    states.map((state) => state.getAttribute('aria-label')),
    ['Published', 'Draft']
  );

  // The state icon comes before the delete button in the same row.
  const draftRow = states[1]?.parentElement;
  assert.equal(
    draftRow?.lastElementChild?.getAttribute('data-action'),
    'delete-article'
  );
  assert.equal(states[1]?.nextElementSibling, draftRow?.lastElementChild);

  element.querySelector<HTMLButtonElement>(
    '[data-action="delete-article"][data-id="26"]'
  )?.click();
  await settle();
  await settle();

  assert.ok(requests.some(({ url, options }) => (
    url.endsWith('/articles/26') && options.method === 'DELETE'
  )));
  assert.equal(confirmations.length, 1);
  assert.equal(
    element.querySelectorAll('[data-action="select-article"]').length,
    1
  );

  element.querySelector<HTMLButtonElement>(
    '[data-action="delete-category"][data-id="10"]'
  )?.click();
  await settle();
  await settle();

  assert.ok(requests.some(({ url, options }) => (
    url.endsWith('/categories/10') && options.method === 'DELETE'
  )));
  assert.equal(element.querySelectorAll('[data-action="select-category"]').length, 0);
  assert.equal(element.getAttribute('category'), null);
});

test('a category that still holds articles keeps the open article on screen', async () => {
  const fetchImplementation: TestFetch = async (url, options = {}) => {
    if (url.endsWith('/categories?locale=en')) {
      return jsonResponse(categoryResponse());
    }

    if (url.endsWith('/me/capabilities')) {
      return jsonResponse(adminCapabilities());
    }

    if (url.includes('/categories/guides/articles/new-guide')) {
      return jsonResponse({ data: createdArticle() });
    }

    if (url.includes('/categories/guides/articles?')) {
      return jsonResponse({ data: [createdArticle()] });
    }

    if (url.endsWith('/categories/10') && options.method === 'DELETE') {
      return jsonResponse({
        message: 'The category must be empty before it can be deleted.',
        errors: { articles_count: 1, children_count: 0 }
      }, 422);
    }

    return jsonResponse({ data: [] });
  };
  window.confirm = () => true;

  const element = mountDocs(fetchImplementation);
  await settle();
  await element.selectCategory('guides', { article: 'new-guide' });
  await settle();

  element.querySelector<HTMLButtonElement>('[data-action="delete-category"]')?.click();
  await settle();
  await settle();

  assert.equal(
    element.querySelector('.docs-module__status')?.textContent,
    'The category must be empty before it can be deleted.'
  );
  assert.equal(
    element.querySelector('.docs-module__article-header h1')?.textContent,
    'New guide'
  );
  assert.equal(element.querySelectorAll('[data-action="select-category"]').length, 1);
});

test('a reader gets neither delete buttons nor the publication state', async () => {
  const fetchImplementation: TestFetch = async (url) => {
    if (url.endsWith('/categories?locale=en')) {
      return jsonResponse({
        data: [{
          id: 10,
          name: 'Guides',
          slug: 'guides',
          children: [],
          can: { update: false, delete: false }
        }]
      });
    }

    if (url.endsWith('/me/capabilities')) {
      return jsonResponse({
        data: {
          authenticated: false,
          is_admin: false,
          can: { create_category: false, create_article: false, view_drafts: false }
        }
      });
    }

    if (url.includes('/categories/guides/articles?')) {
      return jsonResponse({
        data: [{
          ...createdArticle(),
          is_published: true,
          can: { update: false, delete: false, publish: false }
        }]
      });
    }

    return jsonResponse({ data: [] });
  };
  const element = mountDocs(fetchImplementation);

  await settle();
  await element.selectCategory('guides');
  await settle();

  assert.equal(element.querySelectorAll('[data-action="select-article"]').length, 1);
  assert.equal(element.querySelectorAll('.docs-module__publish-state').length, 0);
  assert.equal(element.querySelectorAll('[data-action="delete-article"]').length, 0);
  assert.equal(element.querySelectorAll('[data-action="delete-category"]').length, 0);
});

test('testing mode uses the local worker and never calls fetch', async () => {
  let fetchCalls = 0;
  const testingScope: { docsTestingData?: DocsLocalData } = {};
  const container = document.createElement('div');
  document.body.replaceChildren(container);
  const element = createDocsModule(container, {
    testing: true,
    testingStorage: 'global',
    testingGlobalScope: testingScope,
    testingGlobalKey: 'docsTestingData',
    locale: 'en',
    autoSelectFirstArticle: false,
    fetch: async () => {
      fetchCalls += 1;
      throw new Error('Testing mode must not call fetch.');
    }
  });

  await settle();
  const createCategoryButton = element.querySelector<HTMLButtonElement>(
    '[data-action="create-category"]'
  );
  assert.ok(createCategoryButton);
  assert.equal(createCategoryButton.hidden, false);

  createCategoryButton.click();
  const form = element.querySelector<HTMLFormElement>('[data-form="category"]');
  assert.ok(form);
  const nameInput = form.elements.namedItem('name') as HTMLInputElement;
  nameInput.value = 'Local guides';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

  await settle();
  await settle();

  assert.equal(fetchCalls, 0);
  assert.equal(element.testing, true);
  assert.equal(element.testingData?.categories[0]?.slug, 'local-guides');
  assert.equal(testingScope.docsTestingData?.categories[0]?.name, 'Local guides');
});

test('search results highlight the term and keep the snippet on one line', async () => {
  const fetchImplementation = async (url: string): Promise<Response> => {
    if (url.endsWith('/categories?locale=en')) {
      return jsonResponse(categoryResponse());
    }

    if (url.endsWith('/me/capabilities')) {
      return jsonResponse(adminCapabilities());
    }

    if (url.includes('/search?')) {
      return jsonResponse({
        data: [
          {
            id: 1,
            title: 'Instalación del módulo',
            slug: 'instalacion',
            locale: 'en',
            snippet: 'Antes de la instalacion conviene revisar los requisitos.',
            title_match: true,
            content_match: true,
            category: { id: 10, name: 'Guides', slug: 'guides' }
          },
          {
            id: 2,
            title: 'Estilos',
            slug: 'estilos',
            locale: 'en',
            snippet: 'La instalacion de temas se hace aparte.',
            title_match: false,
            content_match: true,
            category: { id: 10, name: 'Guides', slug: 'guides' }
          }
        ],
        meta: { total: 2, per_page: 25, current_page: 1, last_page: 1 }
      });
    }

    return jsonResponse({ data: [] });
  };
  const element = mountDocs(fetchImplementation);

  await settle();
  await element.runSearch('instalacion');

  const results = element.querySelectorAll('.docs-module__search-results li');
  assert.equal(results.length, 2);

  // The accented title is matched by the unaccented term, and the hit is
  // wrapped in a highlight span so it is visible in the list.
  const firstTitle = results[0].querySelector('.docs-module__search-title')!;
  assert.equal(firstTitle.querySelector('.docs-module__search-mark')?.textContent, 'Instalación');

  // The whole title sits in one box, so a partial hit is not torn apart by the
  // gap of the flex row it shares with the badge.
  const firstTitleText = firstTitle.querySelector('.docs-module__search-title-text')!;
  assert.equal(firstTitleText.textContent, 'Instalación del módulo');
  assert.equal(firstTitle.children.length, 2);

  const firstSnippet = results[0].querySelector('.docs-module__search-snippet')!;
  assert.equal(
    firstSnippet.querySelector('.docs-module__search-mark')?.textContent,
    'instalacion'
  );
  assert.ok(!/\s{2,}/.test(firstSnippet.textContent || ''));

  // A title hit is labelled on the title; a content-only hit is labelled on
  // its own so the two are told apart at a glance.
  assert.ok(firstTitle.querySelector('.docs-module__search-badge--title'));
  assert.equal(results[0].querySelector('.docs-module__search-badge--content'), null);
  assert.ok(results[1].querySelector('.docs-module__search-badge--content'));
});

test('a term below the minimum length clears the results', async () => {
  const fetchImplementation = async (url: string): Promise<Response> => {
    if (url.endsWith('/categories?locale=en')) {
      return jsonResponse(categoryResponse());
    }

    if (url.endsWith('/me/capabilities')) {
      return jsonResponse(adminCapabilities());
    }

    if (url.includes('/search?')) {
      return jsonResponse({
        data: [{
          id: 1,
          title: 'Instalación',
          slug: 'instalacion',
          locale: 'en',
          snippet: 'Texto.',
          title_match: true,
          content_match: false,
          category: null
        }],
        meta: { total: 1, per_page: 25, current_page: 1, last_page: 1 }
      });
    }

    return jsonResponse({ data: [] });
  };
  const element = mountDocs(fetchImplementation);

  await settle();
  await element.runSearch('instalacion');
  assert.equal(element.querySelectorAll('.docs-module__search-results li').length, 1);

  await element.runSearch('in');
  assert.equal(element.querySelector('.docs-module__search-results'), null);
});

test('the visibility field is only rendered when the backend offers roles', async () => {
  // Off is the default, and the payload must then omit `roles` entirely:
  // sending [] would make the backend wipe an existing assignment.
  const requests: CapturedRequest[] = [];
  const fetchImplementation: TestFetch = async (url, options = {}) => {
    requests.push({ url, options });

    if (url.endsWith('/categories?locale=en')) {
      return jsonResponse(categoryResponse());
    }

    if (url.endsWith('/me/capabilities')) {
      return jsonResponse(adminCapabilities());
    }

    if (url.endsWith('/articles') && options.method === 'POST') {
      return jsonResponse({ data: createdArticle() }, 201);
    }

    return jsonResponse({ data: [] });
  };
  const element = mountDocs(fetchImplementation);

  await settle();
  assert.equal(requests.some(({ url }) => url.endsWith('/roles')), false);

  element.querySelector<HTMLButtonElement>('[data-action="create-article"]')?.click();
  const form = element.querySelector<HTMLFormElement>('[data-form="article"]');
  assert.ok(form);
  assert.equal(form.querySelector(".docs-module__roles"), null);

  (form.elements.namedItem('title') as HTMLInputElement).value = 'New guide';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();

  const created = requests.find(({ url, options }) => (
    url.endsWith('/articles') && options.method === 'POST'
  ));
  assert.ok(created);
  assert.equal('roles' in JSON.parse(String(created.options.body)), false);
});

test('the selected roles are sent with the article', async () => {
  const requests: CapturedRequest[] = [];
  const fetchImplementation: TestFetch = async (url, options = {}) => {
    requests.push({ url, options });

    if (url.endsWith('/categories?locale=en')) {
      return jsonResponse(categoryResponse());
    }

    if (url.endsWith('/me/capabilities')) {
      return jsonResponse({
        data: { ...adminCapabilities().data, roles_enabled: true }
      });
    }

    if (url.endsWith('/roles')) {
      return jsonResponse({
        data: [
          { value: '1', label: 'Sales' },
          { value: '2', label: 'Accounting' }
        ]
      });
    }

    if (url.endsWith('/articles') && options.method === 'POST') {
      return jsonResponse({ data: createdArticle() }, 201);
    }

    return jsonResponse({ data: [] });
  };
  const element = mountDocs(fetchImplementation);

  await settle();

  element.querySelector<HTMLButtonElement>('[data-action="create-article"]')?.click();
  const form = element.querySelector<HTMLFormElement>('[data-form="article"]');
  assert.ok(form);

  const select = form.querySelector<HTMLSelectElement>('.docs-module__roles-select');
  const list = form.querySelector<HTMLElement>('.docs-module__roles-list');
  assert.ok(select);
  assert.ok(list);

  // Empty list: the placeholder plus every role, and the state spelled out.
  assert.deepEqual(
    Array.from(select.options).map((option) => option.textContent),
    ['Add role…', 'Sales', 'Accounting']
  );
  assert.equal(list.querySelector('.docs-module__roles-empty')?.textContent, 'Everyone');

  addRole(select, '2');

  // The list is the state, and what is on it leaves the dropdown.
  assert.deepEqual(rolesOn(list), ['2']);
  assert.deepEqual(
    Array.from(select.options).map((option) => option.textContent),
    ['Add role…', 'Sales']
  );
  assert.equal(list.querySelector('.docs-module__roles-empty'), null);

  (form.elements.namedItem('title') as HTMLInputElement).value = 'New guide';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();

  const created = requests.find(({ url, options }) => (
    url.endsWith('/articles') && options.method === 'POST'
  ));
  assert.ok(created);
  assert.deepEqual(JSON.parse(String(created.options.body)).roles, ['2']);
});

test('a role taken off the list is not sent, and comes back to the dropdown', async () => {
  const requests: CapturedRequest[] = [];
  const article: DocsArticle = {
    ...createdArticle(),
    title: 'Payroll',
    slug: 'payroll',
    is_published: true,
    visible_roles: ['1', '2']
  };
  const fetchImplementation: TestFetch = async (url, options = {}) => {
    requests.push({ url, options });

    if (url.endsWith('/categories?locale=en')) {
      return jsonResponse(categoryResponse());
    }

    if (url.endsWith('/me/capabilities')) {
      return jsonResponse({
        data: { ...adminCapabilities().data, roles_enabled: true }
      });
    }

    if (url.endsWith('/roles')) {
      return jsonResponse({
        data: [
          { value: '1', label: 'Sales' },
          { value: '2', label: 'Accounting' }
        ]
      });
    }

    if (url.includes('/categories/guides/articles/payroll')) {
      return jsonResponse({ data: article });
    }

    if (url.includes('/categories/guides/articles?')) {
      return jsonResponse({ data: [article] });
    }

    if (url.endsWith('/articles/25') && options.method === 'PUT') {
      return jsonResponse({ data: article });
    }

    return jsonResponse({ data: [] });
  };
  const element = mountDocs(fetchImplementation);

  await settle();
  await element.selectArticle('payroll');

  element.querySelector<HTMLButtonElement>('[data-action="edit"]')?.click();
  const form = element.querySelector<HTMLFormElement>('[data-form="article"]');
  assert.ok(form);

  const list = form.querySelector<HTMLElement>('.docs-module__roles-list');
  const select = form.querySelector<HTMLSelectElement>('.docs-module__roles-select');
  assert.ok(list);
  assert.ok(select);

  // The article's own roles start on the list, so the dropdown has nothing
  // left to offer.
  assert.deepEqual(rolesOn(list), ['1', '2']);
  assert.equal(select.disabled, true);

  list.querySelector<HTMLButtonElement>('[data-action="remove-role"][data-role="1"]')?.click();

  assert.deepEqual(rolesOn(list), ['2']);
  assert.equal(select.disabled, false);
  assert.deepEqual(
    Array.from(select.options).map((option) => option.textContent),
    ['Add role…', 'Sales']
  );

  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();

  const saved = requests.find(({ url, options }) => (
    url.endsWith('/articles/25') && options.method === 'PUT'
  ));
  assert.ok(saved);
  assert.deepEqual(JSON.parse(String(saved.options.body)).roles, ['2']);
});

/** The article the upload tests edit, with one picture already in it. */
function articleWithImage(): DocsArticle {
  return {
    ...createdArticle(),
    title: 'Payroll',
    slug: 'payroll',
    is_published: true,
    content: {
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'docs-images/2026/09/kept.webp' } }]
    }
  };
}

function uploadFetch(requests: CapturedRequest[], article: DocsArticle): TestFetch {
  let nextId = 100;

  return async (url, options = {}) => {
    requests.push({ url, options });

    if (url.endsWith('/categories?locale=en')) {
      return jsonResponse(categoryResponse());
    }

    if (url.endsWith('/me/capabilities')) {
      return jsonResponse(adminCapabilities());
    }

    if (url.endsWith('/images') && options.method === 'POST') {
      const id = nextId++;
      return jsonResponse({
        data: { id, path: `docs-images/2026/09/upload-${id}.webp`, url: null }
      }, 201);
    }

    if (url.includes('/images/') && options.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }

    if (url.includes('/categories/guides/articles/payroll')) {
      return jsonResponse({ data: article });
    }

    if (url.includes('/categories/guides/articles?')) {
      return jsonResponse({ data: [article] });
    }

    if (url.endsWith('/articles/25') && options.method === 'PUT') {
      return jsonResponse({ data: article });
    }

    return jsonResponse({ data: [] });
  };
}

function deletedImageIds(requests: CapturedRequest[]): string[] {
  return requests
    .filter(({ url, options }) => options.method === 'DELETE' && url.includes('/images/'))
    .map(({ url }) => url.split('/').pop() || '');
}

test('cancelling an edit deletes the images uploaded during it', async () => {
  // The upload happens the moment the file is dropped, so cancelling would
  // otherwise leave the file on disk with nothing pointing at it.
  const requests: CapturedRequest[] = [];
  const element = mountDocs(uploadFetch(requests, articleWithImage()));

  await settle();
  await element.selectArticle('payroll');

  element.querySelector<HTMLButtonElement>('[data-action="edit"]')?.click();

  const uploaded = await element.uploadImage(new File(['x'], 'shot.png', { type: 'image/png' }));
  assert.equal(uploaded.id, 100);

  element.querySelector<HTMLButtonElement>('[data-action="cancel-edit"]')?.click();
  await settle();

  assert.deepEqual(deletedImageIds(requests), ['100']);
});

test('cancelling leaves the pictures the stored article still uses alone', async () => {
  const requests: CapturedRequest[] = [];
  const element = mountDocs(uploadFetch(requests, articleWithImage()));

  await settle();
  await element.selectArticle('payroll');

  // Opening and closing the editor without uploading anything must not cost a
  // single request, and must certainly not touch the existing picture.
  element.querySelector<HTMLButtonElement>('[data-action="edit"]')?.click();
  element.querySelector<HTMLButtonElement>('[data-action="cancel-edit"]')?.click();
  await settle();

  assert.deepEqual(deletedImageIds(requests), []);
});

test('an upload that never reached the document is collected on save too', async () => {
  const requests: CapturedRequest[] = [];
  const element = mountDocs(uploadFetch(requests, articleWithImage()));

  await settle();
  await element.selectArticle('payroll');

  element.querySelector<HTMLButtonElement>('[data-action="edit"]')?.click();

  // Two uploads, and the document that gets saved only keeps the second one:
  // the first was inserted and taken out again before saving, which is
  // invisible to the backend.
  await element.uploadImage(new File(['x'], 'discarded.png', { type: 'image/png' }));
  const kept = await element.uploadImage(new File(['x'], 'kept.png', { type: 'image/png' }));

  const form = element.querySelector<HTMLFormElement>('[data-form="article"]');
  assert.ok(form);

  // Stand in for the editor's own document: what the user left in it.
  (element as unknown as {
    _editor: { getJSON(): unknown; destroy(): void } | null;
  })._editor = {
    getJSON: () => ({
      type: 'doc',
      content: [{ type: 'image', attrs: { src: kept.path } }]
    }),
    destroy: () => {}
  };

  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  await settle();

  // The save has to have gone through, or the assertion below would pass for
  // the wrong reason.
  const saved = requests.find(({ url, options }) => (
    url.endsWith('/articles/25') && options.method === 'PUT'
  ));
  assert.ok(saved);
  assert.deepEqual(deletedImageIds(requests), ['100']);
});

/** A two-level tree, so the cycle guard has something to exclude. */
function categoryTree() {
  return {
    data: [{
      id: 10,
      parent_id: null,
      name: 'Guides',
      slug: 'guides',
      description: 'The old description',
      visible_roles: [],
      can: { update: true, delete: true },
      children: [{
        id: 11,
        parent_id: 10,
        name: 'Advanced',
        slug: 'advanced',
        visible_roles: [],
        can: { update: true, delete: true },
        children: []
      }]
    }]
  };
}

function categoryFetch(requests: CapturedRequest[]): TestFetch {
  return async (url, options = {}) => {
    requests.push({ url, options });

    if (url.endsWith('/categories?locale=en')) {
      return jsonResponse(categoryTree());
    }

    if (url.endsWith('/me/capabilities')) {
      return jsonResponse(adminCapabilities());
    }

    if (url.endsWith('/categories/10') && options.method === 'PUT') {
      return jsonResponse({ data: { ...categoryTree().data[0], name: 'Handbook' } });
    }

    return jsonResponse({ data: [] });
  };
}

test('a category can be edited from the button beside its bin', async () => {
  const requests: CapturedRequest[] = [];
  const element = mountDocs(categoryFetch(requests));

  await settle();

  const edit = element.querySelector<HTMLButtonElement>(
    '[data-action="edit-category"][data-id="10"]'
  );
  assert.ok(edit);

  edit.click();

  const form = element.querySelector<HTMLFormElement>('[data-form="category"]');
  assert.ok(form);
  assert.equal(form.dataset.id, '10');

  // Prefilled, or it would be a "create" form wearing an edit heading.
  assert.equal((form.elements.namedItem('name') as HTMLInputElement).value, 'Guides');
  assert.equal(
    (form.elements.namedItem('description') as HTMLTextAreaElement).value,
    'The old description'
  );

  (form.elements.namedItem('name') as HTMLInputElement).value = 'Handbook';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();

  const saved = requests.find(({ url, options }) => (
    url.endsWith('/categories/10') && options.method === 'PUT'
  ));
  assert.ok(saved);

  const payload = JSON.parse(String(saved.options.body));
  assert.equal(payload.name, 'Handbook');
  assert.equal(payload.parent_id, null);

  // Not on this form, and sending it would republish a retired category.
  assert.equal('is_published' in payload, false);

  // A POST would mean a duplicate category rather than an edit.
  assert.equal(
    requests.some(({ url, options }) => url.endsWith('/categories') && options.method === 'POST'),
    false
  );
});

test('a category cannot be moved under itself or under its own children', async () => {
  const requests: CapturedRequest[] = [];
  const element = mountDocs(categoryFetch(requests));

  await settle();

  element.querySelector<HTMLButtonElement>('[data-action="edit-category"][data-id="10"]')?.click();

  const parents = element.querySelector<HTMLSelectElement>('[name="parent_id"]');
  assert.ok(parents);

  // Only the root option is left: the category itself and its child are both
  // out, which is the whole tree here.
  assert.deepEqual(Array.from(parents.options).map((option) => option.value), ['']);

  // The child, on the other hand, may still be moved to the root or left
  // where it is.
  element.querySelector<HTMLButtonElement>('[data-action="cancel-category"]')?.click();
  element.querySelector<HTMLButtonElement>('[data-action="edit-category"][data-id="11"]')?.click();

  const childParents = element.querySelector<HTMLSelectElement>('[name="parent_id"]');
  assert.ok(childParents);
  assert.deepEqual(Array.from(childParents.options).map((option) => option.value), ['', '10']);
  assert.equal(childParents.value, '10');
});

test('the edit button is absent when the category cannot be updated', async () => {
  const fetchImplementation: TestFetch = async (url) => {
    if (url.endsWith('/categories?locale=en')) {
      const tree = categoryTree();
      tree.data[0].can = { update: false, delete: true };
      return jsonResponse(tree);
    }

    if (url.endsWith('/me/capabilities')) {
      return jsonResponse(adminCapabilities());
    }

    return jsonResponse({ data: [] });
  };
  const element = mountDocs(fetchImplementation);

  await settle();

  assert.equal(
    element.querySelector('[data-action="edit-category"][data-id="10"]'),
    null
  );
  assert.ok(element.querySelector('[data-action="delete-category"][data-id="10"]'));
});
