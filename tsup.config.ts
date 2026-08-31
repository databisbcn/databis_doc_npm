import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    api: 'src/api.ts',
    'local-worker': 'src/local-worker.ts',
    renderer: 'src/renderer.ts',
    editor: 'src/editor.ts',
    schema: 'src/schema.ts'
  },
  format: ['esm', 'cjs'],
  platform: 'browser',
  target: 'es2021',
  bundle: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  treeshake: true,
  noExternal: [/^@tiptap\//]
});
