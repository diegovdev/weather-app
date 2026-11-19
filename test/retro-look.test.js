const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SCRIPT_JS = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const STYLES_CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

// ---------------------------------------------------------------------------
// Minimal zero-dependency DOM + VM harness for index.html and script.js
// ---------------------------------------------------------------------------

class ClassList {
  constructor(el) {
    this._el = el;
  }
  _set() {
    const raw = this._el.getAttribute('class') || '';
    return new Set(raw.split(/\s+/).filter(Boolean));
  }
  _sync(set) {
    const val = [...set].join(' ');
    if (val) this._el.setAttribute('class', val);
    else this._el.removeAttribute('class');
  }
  add(...names) {
    const set = this._set();
    for (const n of names) if (n) set.add(n);
    this._sync(set);
  }
  remove(...names) {
    const set = this._set();
    for (const n of names) set.delete(n);
    this._sync(set);
  }
  contains(name) {
    return this._set().has(name);
  }
  toggle(name, force) {
    const set = this._set();
    const shouldAdd = force !== undefined ? Boolean(force) : !set.has(name);
    if (shouldAdd) set.add(name);
    else set.delete(name);
    this._sync(set);
    return shouldAdd;
  }
}

class MiniElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || 'DIV').toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this._attrs = new Map();
    this._listeners = new Map();
    this._text = '';
    this.style = {};
    this.classList = new ClassList(this);
    this.checked = false;
    this.selectedIndex = 0;
    this._value = undefined;

    this.dataset = new Proxy(
      {},
      {
        get: (_, prop) => {
          const attr = 'data-' + String(prop).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
          return this.getAttribute(attr) ?? undefined;
        },
        set: (_, prop, val) => {
          const attr = 'data-' + String(prop).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
          this.setAttribute(attr, String(val));
          return true;
        }
      }
    );
  }

  get id() {
    return this.getAttribute('id') || '';
  }
  set id(v) {
    this.setAttribute('id', String(v));
  }

  get className() {
    return this.getAttribute('class') || '';
  }
  set className(v) {
    this.setAttribute('class', String(v));
  }

  get name() {
    return this.getAttribute('name') || '';
  }
  set name(v) {
    this.setAttribute('name', String(v));
  }

  get type() {
    if (this._attrs.has('type')) return this._attrs.get('type');
    return this.tagName === 'BUTTON' ? 'submit' : '';
  }
  set type(v) {
    this.setAttribute('type', String(v));
  }

  get value() {
    if (this._value !== undefined) return this._value;
    if (this.tagName === 'SELECT') {
      const opt = this.children[this.selectedIndex];
      return opt ? opt.value : '';
    }
    return this.getAttribute('value') || '';
  }
  set value(v) {
    this._value = String(v);
  }

  get src() {
    return this.getAttribute('src') || '';
  }
  set src(v) {
    this.setAttribute('src', String(v));
  }

  get alt() {
    return this.getAttribute('alt') || '';
  }
  set alt(v) {
    this.setAttribute('alt', String(v));
  }

  get title() {
    return this.getAttribute('title') || '';
  }
  set title(v) {
    this.setAttribute('title', String(v));
  }

  getAttribute(name) {
    const key = String(name).toLowerCase();
    return this._attrs.has(key) ? this._attrs.get(key) : null;
  }

  setAttribute(name, value) {
    const key = String(name).toLowerCase();
    this._attrs.set(key, String(value));
    if (key === 'checked') this.checked = true;
  }

  removeAttribute(name) {
    this._attrs.delete(String(name).toLowerCase());
  }

  hasAttribute(name) {
    return this._attrs.has(String(name).toLowerCase());
  }

  appendChild(child) {
    if (child.parentNode) {
      const idx = child.parentNode.children.indexOf(child);
      if (idx !== -1) child.parentNode.children.splice(idx, 1);
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  contains(other) {
    let cur = other;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentNode;
    }
    return false;
  }

  get textContent() {
    if (this.children.length === 0) return this._text;
    return (this._text + this.children.map((c) => c.textContent).join('')).trim();
  }
  set textContent(v) {
    this.children = [];
    this._text = String(v ?? '');
  }

  get innerHTML() {
    return this._rawInnerHTML || '';
  }
  set innerHTML(html) {
    this._rawInnerHTML = String(html ?? '');
    this.children = [];
    this._text = '';
    if (this._rawInnerHTML.trim()) {
      parseHTMLInto(this._rawInnerHTML, this, this.ownerDocument);
    }
  }

  scrollIntoView() {}
  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }

  dispatchEvent(event) {
    event.target = event.target || this;
    let defaultPrevented = false;
    event.preventDefault = () => {
      defaultPrevented = true;
      event.defaultPrevented = true;
    };
    let propagationStopped = false;
    event.stopPropagation = () => {
      propagationStopped = true;
    };

    const handlers = this._listeners.get(event.type) || [];
    for (const fn of [...handlers]) {
      fn.call(this, event);
    }

    if (event.bubbles !== false && !propagationStopped) {
      if (this.parentNode) {
        this.parentNode.dispatchEvent(event);
      } else if (this.ownerDocument && this === this.ownerDocument.documentElement) {
        this.ownerDocument.dispatchEvent(event);
      }
    }
    return !defaultPrevented;
  }

  click() {
    this.dispatchEvent({ type: 'click', bubbles: true });
  }

  pressKey(key) {
    const allowed = this.dispatchEvent({
      type: 'keydown',
      key,
      bubbles: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false
    });
    // Native HTML <button> activates click on Enter or Space unless preventDefault() was called
    if (allowed && this.tagName === 'BUTTON' && (key === 'Enter' || key === ' ')) {
      this.click();
    }
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const groups = selector.split(',').map((s) => s.trim()).filter(Boolean);
    const out = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (groups.some((sel) => matchesCompoundSelector(child, sel))) {
          out.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return out;
  }
}

function matchesSimpleSelector(el, sel) {
  let rest = sel.trim();
  if (!rest) return false;

  const tagMatch = rest.match(/^[a-zA-Z0-9-]+/);
  if (tagMatch) {
    if (el.tagName !== tagMatch[0].toUpperCase()) return false;
    rest = rest.slice(tagMatch[0].length);
  }

  const tokenRe = /#([a-zA-Z0-9_-]+)|\.([a-zA-Z0-9_-]+)|\[([a-zA-Z0-9_-]+)(?:=([^\]]+))?\]|:not\(([^)]+)\)/g;
  let m;
  let consumed = 0;
  while ((m = tokenRe.exec(rest)) !== null) {
    consumed += m[0].length;
    if (m[1]) {
      if (el.id !== m[1]) return false;
    } else if (m[2]) {
      if (!el.classList.contains(m[2])) return false;
    } else if (m[3]) {
      const attrVal = el.getAttribute(m[3]);
      if (m[4] === undefined) {
        if (attrVal === null) return false;
      } else {
        const expected = m[4].replace(/^['"]|['"]$/g, '');
        if (attrVal !== expected) return false;
      }
    } else if (m[5]) {
      if (matchesSimpleSelector(el, m[5])) return false;
    }
  }
  return consumed === rest.length;
}

function matchesCompoundSelector(el, selector) {
  const parts = selector.trim().split(/\s+/);
  let cur = el;
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part === '>') continue;
    if (i === parts.length - 1) {
      if (!matchesSimpleSelector(cur, part)) return false;
      cur = cur.parentNode;
    } else {
      while (cur && !matchesSimpleSelector(cur, part)) {
        cur = cur.parentNode;
      }
      if (!cur) return false;
      cur = cur.parentNode;
    }
  }
  return true;
}

const VOID_TAGS = new Set(['META', 'LINK', 'IMG', 'INPUT', 'BR', 'HR', 'SOURCE']);

function parseAttributes(attrText, el) {
  const attrRe = /([a-zA-Z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = attrRe.exec(attrText)) !== null) {
    const name = m[1];
    const val = m[2] ?? m[3] ?? m[4] ?? '';
    el.setAttribute(name, val);
  }
}

function parseHTMLInto(html, rootParent, doc) {
  const clean = html.replace(/<!--[\s\S]*?-->/g, '');
  const tokenRe = /<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)([^>]*?)(\/?)>|([^<]+)/g;
  const stack = [rootParent];
  let m;
  while ((m = tokenRe.exec(clean)) !== null) {
    if (m[1]) {
      const closeTag = m[1].toUpperCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === closeTag) {
          stack.length = i;
          break;
        }
      }
    } else if (m[2]) {
      const tag = m[2].toUpperCase();
      if (tag === '!DOCTYPE') continue;
      const el = new MiniElement(tag, doc);
      parseAttributes(m[3] || '', el);
      stack[stack.length - 1].appendChild(el);
      if (!m[4] && !VOID_TAGS.has(tag)) {
        stack.push(el);
      }
    } else if (m[5]) {
      const txt = m[5];
      if (txt.trim()) {
        const top = stack[stack.length - 1];
        top._text = (top._text ? top._text + ' ' : '') + txt.trim();
      }
    }
  }
}

class MiniStorage {
  constructor(seed = {}) {
    this._map = new Map(Object.entries(seed));
  }
  getItem(k) {
    return this._map.has(String(k)) ? this._map.get(String(k)) : null;
  }
  setItem(k, v) {
    this._map.set(String(k), String(v));
  }
  removeItem(k) {
    this._map.delete(String(k));
  }
  clear() {
    this._map.clear();
  }
  snapshot() {
    return Object.fromEntries(this._map.entries());
  }
}

function createSampleWeatherPayload() {
  const hours = Array.from({ length: 168 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 10, 19, i, 0, 0));
    return d.toISOString().slice(0, 16);
  });
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 10, 19 + i));
    return d.toISOString().slice(0, 10);
  });
  return {
    current: {
      temperature_2m: 20,
      relative_humidity_2m: 55,
      apparent_temperature: 18,
      precipitation: 2.5,
      weather_code: 61,
      surface_pressure: 1015,
      wind_speed_10m: 16,
      wind_direction_10m: 180,
      visibility: 10000
    },
    daily: {
      time: days,
      weather_code: [61, 3, 0, 2, 61, 3, 45],
      temperature_2m_max: [20, 21, 24, 25, 21, 25, 24],
      temperature_2m_min: [14, 15, 14, 13, 15, 16, 15],
      sunrise: days.map((d) => `${d}T06:30`),
      sunset: days.map((d) => `${d}T17:30`),
      uv_index_max: [4, 5, 6, 5, 3, 4, 3]
    },
    hourly: {
      time: hours,
      temperature_2m: hours.map((_, i) => 15 + (i % 8)),
      weather_code: hours.map(() => 0)
    }
  };
}

async function flushAsync(turns = 6) {
  for (let i = 0; i < turns; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

async function bootApp({ storage = new MiniStorage(), geocodingResults } = {}) {
  const docListeners = new Map();
  const winListeners = new Map();

  const document = {
    activeElement: null,
    documentElement: null,
    body: null,
    createElement(tag) {
      return new MiniElement(tag, document);
    },
    getElementById(id) {
      return document.documentElement.querySelector(`#${id}`);
    },
    querySelector(sel) {
      if (matchesCompoundSelector(document.documentElement, sel)) return document.documentElement;
      return document.documentElement.querySelector(sel);
    },
    querySelectorAll(sel) {
      const out = [];
      if (matchesCompoundSelector(document.documentElement, sel)) out.push(document.documentElement);
      out.push(...document.documentElement.querySelectorAll(sel));
      return out;
    },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    dispatchEvent(ev) {
      const list = docListeners.get(ev.type) || [];
      for (const fn of [...list]) fn(ev);
    }
  };

  const virtualRoot = new MiniElement('#document', document);
  const htmlWithoutDoctype = INDEX_HTML.replace(/<!DOCTYPE[^>]*>/i, '');
  parseHTMLInto(htmlWithoutDoctype, virtualRoot, document);
  document.documentElement = virtualRoot.children.find((c) => c.tagName === 'HTML');
  document.documentElement.parentNode = null;
  document.body = document.documentElement.querySelector('body');

  const fetchCalls = [];
  const defaultLocations = geocodingResults ?? [
    { name: 'Madrid', admin1: 'Madrid', country: 'Spain', latitude: 40.4165, longitude: -3.7026 },
    { name: 'Lisbon', admin1: 'Lisbon', country: 'Portugal', latitude: 38.7167, longitude: -9.1333 }
  ];

  const mockFetch = async (url) => {
    const strUrl = String(url);
    fetchCalls.push(strUrl);
    if (strUrl.includes('geocoding-api.open-meteo.com')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { results: defaultLocations };
        }
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return createSampleWeatherPayload();
      }
    };
  };

  class MockCustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }

  const windowObj = {
    document,
    localStorage: storage,
    CustomEvent: MockCustomEvent,
    fetch: mockFetch,
    AbortController,
    URLSearchParams,
    Date,
    Math,
    JSON,
    parseInt,
    parseFloat,
    String,
    Array,
    Object,
    Promise,
    Error,
    console: { log() {}, error() {}, warn() {} },
    performance: { now: () => 0 },
    requestAnimationFrame: (cb) => setTimeout(() => cb(1000), 0),
    setTimeout,
    clearTimeout,
    navigator: {
      geolocation: {
        getCurrentPosition(_ok, err) {
          err(Object.assign(new Error('Permission denied'), { code: 1 }));
        }
      }
    },
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    dispatchEvent(ev) {
      const list = winListeners.get(ev.type) || [];
      for (const fn of [...list]) fn(ev);
    }
  };
  windowObj.window = windowObj;
  windowObj.globalThis = windowObj;

  const context = vm.createContext(windowObj);

  // 1. Execute inline <head> script(s) before first paint
  const headEl = document.documentElement.querySelector('head');
  for (const scriptEl of headEl ? headEl.querySelectorAll('script') : []) {
    if (!scriptEl.getAttribute('src') && scriptEl.textContent) {
      vm.runInContext(scriptEl.textContent, context);
    }
  }
  const lookBeforeDOMContentLoaded = document.documentElement.getAttribute('data-look');

  // 2. Execute script.js and fire DOMContentLoaded
  vm.runInContext(SCRIPT_JS, context);
  document.dispatchEvent({ type: 'DOMContentLoaded' });
  await flushAsync();

  return {
    document,
    window: windowObj,
    storage,
    fetchCalls,
    lookBeforeDOMContentLoaded
  };
}

// ---------------------------------------------------------------------------
// Minimal CSS cascade + color analyzer for styles.css
// ---------------------------------------------------------------------------

function parseStylesheet(cssText) {
  const noComments = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let order = 0;

  function parseBlocks(src, mediaCondition = null) {
    let i = 0;
    while (i < src.length) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (i >= src.length) break;

      if (src.startsWith('@import', i)) {
        const lineEnd = src.indexOf('\n', i);
        i = lineEnd === -1 ? src.length : lineEnd + 1;
        continue;
      }

      const braceStart = src.indexOf('{', i);
      if (braceStart === -1) break;

      const prelude = src.slice(i, braceStart).trim();
      let depth = 1;
      let j = braceStart + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
        j++;
      }
      const body = src.slice(braceStart + 1, j - 1);

      if (prelude.startsWith('@media')) {
        parseBlocks(body, prelude.slice('@media'.length).trim());
      } else if (!prelude.startsWith('@')) {
        const decls = [];
        for (const part of body.split(';')) {
          const colon = part.indexOf(':');
          if (colon === -1) continue;
          const prop = part.slice(0, colon).trim().toLowerCase();
          const val = part.slice(colon + 1).trim();
          if (prop && val) decls.push({ prop, val });
        }
        for (const sel of prelude.split(',').map((s) => s.trim()).filter(Boolean)) {
          rules.push({ selector: sel, media: mediaCondition, decls, order: order++ });
        }
      }
      i = j;
    }
  }

  parseBlocks(noComments);
  return rules;
}

function mediaMatches(media, width = 1280) {
  if (!media) return true;
  if (/prefers-contrast:\s*high/i.test(media)) return false;
  if (/prefers-reduced-motion:\s*reduce/i.test(media)) return false;
  if (/orientation:\s*landscape/i.test(media) && /max-height/i.test(media)) return false;

  const minMatches = [...media.matchAll(/min-width:\s*(\d+)px/g)];
  for (const m of minMatches) {
    if (width < Number(m[1])) return false;
  }
  const maxMatches = [...media.matchAll(/max-width:\s*(\d+)px/g)];
  for (const m of maxMatches) {
    if (width > Number(m[1])) return false;
  }
  return true;
}

function computeSpecificity(selector) {
  const s = selector.replace(/::[a-zA-Z-]+/g, '');
  const ids = (s.match(/#[a-zA-Z0-9_-]+/g) || []).length;
  const classesAttrsPseudos =
    (s.match(/\.[a-zA-Z0-9_-]+/g) || []).length +
    (s.match(/\[[^\]]+\]/g) || []).length +
    (s.match(/:(?!root\b)[a-zA-Z-]+(?:\([^)]*\))?/g) || []).length +
    (s.includes(':root') ? 1 : 0);
  const stripped = s
    .replace(/#[a-zA-Z0-9_-]+/g, ' ')
    .replace(/\.[a-zA-Z0-9_-]+/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/:[a-zA-Z-]+(?:\([^)]*\))?/g, ' ');
  const tags = (stripped.match(/\b[a-zA-Z][a-zA-Z0-9-]*\b/g) || []).length;
  return [ids, classesAttrsPseudos, tags];
}

function compareRank(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.spec[i] !== b.spec[i]) return a.spec[i] - b.spec[i];
  }
  return a.order - b.order;
}

function selectorMatchesChain(selector, chain) {
  // Normalize :root to html
  const normalized = selector.replace(/:root\b/g, 'html').trim();
  // Reject pseudo-elements or interactive states (:hover, :active, :focus, ::before, etc.)
  if (/::|:(hover|active|focus|focus-visible|nth-child)\b/.test(normalized)) return false;

  const tokens = normalized
    .replace(/\s*>\s*/g, ' > ')
    .split(/\s+/)
    .filter(Boolean);

  function matchSimple(node, simple) {
    if (simple === '*') return true;
    let rest = simple;
    const tagMatch = rest.match(/^[a-zA-Z0-9-]+/);
    if (tagMatch) {
      if (node.tag !== tagMatch[0].toLowerCase()) return false;
      rest = rest.slice(tagMatch[0].length);
    }
    const re = /#([a-zA-Z0-9_-]+)|\.([a-zA-Z0-9_-]+)|\[([a-zA-Z0-9_-]+)(?:=([^\]]+))?\]/g;
    let m;
    let consumed = 0;
    while ((m = re.exec(rest)) !== null) {
      consumed += m[0].length;
      if (m[1]) {
        if (node.id !== m[1]) return false;
      } else if (m[2]) {
        if (!(node.classes || []).includes(m[2])) return false;
      } else if (m[3]) {
        const val = (node.attrs || {})[m[3]];
        if (m[4] === undefined) {
          if (val === undefined) return false;
        } else {
          const expected = m[4].replace(/^['"]|['"]$/g, '');
          if (val !== expected) return false;
        }
      }
    }
    return consumed === rest.length;
  }

  let nodeIdx = chain.length - 1;
  let tokIdx = tokens.length - 1;
  if (!matchSimple(chain[nodeIdx], tokens[tokIdx])) return false;
  tokIdx--;
  nodeIdx--;

  while (tokIdx >= 0) {
    if (tokens[tokIdx] === '>') {
      tokIdx--;
      if (nodeIdx < 0 || !matchSimple(chain[nodeIdx], tokens[tokIdx])) return false;
      tokIdx--;
      nodeIdx--;
    } else {
      while (nodeIdx >= 0 && !matchSimple(chain[nodeIdx], tokens[tokIdx])) {
        nodeIdx--;
      }
      if (nodeIdx < 0) return false;
      tokIdx--;
      nodeIdx--;
    }
  }
  return true;
}

function isValidPropertyValue(prop, val) {
  if ((prop === 'background' || prop === 'background-image') && /gradient\(/i.test(val)) {
    // A valid CSS gradient needs at least 2 color stops / colors (catches `linear-gradient(135deg, 100%)`)
    const colors = extractColors(val);
    if (colors.length < 2 && !/var\(--/.test(val)) return false;
  }
  return true;
}

function cascadeForChain(rules, chain, width = 1280) {
  const matched = [];
  for (const r of rules) {
    if (!mediaMatches(r.media, width)) continue;
    if (!selectorMatchesChain(r.selector, chain)) continue;
    matched.push({ ...r, spec: computeSpecificity(r.selector) });
  }
  matched.sort(compareRank);

  const props = new Map();
  for (const r of matched) {
    for (const { prop, val } of r.decls) {
      if (!isValidPropertyValue(prop, val)) continue;
      if (prop === 'background') {
        props.set('background', val);
        props.delete('background-color');
        props.delete('background-image');
      } else {
        props.set(prop, val);
      }
    }
  }
  return props;
}

function resolveVars(val, customProps, depth = 0) {
  if (!val || depth > 10 || !val.includes('var(')) return val;
  return val.replace(/var\(\s*(--[a-zA-Z0-9_-]+)(?:\s*,\s*([^)]+))?\)/g, (_, name, fallback) => {
    const resolved = customProps.get(name) ?? fallback ?? '';
    return resolveVars(resolved, customProps, depth + 1);
  });
}

function hslToRgb(h, s, l) {
  const hue = (((h % 360) + 360) % 360) / 360;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const light = Math.max(0, Math.min(100, l)) / 100;
  if (sat === 0) {
    const v = Math.round(light * 255);
    return [v, v, v];
  }
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const hue2rgb = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(hue + 1 / 3) * 255),
    Math.round(hue2rgb(hue) * 255),
    Math.round(hue2rgb(hue - 1 / 3) * 255)
  ];
}

function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
    }
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

function relativeLuminance([r, g, b]) {
  const chan = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

function contrastRatio(rgbA, rgbB) {
  const l1 = relativeLuminance(rgbA);
  const l2 = relativeLuminance(rgbB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function extractColors(cssValue) {
  if (!cssValue) return [];
  const colors = [];
  const tokenRe =
    /hsla?\(\s*([+-]?\d+(?:\.\d+)?)\s*(?:deg)?\s*[,\s]\s*([+-]?\d+(?:\.\d+)?)%\s*[,\s]\s*([+-]?\d+(?:\.\d+)?)%(?:\s*[,/]\s*([+-]?\d*(?:\.\d+)?%?))?\s*\)|rgba?\(\s*(\d+)\s*[,\s]\s*(\d+)\s*[,\s]\s*(\d+)(?:\s*[,/]\s*([+-]?\d*(?:\.\d+)?%?))?\s*\)|#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
  let m;
  while ((m = tokenRe.exec(cssValue)) !== null) {
    let rgb;
    if (m[1] !== undefined) {
      rgb = hslToRgb(Number(m[1]), Number(m[2]), Number(m[3]));
    } else if (m[5] !== undefined) {
      rgb = [Number(m[5]), Number(m[6]), Number(m[7])];
    } else if (m[9] !== undefined) {
      const hex = m[9].length === 3 ? m[9].split('').map((c) => c + c).join('') : m[9];
      rgb = [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16)
      ];
    }
    const hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    colors.push({ raw: m[0], rgb, ...hsl });
  }
  return colors;
}

function isCoolBlueOrIndigo(color) {
  // Cool cyan/blue/indigo/violet hues (185..285 deg) with noticeable saturation
  return color.s >= 12 && color.h >= 185 && color.h <= 285;
}

const PARSED_RULES = parseStylesheet(STYLES_CSS);

function resolveSurface(chain, width = 1280) {
  const htmlChain = [chain[0]];
  const htmlProps = cascadeForChain(PARSED_RULES, htmlChain, width);
  const customProps = new Map();
  for (const [k, v] of htmlProps.entries()) {
    if (k.startsWith('--')) customProps.set(k, v);
  }

  const resolvedAt = (subChain) => {
    const raw = cascadeForChain(PARSED_RULES, subChain, width);
    const bgColor = resolveVars(raw.get('background-color') || '', customProps);
    const bgImg = resolveVars(raw.get('background-image') || '', customProps);
    const bgShort = resolveVars(raw.get('background') || '', customProps);
    const color = resolveVars(raw.get('color') || '', customProps);
    const fontFamily = resolveVars(raw.get('font-family') || '', customProps);
    const borderRadius = resolveVars(raw.get('border-radius') || '', customProps);
    return { raw, bg: bgColor || bgImg || bgShort, bgShort, bgColor, bgImg, color, fontFamily, borderRadius };
  };

  let surface = resolvedAt(chain);
  // If an element has transparent/none background (e.g. `.app { background: transparent }`), fall back up ancestors
  for (let idx = chain.length - 1; idx >= 1; idx--) {
    const cur = resolvedAt(chain.slice(0, idx + 1));
    if (cur.bg && !/^(transparent|none)$/i.test(cur.bg.trim())) {
      surface = { ...surface, effectiveBg: cur.bg };
      break;
    }
  }
  let effectiveColor = surface.color;
  for (let idx = chain.length - 1; !effectiveColor && idx >= 0; idx--) {
    effectiveColor = resolvedAt(chain.slice(0, idx + 1)).color;
  }
  return { ...surface, effectiveBg: surface.effectiveBg || surface.bg, effectiveColor, customProps };
}

// ---------------------------------------------------------------------------
// Acceptance Scenario Tests
// ---------------------------------------------------------------------------

test('Current look stays the default on initial load', async () => {
  const { document, lookBeforeDOMContentLoaded } = await bootApp();

  assert.equal(lookBeforeDOMContentLoaded, null, 'data-look must not be set before first paint by default');
  assert.equal(document.documentElement.getAttribute('data-look'), null, 'html must stay in default look');

  const toggle = document.getElementById('lookToggle');
  assert.ok(toggle, '#lookToggle must exist');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false', '#lookToggle must start unpressed');

  const defaultRoot = resolveSurface([{ tag: 'html', attrs: { 'data-theme': 'dark' } }]);
  assert.match(defaultRoot.customProps.get('--font-display') || '', /Bricolage Grotesque/);
});

test('Visible keyboard-accessible toggle switches between the current look and the 70s look', async () => {
  const { document } = await bootApp();
  const toggle = document.getElementById('lookToggle');

  assert.ok(toggle, '#lookToggle must be present in the header');
  assert.equal(toggle.tagName, 'BUTTON', '#lookToggle must be a native <button> for keyboard focus & activation');
  assert.equal(toggle.type, 'button', '#lookToggle should have type="button"');
  assert.equal(toggle.classList.contains('hidden'), false, '#lookToggle must be visible');
  assert.notEqual(toggle.getAttribute('tabindex'), '-1', '#lookToggle must remain reachable via Tab');
  assert.ok(
    (toggle.getAttribute('aria-label') || toggle.textContent).trim().length > 0,
    '#lookToggle must have an accessible name'
  );
  assert.match(STYLES_CSS, /\.look-toggle:focus-visible\s*\{[^}]*outline/s, '#lookToggle must have a focus-visible outline');

  // Activate via keyboard Enter -> switches to retro 70s look
  toggle.focus();
  toggle.pressKey('Enter');
  assert.equal(document.documentElement.getAttribute('data-look'), 'retro');
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');

  // Activate via keyboard Space -> switches back to default look
  toggle.pressKey(' ');
  assert.equal(document.documentElement.getAttribute('data-look'), null);
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');

  // Activate via click -> switches to retro 70s look again
  toggle.click();
  assert.equal(document.documentElement.getAttribute('data-look'), 'retro');
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
});

test('Retro 1970s look styles the whole page with warm earthy palette, rounded chunky shapes, and period display font', () => {
  const htmlRetroDark = { tag: 'html', attrs: { 'data-look': 'retro', 'data-theme': 'dark' } };
  const htmlRetroLight = { tag: 'html', attrs: { 'data-look': 'retro', 'data-theme': 'light' } };
  const htmlDefaultDark = { tag: 'html', attrs: { 'data-theme': 'dark' } };

  // 1. Period-style display font & larger chunky radii compared to default
  const defaultHeading = resolveSurface([htmlDefaultDark, { tag: 'body' }, { tag: 'h1', classes: ['main-title'] }]);
  const retroHeading = resolveSurface([htmlRetroDark, { tag: 'body' }, { tag: 'h1', classes: ['main-title'] }]);
  assert.notEqual(retroHeading.fontFamily, defaultHeading.fontFamily, 'retro look must switch display font');
  assert.match(retroHeading.fontFamily, /Shrikhand|Cooper/i, 'retro look must apply period-style display font');

  const defaultButton = resolveSurface([
    htmlDefaultDark,
    { tag: 'body' },
    { tag: 'button', id: 'searchButton', classes: ['btn', 'btn-primary', 'search-button'] }
  ]);
  const retroButton = resolveSurface([
    htmlRetroDark,
    { tag: 'body' },
    { tag: 'button', id: 'searchButton', classes: ['btn', 'btn-primary', 'search-button'] }
  ]);
  assert.ok(
    parseFloat(retroButton.borderRadius) > parseFloat(defaultButton.borderRadius),
    `retro buttons must use chunkier rounded corners than default (${retroButton.borderRadius} vs ${defaultButton.borderRadius})`
  );

  // 2. Whole-page warm earthy palette across viewport background & all weather cards (dark & light themes)
  const problems = [];
  for (const [themeName, htmlNode] of [
    ['dark', htmlRetroDark],
    ['light', htmlRetroLight]
  ]) {
    const bodyNode = { tag: 'body' };
    const appRainy = { tag: 'div', id: 'app', classes: ['app', 'weather-rainy'] };
    const appClear = { tag: 'div', id: 'app', classes: ['app', 'weather-clear'] };

    const surfaces = [
      ['page background (.app.weather-rainy)', [htmlNode, bodyNode, appRainy]],
      ['page background (.app.weather-clear)', [htmlNode, bodyNode, appClear]],
      [
        'hero card (.current-weather)',
        [htmlNode, bodyNode, appRainy, { tag: 'section', classes: ['current-weather', 'card'] }]
      ],
      [
        'metric card (.metric-card)',
        [htmlNode, bodyNode, appRainy, { tag: 'div', classes: ['metric-card', 'card'] }]
      ],
      [
        'daily forecast card (.forecast-day)',
        [htmlNode, bodyNode, appRainy, { tag: 'div', classes: ['forecast-day'] }]
      ],
      [
        'hourly forecast panel (.hourly-forecast)',
        [htmlNode, bodyNode, appRainy, { tag: 'section', classes: ['hourly-forecast', 'card'] }]
      ],
      [
        'hourly forecast row (.forecast-hour)',
        [htmlNode, bodyNode, appRainy, { tag: 'div', classes: ['forecast-hour'] }]
      ]
    ];

    for (const [label, chain] of surfaces) {
      const resolved = resolveSurface(chain);
      if (!resolved.effectiveBg) {
        problems.push(`${label} (${themeName}): no resolved background`);
        continue;
      }

      if (/bg-today-large\.svg/i.test(resolved.effectiveBg)) {
        problems.push(
          `${label} (${themeName}): keeps default royal-blue bg-today-large.svg background`
        );
        continue;
      }

      const bgColors = extractColors(resolved.effectiveBg);
      if (bgColors.length === 0) {
        problems.push(`${label} (${themeName}): background "${resolved.effectiveBg}" has no concrete colors`);
        continue;
      }

      const coolColors = bgColors.filter(isCoolBlueOrIndigo);
      if (coolColors.length > 0) {
        problems.push(
          `${label} (${themeName}): keeps non-retro blue/slate/indigo background (${coolColors.map((c) => c.raw).join(', ')})`
        );
      }

      const textColors = extractColors(resolved.effectiveColor);
      if (textColors.length > 0) {
        const bestContrast = Math.max(...bgColors.map((bg) => contrastRatio(textColors[0].rgb, bg.rgb)));
        if (bestContrast < 3.0) {
          problems.push(
            `${label} (${themeName}): low text contrast (${bestContrast.toFixed(2)}:1) between ${resolved.effectiveColor} and ${resolved.effectiveBg}`
          );
        }
      }
    }
  }

  assert.equal(
    problems.length,
    0,
    `Retro 1970s look does not switch the whole page cleanly:\n- ${problems.join('\n- ')}`
  );
});

test('Selected look survives a page reload', async () => {
  const sharedStorage = new MiniStorage();

  // Initial session: switch to retro
  const firstLoad = await bootApp({ storage: sharedStorage });
  firstLoad.document.getElementById('lookToggle').click();
  assert.equal(firstLoad.document.documentElement.getAttribute('data-look'), 'retro');
  assert.equal(sharedStorage.getItem('weatherAppLook'), 'retro');

  // Second session (reload): retro look applies before first paint and stays active
  const secondLoad = await bootApp({ storage: sharedStorage });
  assert.equal(secondLoad.lookBeforeDOMContentLoaded, 'retro', 'inline head script must restore retro before first paint');
  assert.equal(secondLoad.document.documentElement.getAttribute('data-look'), 'retro');
  assert.equal(secondLoad.document.getElementById('lookToggle').getAttribute('aria-pressed'), 'true');

  // Switch back to default and reload again
  secondLoad.document.getElementById('lookToggle').click();
  assert.equal(secondLoad.document.documentElement.getAttribute('data-look'), null);

  const thirdLoad = await bootApp({ storage: sharedStorage });
  assert.equal(thirdLoad.lookBeforeDOMContentLoaded, null);
  assert.equal(thirdLoad.document.documentElement.getAttribute('data-look'), null);
  assert.equal(thirdLoad.document.getElementById('lookToggle').getAttribute('aria-pressed'), 'false');
});

test('Existing layout and units toggle work in both looks', async () => {
  const { document } = await bootApp();

  // Verify retro rules preserve layout display/grid structure of main containers
  const defaultWeatherGrid = resolveSurface([
    { tag: 'html', attrs: { 'data-theme': 'dark' } },
    { tag: 'body' },
    { tag: 'div', id: 'app', classes: ['app'] },
    { tag: 'div', id: 'weatherData', classes: ['weather-data'] }
  ]);
  const retroWeatherGrid = resolveSurface([
    { tag: 'html', attrs: { 'data-look': 'retro', 'data-theme': 'dark' } },
    { tag: 'body' },
    { tag: 'div', id: 'app', classes: ['app'] },
    { tag: 'div', id: 'weatherData', classes: ['weather-data'] }
  ]);
  assert.equal(retroWeatherGrid.raw.get('display'), defaultWeatherGrid.raw.get('display'));
  assert.equal(retroWeatherGrid.raw.get('grid-template-columns'), defaultWeatherGrid.raw.get('grid-template-columns'));

  const unitsButton = document.getElementById('unitsButton');
  const unitsMenu = document.getElementById('unitsMenu');
  const imperialRadio = document.querySelector('input[name="system"][value="imperial"]');
  const metricRadio = document.querySelector('input[name="system"][value="metric"]');

  // Test units dropdown + Imperial conversion in default look
  assert.equal(document.getElementById('currentTemp').textContent, '20°C');
  assert.equal(document.getElementById('windSpeed').textContent, '16 km/h');
  assert.equal(document.getElementById('precipitation').textContent, '2.5 mm');

  unitsButton.click();
  assert.equal(unitsMenu.classList.contains('active'), true);
  assert.equal(unitsButton.getAttribute('aria-expanded'), 'true');

  imperialRadio.checked = true;
  imperialRadio.dispatchEvent({ type: 'change', bubbles: true });
  assert.equal(document.getElementById('currentTemp').textContent, '68°F');
  assert.equal(document.getElementById('windSpeed').textContent, '10 mph');
  assert.equal(document.getElementById('precipitation').textContent, '0.1 in');

  // Switch to retro 70s look (outside click closes open units menu) and verify units toggle & Metric conversion continue working
  document.getElementById('lookToggle').click();
  assert.equal(document.documentElement.getAttribute('data-look'), 'retro');
  assert.equal(unitsMenu.classList.contains('active'), false);

  unitsButton.click();
  assert.equal(unitsMenu.classList.contains('active'), true);
  assert.equal(unitsButton.getAttribute('aria-expanded'), 'true');

  metricRadio.checked = true;
  metricRadio.dispatchEvent({ type: 'change', bubbles: true });
  assert.equal(document.getElementById('currentTemp').textContent, '20°C');
  assert.equal(document.getElementById('windSpeed').textContent, '16 km/h');
  assert.equal(document.getElementById('precipitation').textContent, '2.5 mm');

  unitsButton.click();
  assert.equal(unitsMenu.classList.contains('active'), false);
  assert.equal(unitsButton.getAttribute('aria-expanded'), 'false');
});

test('Location search works in both looks', async () => {
  const { document, fetchCalls } = await bootApp({
    geocodingResults: [
      { name: 'Tokyo', admin1: 'Tokyo', country: 'Japan', latitude: 35.6895, longitude: 139.6917 },
      { name: 'Osaka', admin1: 'Osaka', country: 'Japan', latitude: 34.6937, longitude: 135.5022 }
    ]
  });

  const searchInput = document.getElementById('searchInput');
  const searchButton = document.getElementById('searchButton');
  const searchResults = document.getElementById('searchResults');

  // 1. Search in default look
  searchInput.value = 'Tokyo';
  searchButton.click();
  await flushAsync();

  assert.equal(searchResults.classList.contains('active'), true);
  let items = searchResults.querySelectorAll('.search-result-item');
  assert.equal(items.length, 2);
  items[0].click();
  await flushAsync();

  assert.equal(searchResults.classList.contains('active'), false);
  assert.equal(document.getElementById('currentLocation').textContent, 'Tokyo, Japan');

  // 2. Switch to retro 70s look and search via Enter key
  document.getElementById('lookToggle').click();
  assert.equal(document.documentElement.getAttribute('data-look'), 'retro');

  const countBefore = fetchCalls.length;
  searchInput.value = 'Osaka';
  searchInput.pressKey('Enter');
  await flushAsync();

  assert.ok(fetchCalls.length > countBefore, 'Enter in #searchInput must trigger geocoding fetch in retro look');
  assert.equal(searchResults.classList.contains('active'), true);
  items = searchResults.querySelectorAll('.search-result-item');
  assert.equal(items.length, 2);
  items[1].click();
  await flushAsync();

  assert.equal(document.getElementById('currentLocation').textContent, 'Osaka, Japan');
});
