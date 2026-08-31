import { JSDOM } from 'jsdom';

/**
 * Minimal browser globals for tests that touch ProseMirror.
 *
 * TipTap reads `navigator` while building an editor — it sniffs the platform
 * for keymaps — so a bare `document` is not enough and the failure is an
 * unhelpful "navigator is not defined" from deep inside the constructor.
 */
export function installDom(html = '<!doctype html><html><body></body></html>') {
  const dom = new JSDOM(html, { pretendToBeVisual: true });

  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLFormElement: dom.window.HTMLFormElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    DocumentFragment: dom.window.DocumentFragment,
    getComputedStyle: dom.window.getComputedStyle,
    DOMParser: dom.window.DOMParser,
    customElements: dom.window.customElements,
    CustomEvent: dom.window.CustomEvent,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,

    // TipTap's focus command schedules through requestAnimationFrame, and
    // jsdom only exposes it on the window, so a bare global is missing.
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window)
  };

  Object.entries(globals).forEach(([key, value]) => {
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true
    });
  });

  return dom;
}
