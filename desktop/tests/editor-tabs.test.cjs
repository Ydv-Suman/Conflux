const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const compile = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
require.extensions['.ts'] = compile;
require.extensions['.tsx'] = compile;
const { editorTabsReducer: reduce } = require('../src/features/editor/editorTabs.ts');
const { FileTabs } = require('../src/features/editor/FileTabs.tsx');
const a = { path: 'src/index.html', content: '<main>Original</main>' };
const b = { path: 'src/style.css', content: 'body {}' };
const c = { path: 'test/index.html', content: 'test' };
const initial = { files: [a], activePath: a.path };

test('opening files adds tabs and reopening a dirty tab preserves its existing editor input', () => {
  let tabs = reduce(initial, { type: 'open', file: b });
  tabs = reduce(tabs, { type: 'dirty', path: a.path, dirty: true });
  const previous = tabs.files[0];
  tabs = reduce(tabs, { type: 'open', file: { ...a, content: 'changed on disk' } });
  assert.equal(tabs.files.length, 2);
  assert.equal(tabs.files[0], previous);
  assert.equal(tabs.files[0].dirty, true);
  assert.equal(tabs.activePath, a.path);
});

test('selecting tabs retains order and does not alter file content or dirty state', () => {
  const tabs = { files: [{ ...a, dirty: true }, b], activePath: b.path };
  const selected = reduce(tabs, { type: 'select', path: a.path });
  assert.equal(selected.files, tabs.files);
  assert.equal(selected.activePath, a.path);
  assert.equal(reduce(selected, { type: 'select', path: 'missing' }), selected);
});

test('closing inactive tabs keeps focus and closing active tabs selects a neighbor', () => {
  const tabs = { files: [a, b, c], activePath: b.path };
  assert.equal(reduce(tabs, { type: 'close', path: a.path }).activePath, b.path);
  assert.equal(reduce(tabs, { type: 'close', path: b.path }).activePath, c.path);
  assert.equal(reduce({ ...tabs, activePath: c.path }, { type: 'close', path: c.path }).activePath, b.path);
  assert.deepEqual(reduce(initial, { type: 'close', path: a.path }), { files: [], activePath: null });
});

test('saved and unsaved indicators belong only to the matching file', () => {
  const tabs = { files: [a, b], activePath: a.path };
  const dirty = reduce(tabs, { type: 'dirty', path: b.path, dirty: true });
  assert.equal(dirty.files[0], a);
  assert.equal(dirty.files[1].dirty, true);
  assert.equal(reduce(dirty, { type: 'dirty', path: b.path, dirty: true }), dirty);
  assert.equal(reduce(dirty, { type: 'dirty', path: b.path, dirty: false }).files[1].dirty, false);
});

test('tab bar shows file names, full-path tooltips, close actions, and accessible selection', () => {
  const html = renderToStaticMarkup(React.createElement(FileTabs, {
    files: [{ ...a, dirty: true }, b, c], activePath: a.path, onSelect() {}, onClose() {},
  }));
  assert.equal((html.match(/role="tab"/g) || []).length, 3);
  assert.equal((html.match(/aria-selected="true"/g) || []).length, 1);
  assert.ok(html.includes('index.html'));
  assert.ok(html.includes('style.css'));
  assert.ok(html.includes('title="test/index.html"'));
  assert.ok(html.includes('aria-label="Unsaved changes"'));
  assert.ok(html.includes('aria-label="Close src/index.html"'));
  assert.ok(html.includes('aria-controls="file-panel-src%2Findex.html"'));
});
