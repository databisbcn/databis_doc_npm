# @databis/docs-module

Framework-agnostic UI and API client for
[`databis/laravel-docs-module`](../laravel-docs-module/README.md). It is built on
standard Custom Elements, `fetch`, HTML and CSS, and installs no framework into
the host application — no Vue, no React.

Its one real dependency is **TipTap**, which powers the editor. Everything else
is the platform. TipTap earns its place: ProseMirror's schema enforcement, input
rules, history and paste handling are exactly the parts that are painful to
reimplement and that quietly corrupt documents when they are subtly wrong.

The package contains:

- `<databis-docs>`, a responsive documentation browser with category
  navigation, article search, a table of contents and rich-text editing for
  authorized users.
- `createArticleEditor`, the editor on its own, for a custom UI.
- `DocsApiClient`, for applications that want to build everything themselves.
- `renderTiptapDocument`, a dependency-free DOM renderer for reading. Pages that
  only display documentation never load the editor.
- The shared schema definition, so the editor cannot drift from what the backend
  accepts.
- Strict TypeScript source with declarations generated from the implementation.

## Requirements

- A modern browser with Custom Elements and `fetch`.
- A modern ESM-aware bundler, Node.js CommonJS loader, or direct browser import
  of the compiled ESM entry.
- `databis/laravel-docs-module` with the same major version.

| npm | Composer |
| --- | --- |
| `@databis/docs-module ^1.0` | `databis/laravel-docs-module ^1.0` |

## Install

```bash
npm install @databis/docs-module
```

Import the module and its styles once:

```js
import '@databis/docs-module'
import '@databis/docs-module/style.css'
```

Then use the element in HTML:

```html
<databis-docs
  base-url="/api/docs"
  storage-base-url="/storage"
  locale="es"
  sync-hash
></databis-docs>
```

`base-url` is required in normal mode and is omitted when the component
receives `testing: true`. `storage-base-url` is only used for image `src`
values that are not already absolute, and defaults to `/storage`. With `sync-hash`, the current location looks like
`#category-slug/article-slug` and survives a reload.

## Local testing without a backend

Pass the `testing` variable to the main component to replace `DocsApiClient`
with `LocalWorker`. This mode never calls `fetch`: reads, categories, articles,
edits, publication state, revisions and testing images are kept locally.

```js
const testing = true
const docs = document.querySelector('databis-docs')

docs.options = {
  testing,
  locale: 'es',
  testingStorage: 'localStorage',
  testingStorageKey: '@databis/docs-module/my-test',
  testingData: {
    categories: [],
    articles: []
  }
}
```

`localStorage` is the default, so `testingStorage` may be omitted. The
`testingData` value only seeds an empty store; reloading the page keeps all
later changes. The current normalized state is also available from
`docs.testingData`.

For an inspectable global variable instead of `localStorage`, select the global
adapter and name the property that will contain all data:

```js
window.docsTestingData = {
  categories: [],
  articles: []
}

docs.options = {
  testing: true,
  testingStorage: 'global',
  testingGlobalKey: 'docsTestingData',
  testingData: window.docsTestingData
}
```

The boolean HTML attribute is supported too:

```html
<databis-docs testing locale="es"></databis-docs>
```

When `testing` is false or absent, the component uses the normal API client and
`baseURL` is required. `examples/index.html` runs in testing mode by default;
adding `?storage=global` stores its state in `window.docsTestingData`.

## Authentication and JavaScript options

Functions cannot be represented as HTML attributes. Assign `options` when a
token or custom messages are needed:

```js
const docs = document.querySelector('databis-docs')

docs.options = {
  baseURL: '/api/docs',
  storageBaseURL: '/storage',
  locale: 'es',
  getAuthToken: () => localStorage.getItem('token'),
  messages: {
    search: 'Buscar en el manual'
  }
}
```

### Laravel Sanctum cookies

For Sanctum cookie authentication, omit `getAuthToken`. Cookie credentials are
included by default. Before the first authenticated write, the host application
must obtain the CSRF cookie in the normal Sanctum login flow:

```js
await fetch('http://127.0.0.1:8000/sanctum/csrf-cookie', {
  credentials: 'include'
})

docs.options = {
  baseURL: 'http://127.0.0.1:8000/api/docs',
  storageBaseURL: 'http://127.0.0.1:8000/storage',
  credentials: 'include'
}
```

On every `POST`, `PUT`, `PATCH` and `DELETE`, `DocsApiClient` reads the current
`XSRF-TOKEN` cookie, URL-decodes it and sends it as `X-XSRF-TOKEN`. The browser
continues to attach the cookie itself; JavaScript is not allowed to set a
`Cookie` request header.

Do not copy a token into the package options. Laravel rotates it with the
session, so the client reads the current cookie before every write. If the
frontend and backend use different ports, use the same hostname for both
(`127.0.0.1` or `localhost`, but do not mix them).

The names can be changed for a customized backend:

```js
docs.options = {
  baseURL: '/api/docs',
  xsrfCookieName: 'XSRF-TOKEN',
  xsrfHeaderName: 'X-XSRF-TOKEN',
  withXsrfToken: true
}
```

## Imperative mounting

`createDocsModule` is useful when the host owns the target element:

```js
import { createDocsModule } from '@databis/docs-module'
import '@databis/docs-module/style.css'

const docs = createDocsModule(document.querySelector('#documentation'), {
  baseURL: '/api/docs',
  storageBaseURL: '/storage',
  locale: 'en'
})

await docs.selectCategory('getting-started')
```

## Framework integration

The element exposes `category` and `article` properties and emits native
bubbling events. Framework adapters only have to synchronize those values.

### Vue

```vue
<script setup>
import '@databis/docs-module'
import '@databis/docs-module/style.css'

function navigate(event) {
  router.push({
    name: 'docs',
    params: event.detail
  })
}
</script>

<template>
  <databis-docs
    base-url="/api/docs"
    storage-base-url="/storage"
    :category="$route.params.category"
    :article="$route.params.article"
    @docs:navigate="navigate"
  />
</template>
```

### React

React passes string attributes to Custom Elements. Attach the namespaced event
with a ref because it is a native `CustomEvent`:

```jsx
import { useEffect, useRef } from 'react'
import '@databis/docs-module'
import '@databis/docs-module/style.css'

export function Documentation({ category, article, navigate }) {
  const docsRef = useRef(null)

  useEffect(() => {
    const element = docsRef.current
    element.options = {
      baseURL: '/api/docs',
      getAuthToken: () => localStorage.getItem('token')
    }
    element.addEventListener('docs:navigate', navigate)

    return () => element.removeEventListener('docs:navigate', navigate)
  }, [navigate])

  return <databis-docs ref={docsRef} category={category} article={article} />
}
```

Angular and Svelte can consume the same element as a normal Web Component. In
Angular, add `CUSTOM_ELEMENTS_SCHEMA` to the module or standalone component.

## Events

| Event | `detail` | When |
| --- | --- | --- |
| `docs:ready` | `{ categories, capabilities }` | Initial data and permissions are available |
| `docs:navigate` | `{ category, article }` | The selected route changes |
| `docs:category-create` | `{ category }` | A category is created |
| `docs:create` | `{ article }` | An article is created |
| `docs:change` | `{ article }` | An article is saved |
| `docs:delete` | `{ article }` | An article is deleted |
| `docs:category-delete` | `{ category }` | A category is deleted |
| `docs:error` | `{ error }` | An API or rendering operation fails |

All events bubble.

## Headless API usage

```js
import { DocsApiClient } from '@databis/docs-module/api'

const api = new DocsApiClient({
  baseURL: '/api/docs',
  getAuthToken: () => sessionStorage.getItem('token')
})

const { data: categories } = await api.getCategories({ locale: 'es' })
const { data: article } = await api.getArticle('guides', 'installation')
```

The client covers categories, articles, capabilities, search, publishing,
revisions and image uploads. Failed responses throw `DocsApiError`, whose
`status`, `data` and `response` properties contain the server response.

## Rendering only

```js
import { renderTiptapDocument } from '@databis/docs-module/renderer'

const { element, headings } = renderTiptapDocument(article.content, {
  storageBaseURL: '/storage'
})

document.querySelector('main').replaceChildren(element)
```

The renderer is independent of TipTap — importing it does not pull the editor
into the bundle. It creates DOM nodes and assigns text through `textContent`; it
does not inject article HTML. Link protocols are restricted to HTTP(S), mail, phone,
root-relative and in-page URLs. The Laravel package must still sanitize the
JSON when it is saved.

## Theming

Pass one primary color through the package configuration. The complete palette
(interactive states, soft backgrounds, borders, text tones and shadows) is
derived from it. The default is `#3176A1`.

```js
const docs = createDocsModule(document.querySelector('#documentation'), {
  baseURL: '/api/docs',
  primaryColor: '#6750A4'
})
```

The HTML attribute and JavaScript property are supported too:

```html
<databis-docs base-url="/api/docs" primary-color="#6750A4"></databis-docs>
```

```js
document.querySelector('databis-docs').primaryColor = '#6750A4'
```

Layout variables can still be customized independently:

```css
databis-docs {
  --docs-height: calc(100dvh - 4rem);
  --docs-editor-height: 24rem;
  --docs-navigation-width: 20rem;
  --docs-content-width: 60rem;
}
```

`--docs-height` defaults to `100dvh`. The category and article navigation, the
open article, and the table of contents scroll independently within that
height. `--docs-editor-height` caps the editing surface the same way, at
`31.25rem` by default.

The component renders in the light DOM deliberately. This lets a design system
style it without piercing a Shadow DOM boundary.

## Editing

The element requests `GET /me/capabilities` during startup. When
`can.create_category` is true, a **New category** button appears next to the
category list, including when the installation has no content yet. The
administrator can create a root or nested category from there.

Once at least one category exists, `can.create_article` shows a **New article**
button next to the article list. The form lets the administrator choose a
category, enter the title and excerpt, and write the content in TipTap. New
articles are created as drafts; if their resource returns `can.publish: true`,
they can then be published from the article header.

The empty-installation flow is therefore:

1. Select **+** beside Categories and create the first category.
2. Select **+** beside Articles and create a draft.
3. Open the draft and select **Publish**.

Article listings request `?drafts=1` only when `can.view_drafts` is true. The
backend authorizes that query again, so sending the parameter manually never
exposes drafts to a reader.

When an article resource returns `can.update: true`, its edit button opens the
same TipTap form. It supports bold, italic, strikethrough, inline code,
headings, lists, quotes, code blocks, links, images, tables, dividers and
undo/redo. The category, title, excerpt and document can all be changed.

The writing surface scrolls inside its own frame, capped by
`--docs-editor-height` (`31.25rem`, and never more than `70vh`), so the toolbar
stays in place however long the document gets. Letting the pane scroll instead
pushed the toolbar off the top, and `overflow: hidden` on the editor frame
meant a sticky toolbar could not have fixed it.

### Tables

A second toolbar row appears under the formatting one whenever the caret is
inside a table, and hides again when it leaves. It inserts and deletes columns
and rows, merges or splits cells, toggles the header row and header column, and
deletes the table. Controls that would do nothing on the current selection —
deleting the only column, splitting a cell that was never merged — are disabled
rather than silently ignored.

Columns are resizable by dragging their border; the drag handle is drawn in the
accent colour so it is visible. Column widths are stored as `colwidth` on the
cell, which the backend sanitizer keeps.

Saving sends `updated_at` for optimistic locking. A `409 Conflict` loads the
current server version and warns, instead of overwriting another editor's work.

The UI never trusts a role name supplied by the host. It renders every action
from the API capabilities and per-resource `can` blocks, while Laravel
authorizes every write again.

### Images

Pasting or dropping an image file uploads it to `POST /images` and inserts the
result. The toolbar button does the same through a file picker.

The **internal path is stored, not the absolute URL** — the same reasoning that
keeps `path` rather than a URL in the database, so content survives a change of
domain or storage disk. The editor resolves it against `storageBaseURL` for
display only.

`storageBaseURL` **defaults to `/storage`**, which is where `php artisan
storage:link` publishes the public disk, so images load without any extra
configuration. Set it only when storage lives somewhere else — another host, a
CDN, a non-default disk. Leaving it empty no longer means "use the bare path":
that resolved against the *current page*, so an article opened at
`/view-admin/sistema/users` requested
`/view-admin/sistema/users/docs-images/...` and every image 404'd.

This is also why pasting has to be intercepted: left alone, a pasted screenshot
becomes a base64 data URI, the backend sanitizer rejects `data:` as a scheme,
and the image silently disappears on save.

### Using the editor on its own

```js
import { createArticleEditor } from '@databis/docs-module/editor'

const editor = createArticleEditor({
  mount: document.querySelector('#editor'),
  content: article.content,
  storageBaseURL: '/storage',
  uploadImage: (file) => api.uploadImage(file).then((response) => response.data),
  onUpdate: () => { dirty = true }
})

await api.updateArticle(article.id, {
  title,
  content: editor.getJSON(),
  updated_at: article.updated_at
})

editor.destroy()
```

`editor.editor` is the underlying TipTap instance, for commands this package
does not wrap. **Always call `destroy()`** before unmounting: a ProseMirror view
that outlives its host keeps the whole document alive.

### Staying in step with the backend

The extension set is pinned to the node and mark lists the Laravel package
accepts, exported from `@databis/docs-module/schema`:

```js
import { allowedMarks, allowedNodes } from '@databis/docs-module/schema'
```

Adding a TipTap extension without adding its node to `content.allowed_nodes` in
the backend config produces the module's nastiest failure mode: writing looks
fine, the save returns 200, and the content comes back with whole nodes missing
because the sanitizer stripped what it did not recognise. No error is raised
anywhere. `test/schema.test.ts` asserts both directions of that mapping.

## Browser import without a bundler

The compiled ESM entry includes the TipTap runtime, so an import map only needs
to resolve the package name:

```html
<script type="importmap">
{
  "imports": {
    "@databis/docs-module": "/node_modules/@databis/docs-module/dist/index.js"
  }
}
</script>
<link rel="stylesheet" href="/node_modules/@databis/docs-module/dist/style.css">
<script type="module">
  import '@databis/docs-module'
</script>
```

`examples/index.html` imports the local compiled entry and can be opened directly
against a running backend after `npm run build`.

### Read-only pages

A page that only displays documentation should import the renderer rather than
the whole module. It has no dependencies at all, so TipTap never reaches the
browser:

```js
import { renderTiptapDocument } from '@databis/docs-module/renderer'
```

## Development

```bash
npm install
npm run typecheck
npm run build
npm test
npm run check
```

## License

This project is licensed under [CC BY-NC-SA 4.0](LICENSE) — Attribution-NonCommercial-ShareAlike.
You may share and adapt this work for non-commercial purposes with attribution, under the same license.
For commercial use, please contact Databis to obtain a commercial license.
