/**
 * The document schema both halves of this project agree on.
 *
 * These lists mirror `content.allowed_nodes` and `content.allowed_marks` in the
 * Laravel package's config. The backend sanitizes every save against its copy,
 * so anything the editor can produce that is missing there is silently stripped
 * on the way in — the single most confusing failure mode in the whole module.
 *
 * Keep them in step. `test/schema.test.ts` guards the editor side against
 * drifting from this file; the backend side is a manual check when either list
 * changes.
 */

export const allowedNodes: readonly string[] = Object.freeze([
  'doc',
  'paragraph',
  'text',
  'heading',
  'hardBreak',
  'horizontalRule',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock',
  'blockquote',
  'image',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader'
]);

export const allowedMarks: readonly string[] = Object.freeze([
  'bold',
  'italic',
  'strike',
  'code',
  'link',
  'underline'
]);

/** Link href schemes the backend keeps. Anything else is dropped on save. */
export const allowedLinkSchemes: readonly string[] = Object.freeze([
  'http',
  'https',
  'mailto',
  'tel'
]);

/** An empty but valid ProseMirror document. */
export function emptyDocument(): TiptapDocument {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}
import type { TiptapDocument } from './types.js';
