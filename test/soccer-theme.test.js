const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(rootDir, 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
const scriptSource = fs.readFileSync(path.join(rootDir, 'script.js'), 'utf8');

function parseInitialAttrs(id) {
  const tagMatch = html.match(new RegExp(`<([a-z0-9-]+)[^>]*\\bid="${id}"[^>]*>`, 'i'));
  const attrs = new Map();
  if (!tagMatch) return attrs;
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:="([^"]*)")?/g;
  let m;
  let first = true;
  while ((m = attrRe.exec(tagMatch[0])) !== null) {
    if (first) { first = false; continue; }
    attrs.set(m[1], m[2] ?? '');
  }
  return attrs;
}

function makeElement(id, initialAttrs = new Map()) {
  const attrs = new Map(initialAttrs);
  const listeners = new Map();
  return {
    id,
    style: {},
    classList: {
      add() {},
      remove() {},
      contains(cls) {
        return (attrs.get('class') || '').split(/\s+/).includes(cls);
      }
    },
    getAttribute(name) {
      return attrs.has(name) ? attrs.get(name) : null;
    },
    setAttribute(name, value) {
      attrs.set(name, String(value));
    },
    removeAttribute(name) {
      attrs.delete(name);
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    contains() {
      return false;
    },
    click() {
      for (const fn of listeners.get('click') || []) {
        fn({ preventDefault() {}, target: this });
      }
    }
  };
}

function bootApp(storageMap = new Map(), initialTheme = 'dark') {
  if (!storageMap.has('weatherAppTheme')) {
    storageMap.set('weatherAppTheme', initialTheme);
    storageMap.set('weatherAppAutoTheme', 'false');
  }

  const localStorage = {
    getItem(k) { return storageMap.has(k) ? storageMap.get(k) : null; },
    setItem(k, v) { storageMap.set(k, String(v)); },
    removeItem(k) { storageMap.delete(k); }
  };

  const documentElement = makeElement('html');
  const elementsById = new Map([
    ['soccerToggle', makeElement('soccerToggle', parseInitialAttrs('soccerToggle'))],
    ['themeToggle', makeElement('themeToggle', parseInitialAttrs('themeToggle'))],
    ['themeIcon', makeElement('themeIcon', parseInitialAttrs('themeIcon'))],
    ['app', makeElement('app', parseInitialAttrs('app'))]
  ]);

  const docListeners = new Map();
  const document = {
    documentElement,
    getElementById(id) {
      return elementsById.get(id) || null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    }
  };

  const window = {
    dispatchEvent() {}
  };

  const context = vm.createContext({
    window,
    document,
    localStorage,
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init?.detail; }
    },
    console: { log() {}, warn() {}, error() {} },
    setTimeout(fn) { fn(); return 0; },
    clearTimeout() {},
    Date,
    JSON,
    Math,
    parseInt,
    String
  });

  vm.runInContext(`${scriptSource}\nglobalThis.__app = { soccer, theme, appState };`, context);
  context.__app.theme.init();
  context.__app.soccer.init();

  return {
    storageMap,
    localStorage,
    documentElement,
    soccerToggle: elementsById.get('soccerToggle'),
    themeToggle: elementsById.get('themeToggle'),
    soccer: context.__app.soccer,
    theme: context.__app.theme,
    appState: context.__app.appState
  };
}

function stripCommentsAndMedia(source) {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  let out = '';
  let i = 0;
  while (i < noComments.length) {
    if (noComments.startsWith('@media', i) || noComments.startsWith('@keyframes', i)) {
      const braceStart = noComments.indexOf('{', i);
      if (braceStart === -1) break;
      let depth = 1;
      let j = braceStart + 1;
      while (j < noComments.length && depth > 0) {
        if (noComments[j] === '{') depth++;
        else if (noComments[j] === '}') depth--;
        j++;
      }
      i = j;
      continue;
    }
    out += noComments[i++];
  }
  return out;
}

function parseTopLevelRules(source) {
  const cleaned = stripCommentsAndMedia(source);
  const rules = [];
  const ruleRe = /([^{}@]+)\{([^{}]*)\}/g;
  let m;
  let order = 0;
  while ((m = ruleRe.exec(cleaned)) !== null) {
    const selectors = m[1].split(',').map(s => s.trim()).filter(Boolean);
    const decls = [];
    for (const part of m[2].split(';')) {
      const idx = part.indexOf(':');
      if (idx === -1) continue;
      const prop = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();
      if (prop && val) decls.push([prop, val]);
    }
    rules.push({ selectors, decls, order: order++ });
  }
  return rules;
}

function matchSimpleSelector(token, node) {
  let rest = token.trim();
  if (!rest || /::|:hover|:focus|:active|:nth-/.test(rest)) return null;
  let spec = 0;
  const tagMatch = rest.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
  if (tagMatch) {
    if (node.tag !== tagMatch[0].toLowerCase()) return null;
    rest = rest.slice(tagMatch[0].length);
    spec += 1;
  }
  while (rest.length > 0) {
    if (rest.startsWith(':root')) {
      if (node.tag !== 'html') return null;
      rest = rest.slice(5);
      spec += 10;
      continue;
    }
    const notMatch = rest.match(/^:not\(\[([a-zA-Z0-9_-]+)\]\)/);
    if (notMatch) {
      if ((node.attrs || {})[notMatch[1]] !== undefined) return null;
      rest = rest.slice(notMatch[0].length);
      spec += 10;
      continue;
    }
    const attrEq = rest.match(/^\[([a-zA-Z0-9_-]+)="([^"]*)"\]/);
    if (attrEq) {
      if ((node.attrs || {})[attrEq[1]] !== attrEq[2]) return null;
      rest = rest.slice(attrEq[0].length);
      spec += 10;
      continue;
    }
    const attrHas = rest.match(/^\[([a-zA-Z0-9_-]+)\]/);
    if (attrHas) {
      if ((node.attrs || {})[attrHas[1]] === undefined) return null;
      rest = rest.slice(attrHas[0].length);
      spec += 10;
      continue;
    }
    const clsMatch = rest.match(/^\.([a-zA-Z0-9_-]+)/);
    if (clsMatch) {
      if (!(node.classes || []).includes(clsMatch[1])) return null;
      rest = rest.slice(clsMatch[0].length);
      spec += 10;
      continue;
    }
    return null;
  }
  return spec;
}

function matchSelectorChain(sel, chain) {
  if (/[>+~]/.test(sel)) return null;
  const parts = sel.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || parts.length > chain.length) return null;

  const targetSpec = matchSimpleSelector(parts[parts.length - 1], chain[chain.length - 1]);
  if (targetSpec === null) return null;
  if (parts.length === 1) return targetSpec;

  function matchAncestors(pIdx, cIdx) {
    if (pIdx < 0) return 0;
    let best = null;
    for (let i = cIdx; i >= pIdx; i--) {
      const s = matchSimpleSelector(parts[pIdx], chain[i]);
      if (s !== null) {
        const prev = matchAncestors(pIdx - 1, i - 1);
        if (prev !== null && (best === null || s + prev > best)) {
          best = s + prev;
        }
      }
    }
    return best;
  }

  const ancSpec = matchAncestors(parts.length - 2, chain.length - 2);
  return ancSpec === null ? null : ancSpec + targetSpec;
}

function resolveRootVars(source, htmlAttrs) {
  const rules = parseTopLevelRules(source);
  const htmlChain = [{ tag: 'html', attrs: htmlAttrs }];
  const matched = [];
  for (const rule of rules) {
    let bestSpec = null;
    for (const sel of rule.selectors) {
      const s = matchSelectorChain(sel, htmlChain);
      if (s !== null && (bestSpec === null || s > bestSpec)) bestSpec = s;
    }
    if (bestSpec !== null) {
      matched.push({ spec: bestSpec, order: rule.order, decls: rule.decls });
    }
  }
  matched.sort((a, b) => a.spec - b.spec || a.order - b.order);
  const vars = {};
  for (const item of matched) {
    for (const [prop, val] of item.decls) {
      if (prop.startsWith('--')) vars[prop] = val;
    }
  }
  return vars;
}

function resolveVarValue(raw, vars, depth = 0) {
  if (!raw || depth > 5) return raw;
  return raw.replace(/var\(\s*(--[a-zA-Z0-9_-]+)\s*\)/g, (_, name) => {
    return vars[name] ? resolveVarValue(vars[name], vars, depth + 1) : '';
  }).trim();
}

function resolveSurfaceStyles(source, htmlAttrs, containerNode, textNode = null) {
  const vars = resolveRootVars(source, htmlAttrs);
  const rules = parseTopLevelRules(source);
  const baseChain = [
    { tag: 'html', attrs: htmlAttrs },
    { tag: 'body', classes: [] },
    { tag: 'div', classes: ['app'] }
  ];

  function computeProps(chain) {
    const matched = [];
    for (const rule of rules) {
      let bestSpec = null;
      for (const sel of rule.selectors) {
        const s = matchSelectorChain(sel, chain);
        if (s !== null && (bestSpec === null || s > bestSpec)) bestSpec = s;
      }
      if (bestSpec !== null) matched.push({ spec: bestSpec, order: rule.order, decls: rule.decls });
    }
    matched.sort((a, b) => a.spec - b.spec || a.order - b.order);
    const props = {};
    for (const item of matched) {
      for (const [prop, val] of item.decls) {
        props[prop] = resolveVarValue(val.replace(/!important/g, '').trim(), vars);
      }
    }
    return props;
  }

  const bodyProps = computeProps(baseChain.slice(0, 2));
  const boxChain = [...baseChain, containerNode];
  const boxProps = computeProps(boxChain);
  const txtProps = textNode ? computeProps([...boxChain, textNode]) : {};

  const bg = boxProps['background-color'] || boxProps['background'] || vars['--bg-secondary'];
  const color = txtProps['color'] || boxProps['color'] || bodyProps['color'] || vars['--text-primary'];
  return { bg, color, vars };
}

function parseColorToRgb(str) {
  const s = String(str).trim();
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    const hex = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16)
    ];
  }
  m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];

  m = s.match(/hsla?\(\s*([\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%/i);
  if (m) {
    const h = ((Number(m[1]) % 360) + 360) % 360;
    const sat = Number(m[2]) / 100;
    const lig = Number(m[3]) / 100;
    const c = (1 - Math.abs(2 * lig - 1)) * sat;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m0 = lig - c / 2;
    let [r1, g1, b1] = [0, 0, 0];
    if (h < 60) [r1, g1, b1] = [c, x, 0];
    else if (h < 120) [r1, g1, b1] = [x, c, 0];
    else if (h < 180) [r1, g1, b1] = [0, c, x];
    else if (h < 240) [r1, g1, b1] = [0, x, c];
    else if (h < 300) [r1, g1, b1] = [x, 0, c];
    else [r1, g1, b1] = [c, 0, x];
    return [
      Math.round((r1 + m0) * 255),
      Math.round((g1 + m0) * 255),
      Math.round((b1 + m0) * 255)
    ];
  }
  throw new Error(`Unsupported color format: ${str}`);
}

function contrastRatio(fgStr, bgStr) {
  const lum = (rgb) => {
    const [r, g, b] = rgb.map(v => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const l1 = lum(parseColorToRgb(fgStr));
  const l2 = lum(parseColorToRgb(bgStr));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

test('soccer skin paints the .app backdrop', () => {
  assert.match(css, /\[data-skin="soccer"\] \.app\b[^{]*\{[^}]*repeating-linear-gradient/);
});

test('soccer toggle has stable accessible name and aria-pressed', () => {
  assert.match(html, /id="soccerToggle"[^>]*aria-pressed="false"[^>]*aria-label="Soccer theme"/);
});

test('default-theme-off', () => {
  const app = bootApp(new Map(), 'dark');
  assert.strictEqual(app.documentElement.getAttribute('data-skin'), null);
  assert.strictEqual(app.soccer.isOn(), false);
  assert.strictEqual(app.soccerToggle.getAttribute('aria-pressed'), 'false');
  assert.strictEqual(app.soccerToggle.getAttribute('aria-label'), 'Soccer theme');
  assert.strictEqual(app.soccerToggle.getAttribute('title'), 'Turn on soccer theme');
});

test('enable-soccer-theme', () => {
  const app = bootApp(new Map(), 'dark');
  app.soccerToggle.click();

  assert.strictEqual(app.documentElement.getAttribute('data-skin'), 'soccer');
  assert.strictEqual(app.soccer.isOn(), true);
  assert.strictEqual(app.soccerToggle.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(app.soccerToggle.getAttribute('aria-label'), 'Soccer theme');
  assert.strictEqual(app.soccerToggle.getAttribute('title'), 'Turn off soccer theme');
  assert.strictEqual(app.localStorage.getItem('weatherAppSoccer'), 'true');
  assert.match(css, /\[data-skin="soccer"\] \.app\[class\*="weather-"\]\s*\{[^}]*repeating-linear-gradient/);
});

test('persist-across-reload', () => {
  const sharedStorage = new Map();
  const firstLoad = bootApp(sharedStorage, 'dark');
  firstLoad.soccerToggle.click();
  assert.strictEqual(sharedStorage.get('weatherAppSoccer'), 'true');

  const reloaded = bootApp(sharedStorage, 'dark');
  assert.strictEqual(reloaded.documentElement.getAttribute('data-skin'), 'soccer');
  assert.strictEqual(reloaded.soccer.isOn(), true);
  assert.strictEqual(reloaded.soccerToggle.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(reloaded.soccerToggle.getAttribute('title'), 'Turn off soccer theme');
});

test('light-dark-interaction', () => {
  const app = bootApp(new Map(), 'dark');
  app.soccerToggle.click();
  assert.strictEqual(app.documentElement.getAttribute('data-theme'), 'dark');
  assert.strictEqual(app.documentElement.getAttribute('data-skin'), 'soccer');

  // Toggle to light mode while soccer skin is active
  app.themeToggle.click();
  assert.strictEqual(app.documentElement.getAttribute('data-theme'), 'light');
  assert.strictEqual(app.documentElement.getAttribute('data-skin'), 'soccer');
  assert.strictEqual(app.soccerToggle.getAttribute('aria-pressed'), 'true');

  // Toggle back to dark mode while soccer skin is active
  app.themeToggle.click();
  assert.strictEqual(app.documentElement.getAttribute('data-theme'), 'dark');
  assert.strictEqual(app.documentElement.getAttribute('data-skin'), 'soccer');

  // Both dark and light modes with soccer skin must maintain readable text contrast (>= 4.5:1)
  for (const mode of ['dark', 'light']) {
    const attrs = { 'data-skin': 'soccer', 'data-theme': mode };
    const favoritesBtn = resolveSurfaceStyles(css, attrs, { tag: 'button', classes: ['favorites-button'] });
    const daySelector = resolveSurfaceStyles(css, attrs, { tag: 'select', classes: ['day-selector'] });
    const metricCard = resolveSurfaceStyles(css, attrs, { tag: 'div', classes: ['metric-card'] }, { tag: 'div', classes: ['metric-value'] });
    const forecastCard = resolveSurfaceStyles(css, attrs, { tag: 'div', classes: ['forecast-day'] }, { tag: 'div', classes: ['day-name'] });

    for (const [label, surface] of [
      ['.favorites-button', favoritesBtn],
      ['.day-selector', daySelector],
      ['.metric-card', metricCard],
      ['.forecast-day', forecastCard]
    ]) {
      const ratio = contrastRatio(surface.color, surface.bg);
      assert.ok(
        ratio >= 4.5,
        `Expected readable contrast (>= 4.5) on ${label} in ${mode} soccer theme, got ${ratio.toFixed(2)}:1 (${surface.color} on ${surface.bg})`
      );
    }
  }
});

test('soccer-theme-phone-width', () => {
  const attrs = parseInitialAttrs('soccerToggle');
  const classes = (attrs.get('class') || '').split(/\s+/);
  assert.ok(classes.includes('theme-toggle'), 'soccerToggle should share .theme-toggle mobile sizing');
  assert.ok(classes.includes('soccer-toggle'), 'soccerToggle should carry .soccer-toggle class');
  assert.match(css, /\[data-skin="soccer"\]\[data-theme="light"\] \.app\[class\*="weather-"\]\s*\{[^}]*repeating-linear-gradient/);
});

test('disable-soccer-theme', () => {
  const sharedStorage = new Map();
  const app = bootApp(sharedStorage, 'dark');
  app.soccerToggle.click();
  assert.strictEqual(app.soccer.isOn(), true);

  app.soccerToggle.click();
  assert.strictEqual(app.documentElement.getAttribute('data-skin'), null);
  assert.strictEqual(app.soccer.isOn(), false);
  assert.strictEqual(app.soccerToggle.getAttribute('aria-pressed'), 'false');
  assert.strictEqual(app.soccerToggle.getAttribute('title'), 'Turn on soccer theme');
  assert.strictEqual(app.localStorage.getItem('weatherAppSoccer'), 'false');

  const reloaded = bootApp(sharedStorage, 'dark');
  assert.strictEqual(reloaded.documentElement.getAttribute('data-skin'), null);
  assert.strictEqual(reloaded.soccer.isOn(), false);
});
