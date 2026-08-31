import {
  DocsApiClient,
  LocalWorker,
  allowedNodes,
  createArticleEditor,
  renderTiptapDocument,
  type DocsArticleInput,
  type DocsModuleOptions
} from '@databis/docs-module';
import { DocsApiClient as ApiClientEntry } from '@databis/docs-module/api';
import { createArticleEditor as editorEntry } from '@databis/docs-module/editor';
import { LocalWorker as localWorkerEntry } from '@databis/docs-module/local-worker';
import { renderTiptapDocument as rendererEntry } from '@databis/docs-module/renderer';
import { allowedNodes as schemaNodesEntry } from '@databis/docs-module/schema';

const options: DocsModuleOptions = {
  testing: true,
  locale: 'es'
};
const articleInput: DocsArticleInput = {
  title: 'Type-safe article'
};
const apiClientConstructor: typeof DocsApiClient = ApiClientEntry;
const editorFactory: typeof createArticleEditor = editorEntry;
const localWorkerConstructor: typeof LocalWorker = localWorkerEntry;
const renderer: typeof renderTiptapDocument = rendererEntry;
const schemaNodes: readonly string[] = schemaNodesEntry;

void [
  options,
  articleInput,
  apiClientConstructor,
  editorFactory,
  localWorkerConstructor,
  renderer,
  schemaNodes,
  allowedNodes
];
