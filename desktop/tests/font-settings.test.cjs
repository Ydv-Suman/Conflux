const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
require.extensions['.tsx'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText, filename);
const { readFontPreferences, saveFontPreferences, FontSettings, parseFontSize, DEFAULT_FONT_PREFERENCES, FILE_FONT_FAMILIES, EDITOR_FONT_FAMILIES, fontFamilyCss } = require('../src/features/editor/FontSettings.tsx');
const previousStorage = global.localStorage;
afterEach(() => { global.localStorage = previousStorage; });

test('independent font sizes persist across reload and reject invalid stored preferences', () => {
  let stored = null;
  global.localStorage = { getItem: () => stored, setItem: (_key, value) => { stored = value; } };
  assert.deepEqual(readFontPreferences(), DEFAULT_FONT_PREFERENCES);
  saveFontPreferences({ ...DEFAULT_FONT_PREFERENCES, fileNames: 18, editor: 22 });
  assert.deepEqual(readFontPreferences(), { ...DEFAULT_FONT_PREFERENCES, fileNames: 18, editor: 22 });
  stored = '{bad'; assert.deepEqual(readFontPreferences(), DEFAULT_FONT_PREFERENCES);
  stored = '{"fileNames":0,"editor":999}'; assert.deepEqual(readFontPreferences(), { ...DEFAULT_FONT_PREFERENCES, fileNames: 10, editor: 32 });
  stored = '{"fileNames":"20","editor":null}'; assert.deepEqual(readFontPreferences(), DEFAULT_FONT_PREFERENCES);
});

test('unavailable browser storage does not prevent changing settings for the current session', () => {
  global.localStorage = { getItem() { throw new Error('unavailable'); }, setItem() { throw new Error('unavailable'); } };
  assert.deepEqual(readFontPreferences(), DEFAULT_FONT_PREFERENCES);
  assert.doesNotThrow(() => saveFontPreferences({ ...DEFAULT_FONT_PREFERENCES, fileNames: 16, editor: 20 }));
});

test('settings expose two separately labelled size controls with units and a reset action', () => {
  const html = renderToStaticMarkup(React.createElement(FontSettings, { preferences: { ...DEFAULT_FONT_PREFERENCES, fileNames: 16, editor: 20 }, onChange() {}, onClose() {} }));
  assert.equal((html.match(/type="number"/g) || []).length, 2);
  assert.ok(html.includes('for="font-size-fileNames"'));
  assert.ok(html.includes('for="font-size-editor"'));
  assert.ok(html.includes('value="16"'));
  assert.ok(!html.includes('type="range"'));
  assert.ok(html.includes('value="20"'));
  assert.ok(!html.includes('Font size preview'));
  assert.ok(html.includes('>Reset</button>'));
  assert.ok(html.includes('>Done</button>'));
});

test('typed sizes only apply whole numbers in range, rejecting incomplete input', () => {
  assert.equal(parseFontSize('18', 10, 24), 18);
  for (const value of ['', ' ', '2', '25', '12.5', 'wrong', 'Infinity']) {
    assert.equal(parseFontSize(value, 10, 24), null);
  }
  assert.equal(parseFontSize('32', 10, 32), 32);
});

test('family preferences survive reload while old size preferences and unknown families use defaults', () => {
  let stored = '{"fileNames":17,"editor":19}';
  global.localStorage = { getItem: () => stored, setItem: (_key, value) => { stored = value; } };
  assert.deepEqual(readFontPreferences(), { ...DEFAULT_FONT_PREFERENCES, fileNames: 17, editor: 19 });
  const preferences = { fileNames: 18, editor: 20, fileFamily: 'georgia', editorFamily: 'jetbrains-mono' };
  saveFontPreferences(preferences);
  assert.deepEqual(readFontPreferences(), preferences);
  stored = '{"fileFamily":"unknown","editorFamily":"unsafe-css"}';
  assert.deepEqual(readFontPreferences(), DEFAULT_FONT_PREFERENCES);
  assert.match(fontFamilyCss(FILE_FONT_FAMILIES, 'georgia'), /^Georgia,/);
  assert.match(fontFamilyCss(EDITOR_FONT_FAMILIES, 'jetbrains-mono'), /^"JetBrains Mono",/);
  assert.equal(fontFamilyCss(EDITOR_FONT_FAMILIES, 'unknown'), EDITOR_FONT_FAMILIES[0].css);
});

test('font dialog presents size and family controls in the requested order with six choices each', () => {
  const html = renderToStaticMarkup(React.createElement(FontSettings, {
    preferences: { ...DEFAULT_FONT_PREFERENCES, fileFamily: 'georgia', editorFamily: 'consolas' }, onChange() {}, onClose() {},
  }));
  const labels = ['File font size', 'File font family', 'Editor font size', 'Editor font family'];
  for (let i = 1; i < labels.length; i++) assert.ok(html.indexOf(labels[i - 1]) < html.indexOf(labels[i]));
  assert.equal((html.match(/<select /g) || []).length, 2);
  assert.equal((html.match(/<option /g) || []).length, 12);
  assert.ok(html.includes('value="georgia" selected=""'));
  assert.ok(html.includes('value="consolas" selected=""'));
});
