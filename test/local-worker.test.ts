import assert from 'node:assert/strict';
import test from 'node:test';

import { LocalWorker } from '../src/localWorker.js';
import type { DocsLocalData } from '../src/types.js';

class MemoryStorage implements Storage {
  readonly values: Map<string, string>;

  constructor() {
    this.values = new Map<string, string>();
  }

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] || null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

function testingContent(): Partial<DocsLocalData> {
  return {
    categories: [{
      id: 4,
      parent_id: null,
      name: 'Guides',
      slug: 'guides',
      description: null,
      order: 0,
      is_published: true,
      updated_at: '2026-07-28T10:00:00.000Z'
    }],
    articles: [{
      id: 8,
      doc_category_id: 4,
      title: 'Installation',
      slug: 'installation',
      excerpt: 'Install the package.',
      order: 0,
      locale: 'en',
      is_published: true,
      published_at: '2026-07-28T10:00:00.000Z',
      content: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: 'Install the package.' }]
        }]
      },
      updated_at: '2026-07-28T10:00:00.000Z'
    }]
  };
}

test('persists testing content without making HTTP requests', async () => {
  const storage = new MemoryStorage();
  const worker = new LocalWorker({
    testingStorage: storage,
    testingStorageKey: 'docs-test',
    testingData: testingContent()
  });

  const createdResponse = await worker.createArticle({
    doc_category_id: 4,
    title: 'Configuration',
    locale: 'en',
    content: { type: 'doc', content: [{ type: 'paragraph' }] }
  });
  await worker.publishArticle(createdResponse.data.id, true);

  const reloadedWorker = new LocalWorker({
    testingStorage: storage,
    testingStorageKey: 'docs-test'
  });
  const articlesResponse = await reloadedWorker.getArticles('guides', {
    locale: 'en',
    drafts: true
  });
  const searchResponse = await reloadedWorker.search('configuration', { locale: 'en' });

  assert.equal(articlesResponse.data.length, 2);
  assert.equal(searchResponse.data[0].slug, 'configuration');
  assert.equal(reloadedWorker.data.articles.length, 2);
});

test('can keep all testing content in a named global variable', async () => {
  const testingScope: { docsTestingData?: DocsLocalData } = {};
  const worker = new LocalWorker({
    testingStorage: 'global',
    testingGlobalScope: testingScope,
    testingGlobalKey: 'docsTestingData'
  });

  await worker.createCategory({
    name: 'Reference',
    is_published: true
  });

  assert.equal(testingScope.docsTestingData?.categories[0]?.slug, 'reference');

  const reloadedWorker = new LocalWorker({
    testingStorage: 'global',
    testingGlobalScope: testingScope,
    testingGlobalKey: 'docsTestingData'
  });
  const categoriesResponse = await reloadedWorker.getCategories();

  assert.equal(categoriesResponse.data[0].name, 'Reference');
});

test('search matches title and content, ignoring case and accents', async () => {
  const worker = new LocalWorker({ testingStorage: false });
  const categoryResponse = await worker.createCategory({ name: 'Guias' });
  const categoryId = categoryResponse.data.id;

  const first = await worker.createArticle({
    doc_category_id: categoryId,
    title: 'Instalación del módulo',
    locale: 'es',
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Requisitos previos.' }] }]
    }
  });
  const second = await worker.createArticle({
    doc_category_id: categoryId,
    title: 'Estilos',
    locale: 'es',
    content: {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'La instalacion de temas se hace aparte.' }]
      }]
    }
  });
  await worker.publishArticle(first.data.id, true);
  await worker.publishArticle(second.data.id, true);

  const response = await worker.search('instalacion', { locale: 'es' });

  assert.equal(response.data.length, 2);
  // Title hits come first, and each result says where the term was found.
  assert.equal(response.data[0].title, 'Instalación del módulo');
  assert.equal(response.data[0].title_match, true);
  assert.equal(response.data[1].title_match, false);
  assert.equal(response.data[1].content_match, true);
  // The snippet is a window around the hit, not the head of the article.
  assert.ok(response.data[1].snippet.includes('instalacion'));

  // Every word has to appear, but they may live in different fields.
  const combined = await worker.search('modulo requisitos', { locale: 'es' });
  assert.equal(combined.data.length, 1);
  assert.equal(combined.data[0].slug, first.data.slug);
});
