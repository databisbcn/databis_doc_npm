export { DocsApiClient, DocsApiError } from './api-client.js';
export { DatabisDocsElement, defineDocsElement } from './docs-element.js';
export { createArticleEditor, createEditorExtensions, editorSchemaNames } from './editor.js';
export {
  LocalWorker,
  createLocalData,
  defaultLocalGlobalKey,
  defaultLocalStorageKey
} from './localWorker.js';
export { allowedLinkSchemes, allowedMarks, allowedNodes, emptyDocument } from './schema.js';
export { createTranslator, defaultMessages } from './messages.js';
export { renderTiptapDocument, resolveImageUrl } from './tiptap-renderer.js';
export type {
  ArticleEditor,
  ArticleEditorOptions,
  AuthTokenProvider,
  DocsArticle,
  DocsArticleInput,
  DocsCapabilities,
  DocsCategory,
  DocsCategoryInput,
  DocsCollectionResponse,
  DocsImageResource,
  DocsLocalData,
  DocsModuleOptions,
  DocsNavigationDetail,
  DocsRequestOptions,
  DocsRevision,
  DocsSearchResult,
  EditorExtensionOptions,
  RenderTiptapOptions,
  RenderTiptapResult,
  TiptapDocument,
  TiptapHeading
} from './types.js';

import { defineDocsElement } from './docs-element.js';
import type { DatabisDocsElement } from './docs-element.js';
import type { DocsModuleOptions } from './types.js';

export function createDocsModule(
  container: Element,
  options: DocsModuleOptions = {}
): DatabisDocsElement {
  if (!(container instanceof Element)) {
    throw new TypeError('createDocsModule requires a DOM Element as its first argument.');
  }

  defineDocsElement();
  const element = document.createElement('databis-docs');
  element.options = options;
  container.append(element);

  return element;
}

if (globalThis.customElements) {
  defineDocsElement();
}

declare global {
  interface HTMLElementTagNameMap {
    'databis-docs': DatabisDocsElement;
  }
}
