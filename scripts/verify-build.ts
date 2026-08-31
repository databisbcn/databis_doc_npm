import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { installDom } from '../test/dom.js';

const packageDirectoryURL = new URL('../', import.meta.url);
const requiredBuildFiles = [
  'dist/index.js',
  'dist/index.cjs',
  'dist/index.d.ts',
  'dist/api.js',
  'dist/api.cjs',
  'dist/api.d.ts',
  'dist/local-worker.js',
  'dist/local-worker.cjs',
  'dist/local-worker.d.ts',
  'dist/renderer.js',
  'dist/renderer.cjs',
  'dist/renderer.d.ts',
  'dist/editor.js',
  'dist/editor.cjs',
  'dist/editor.d.ts',
  'dist/schema.js',
  'dist/schema.cjs',
  'dist/schema.d.ts',
  'dist/style.css'
];

for (const requiredBuildFile of requiredBuildFiles) {
  const requiredBuildFileURL = new URL(requiredBuildFile, packageDirectoryURL);

  if (!existsSync(requiredBuildFileURL)) {
    throw new Error(`Missing build output: ${requiredBuildFile}`);
  }
}

const esmIndexSource = readFileSync(new URL('dist/index.js', packageDirectoryURL), 'utf8');

if (/from\s+['"]@tiptap\//u.test(esmIndexSource)) {
  throw new Error('The ESM build still contains bare TipTap imports.');
}

installDom();

const esmIndexURL = new URL('dist/index.js', packageDirectoryURL);
const esmPackage = await import(esmIndexURL.href);
const require = createRequire(import.meta.url);
const commonJsIndexPath = fileURLToPath(new URL('dist/index.cjs', packageDirectoryURL));
const commonJsPackage = require(commonJsIndexPath);

if (typeof esmPackage.createDocsModule !== 'function') {
  throw new TypeError('The ESM build does not export createDocsModule.');
}

if (typeof commonJsPackage.createDocsModule !== 'function') {
  throw new TypeError('The CommonJS build does not export createDocsModule.');
}
