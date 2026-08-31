import assert from 'node:assert/strict';
import test from 'node:test';

import { allowedLinkSchemes, allowedMarks, allowedNodes, emptyDocument } from '../src/schema.js';
import { installDom } from './dom.js';

/**
 * The editor's schema has to stay a subset of what the backend accepts.
 *
 * Drift here is the nastiest failure mode in the project: everything looks
 * fine while writing, the save returns 200, and the content comes back with
 * whole nodes missing because the Laravel sanitizer stripped what it did not
 * recognise. No error is raised anywhere.
 *
 * These assertions are cheap insurance against the two lists parting ways.
 */

test('the shared schema covers everything the backend allows', () => {
  // Kept in step by hand with config/docs-module.php in the Laravel package.
  const backendNodes = [
    'doc', 'paragraph', 'text', 'heading', 'hardBreak', 'horizontalRule',
    'bulletList', 'orderedList', 'listItem', 'codeBlock', 'blockquote',
    'image', 'table', 'tableRow', 'tableCell', 'tableHeader'
  ];

  const backendMarks = ['bold', 'italic', 'strike', 'code', 'link', 'underline'];

  assert.deepEqual([...allowedNodes].sort(), [...backendNodes].sort());
  assert.deepEqual([...allowedMarks].sort(), [...backendMarks].sort());
});

test('link schemes match the backend allow list', () => {
  assert.deepEqual([...allowedLinkSchemes], ['http', 'https', 'mailto', 'tel']);
});

test('an empty document is a valid ProseMirror doc', () => {
  const doc = emptyDocument();

  assert.equal(doc.type, 'doc');
  assert.ok(Array.isArray(doc.content));

  // A doc with no children is technically valid but ProseMirror immediately
  // normalises it, which shows up as a spurious "dirty" state the moment an
  // editor mounts.
  assert.ok(doc.content.length > 0);
});

test('every editor node and mark is one the backend will keep', async () => {
  // The assertion that actually matters: it builds the real extension set and
  // reads the schema ProseMirror derived from it, so adding an extension
  // without updating the backend config fails here rather than in production.
  installDom();

  const { editorSchemaNames } = await import('../src/editor.js');
  const { nodes, marks } = editorSchemaNames();

  nodes.forEach((name) => {
    assert.ok(allowedNodes.includes(name), `Editor node "${name}" is not in the backend allow list.`);
  });

  marks.forEach((name) => {
    assert.ok(allowedMarks.includes(name), `Editor mark "${name}" is not in the backend allow list.`);
  });

  // And the other direction: an allowed node the editor cannot produce is a
  // feature quietly missing from the toolbar.
  allowedNodes.forEach((name) => {
    assert.ok(nodes.includes(name), `The editor cannot produce allowed node "${name}".`);
  });

  allowedMarks.forEach((name) => {
    assert.ok(marks.includes(name), `The editor cannot produce allowed mark "${name}".`);
  });
});
