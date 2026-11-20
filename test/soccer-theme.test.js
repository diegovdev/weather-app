const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const css = fs.readFileSync(__dirname + '/../styles.css', 'utf8');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');

test('soccer skin paints the .app backdrop', () => {
  assert.match(css, /\[data-skin="soccer"\] \.app\b[^{]*\{[^}]*repeating-linear-gradient/);
});

test('soccer toggle has stable accessible name and aria-pressed', () => {
  assert.match(html, /id="soccerToggle"[^>]*aria-pressed="false"[^>]*aria-label="Soccer theme"/);
});
