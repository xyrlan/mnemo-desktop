/** Structured reads of a browser pane for the desktop MCP: the page's text as light
 *  markdown (headings, links, list items, code) and a PNG/JPEG of what it shows. */

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

export type Page = { url: string; title: string; text: string; truncated: boolean }
export type Snapshot = { mime: string; data: string }

/** Characters of page text handed back; a model reading more than this wants a snapshot. */
export const MAX_TEXT = 60_000

/** Runs inside the page (a plain script, no module scope), synchronously, and evaluates to
 *  a JSON string: `evaluateJavaScript` does not await promises and drops exceptions, so
 *  both are handled here. Kept as source text rather than `fn.toString()` so a bundler
 *  can never rewrite it into something that references helpers the page lacks. */
export const PAGE_SCRIPT = `(function () {
  try {
    var MAX = ${MAX_TEXT};
    var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, CANVAS: 1, IFRAME: 1, HEAD: 1 };
    var BLOCK = { P: 1, DIV: 1, SECTION: 1, ARTICLE: 1, MAIN: 1, HEADER: 1, FOOTER: 1, NAV: 1, ASIDE: 1,
      UL: 1, OL: 1, TABLE: 1, TR: 1, FORM: 1, FIELDSET: 1, BLOCKQUOTE: 1, FIGURE: 1, DL: 1, DT: 1, DD: 1, BR: 1, HR: 1 };
    var out = [];
    var size = 0;
    var full = false;
    function put(s) {
      if (full) return;
      if (size + s.length > MAX) { s = s.slice(0, MAX - size); full = true; }
      out.push(s);
      size += s.length;
    }
    function hidden(el) {
      if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true;
      if (el.checkVisibility) return !el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true });
      return false;
    }
    function inline(el) {
      // innerText keeps the breaks between nested blocks ("Copilot" / "Write better code").
      return (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    }
    function walk(node, pre, cell) {
      if (full) return;
      if (node.nodeType === 3) {
        var t = pre ? node.nodeValue : node.nodeValue.replace(/\\s+/g, ' ');
        if (t) put(t);
        return;
      }
      if (node.nodeType !== 1) return;
      var el = node;
      var tag = el.tagName.toUpperCase();
      if (SKIP[tag] || hidden(el)) return;
      var h = /^H([1-6])$/.exec(tag);
      if (h) { var ht = inline(el); if (ht) put('\\n\\n' + '######'.slice(0, +h[1]) + ' ' + ht + '\\n\\n'); return; }
      if (tag === 'A' && el.getAttribute('href')) {
        var at = inline(el);
        if (at) put('[' + at + '](' + el.href + ')');
        return;
      }
      if (tag === 'IMG') { var alt = el.getAttribute('alt'); if (alt) put('![' + alt + ']'); return; }
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        var type = (el.getAttribute('type') || '').toLowerCase();
        if (type === 'hidden' || type === 'password') return;
        var label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || tag.toLowerCase();
        put(' [' + label + ': ' + (el.value || '') + '] ');
        return;
      }
      if (tag === 'BUTTON') { var bt = inline(el); if (bt) put(' [button: ' + bt + '] '); return; }
      if (tag === 'PRE') { put('\\n\\n\`\`\`\\n'); walk_children(el, true, false); put('\\n\`\`\`\\n\\n'); return; }
      if (tag === 'LI') {
        var mark = out.length;
        put('\\n- ');
        walk_children(el, pre, cell);
        // An empty item (icon-only menus) would print a bare bullet.
        if (!full && !/\\S/.test(out.slice(mark + 1).join(''))) size -= out.splice(mark).join('').length;
        return;
      }
      // A table row stays on one line: blocks inside a cell only add a space.
      if (tag === 'TD' || tag === 'TH') { put(' | '); walk_children(el, pre, true); return; }
      var gap = BLOCK[tag] ? (cell ? ' ' : '\\n') : '';
      put(gap);
      walk_children(el, pre, cell);
      put(gap);
    }
    function walk_children(el, pre, cell) {
      for (var c = el.firstChild; c && !full; c = c.nextSibling) walk(c, pre, cell);
    }
    if (document.body) walk(document.body, false, false);
    // Tidy the whitespace the walk left around blocks, outside code fences only.
    var parts = out.join('').split('\`\`\`');
    for (var i = 0; i < parts.length; i += 2) {
      parts[i] = parts[i].replace(/[ \\t]+\\n/g, '\\n').replace(/\\n[ \\t]+/g, '\\n')
        .replace(/\\n-\\n+/g, '\\n- ').replace(/[ \\t]{2,}/g, ' ').replace(/\\n{3,}/g, '\\n\\n');
    }
    var text = parts.join('\`\`\`').trim();
    return JSON.stringify({ url: String(location.href), title: document.title || '', text: text, truncated: full });
  } catch (e) {
    return JSON.stringify({ error: String(e && e.message || e) });
  }
})()`

/** Decodes what the webview hands back for PAGE_SCRIPT. WebKit serializes the script's
 *  value as JSON, so the page's own JSON string arrives quoted once more; an empty answer
 *  means the script threw before its own catch could run. */
export function parsePage(raw: string): Page {
  if (!raw) throw new Error('the page did not answer (it may still be loading)')
  let value: unknown = JSON.parse(raw)
  if (typeof value === 'string') value = JSON.parse(value)
  const v = value as Partial<Page> & { error?: string }
  if (v.error) throw new Error(`reading the page failed: ${v.error}`)
  return { url: String(v.url ?? ''), title: String(v.title ?? ''), text: String(v.text ?? ''), truncated: !!v.truncated }
}

export function formatPage(p: Page): string {
  const head = `# ${p.title || '(untitled)'}\n${p.url}\n\n`
  return head + (p.text || '(no text on the page)') + (p.truncated ? `\n\n[truncated at ${MAX_TEXT} characters]` : '')
}

/** The page in pane `id` as text. */
export async function readPage(invoke: Invoke, id: number): Promise<string> {
  return formatPage(parsePage(await invoke<string>('mcp_browser_eval', { id, script: PAGE_SCRIPT })))
}

/** What pane `id` shows, as an image the MCP can hand to the model. */
export function snapshotPage(invoke: Invoke, id: number): Promise<Snapshot> {
  return invoke<Snapshot>('mcp_browser_snapshot', { id })
}
