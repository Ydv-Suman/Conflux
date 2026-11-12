const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('require', 'module', 'exports', code)(name => name in mocks ? mocks[name] : require(name), module, module.exports);
  return module.exports;
}
const calls = [];
const api = load('features/changes/api.ts', { '@tauri-apps/api/core': { invoke: async (...args) => { calls.push(args); } } });
const file = (path, indexStatus = ' ', worktreeStatus = 'M') => ({ path, originalPath: null, indexStatus, worktreeStatus });
test('Git requests carry the expected root, exact path and HEAD', async () => {
  await api.getChanges('/worktree'); await api.getFileDiff('/worktree', '-name\nfile', 'abc');
  assert.deepEqual(calls, [['repository_changes', { root: '/worktree' }], ['repository_file_diff', { root: '/worktree', path: '-name\nfile', revision: 'abc' }]]);
  assert.equal(api.changeLabel(file('x', 'M', 'M')), 'Staged: Modified · Unstaged: Modified');
  assert.equal(api.changeLabel(file('x', '?', '?')), 'Untracked');
  assert.equal(api.changeLabel(file('x', 'A', 'A')), 'Conflict');
  assert.equal(api.changeLabel(file('x', 'R', ' ')), 'Staged: Renamed');
});
function buttons(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(buttons);
  return [...(tree.type === 'button' ? [tree] : []), ...buttons(tree.props?.children)];
}
function harness(mocks) {
  let cursor = 0, pending = []; const slots = [], portals = [];
  const react = {
    useState(initial) {
      const index = cursor++; if (!(index in slots)) slots[index] = initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useEffect(effect, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) pending.push(() => {
        previous?.cleanup?.(); slots[index] = { deps, cleanup: effect() };
      });
    },
  };
  const { ChangesPanel } = load('features/changes/ChangesPanel.tsx', {
    'react-dom': { createPortal: (node, target) => { portals.push(target); return node; } },
    react, './api': { ...api, ...mocks }, './changes.css': {}, '../history/history.css': {},
    '../../components/PanelHeader': load('components/PanelHeader.tsx'),
    '../../components/Modal': { Modal: ({ children }) => React.createElement('div', null, children) },
    '../history/HistoryDiff': { HistoryDiff: ({ diff, format }) => React.createElement('pre', null, `${format}:${diff.after}`) },
  });
  return {
    portals,
    render(root = '/repo') { cursor = 0; return ChangesPanel({ root, theme: 'dark', onClose() {} }); },
    effects() { const effects = pending; pending = []; effects.forEach(effect => effect()); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
const settle = () => new Promise(setImmediate);
test('selection and repository switches discard old responses; refresh clears old diffs and surfaces errors', async () => {
  const oldWindow = global.window, oldDocument = global.document;
  global.document = { body: { portalRoot: true } };
  let focus, removed = 0, rejectStatus = false, resolveOld;
  global.window = { addEventListener: (_name, fn) => { focus = fn; }, removeEventListener: () => { removed++; } };
  const component = harness({
    getChanges: async () => { if (rejectStatus) throw Error('Git unavailable'); return { branch: 'main', revision: 'head', files: [file('a'), file('b')] }; },
    getFileDiff: async (_root, path) => path === 'a' ? new Promise(resolve => { resolveOld = resolve; }) : { before: 'base', after: 'new-b' },
  });
  const flush = async root => { component.render(root); component.effects(); await settle(); };
  const select = name => buttons(component.render()).find(button => button.props.title === name).props.onClick();
  try {
    await flush(); await flush(); select('a'); await flush();
    select('b'); await flush(); await flush();
    assert.ok(renderToStaticMarkup(component.render()).includes('text:new-b'));
    assert.ok(component.portals.length > 0);
    assert.ok(component.portals.every(target => target === global.document.body), 'Git diff must escape the clipped sidebar by mounting at document.body');
    resolveOld({ before: 'base', after: 'stale-a' }); await settle();
    assert.ok(!renderToStaticMarkup(component.render()).includes('stale-a'));
    rejectStatus = true; focus(); await flush(); await flush();
    let html = renderToStaticMarkup(component.render());
    assert.ok(html.includes('Git unavailable')); assert.ok(!html.includes('new-b'));
    rejectStatus = false; focus(); await flush(); await flush(); select('a'); await flush();
    await flush('/other'); await flush('/other');
    resolveOld({ before: '', after: 'old-repository' }); await settle();
    assert.ok(!renderToStaticMarkup(component.render('/other')).includes('old-repository'));
    await flush(null); await flush(null);
    assert.ok(renderToStaticMarkup(component.render(null)).includes('Open a local workstream'));
  } finally { component.unmount(); global.window = oldWindow; global.document = oldDocument; }
  assert.equal(removed, 1);
});
test('plain-text Monaco diff stays read-only and disposes resources', () => {
  let effect, options, pair, disposed = 0;
  const { HistoryDiff } = load('features/history/HistoryDiff.tsx', {
    react: { useRef: () => ({ current: {} }), useState: () => ['', () => {}], useEffect: fn => { effect = fn; } },
    '../editor/documentSnapshot': { snapshotText: () => { throw Error('raw Git text must not be decoded as Yjs'); } },
    '../editor/editorLanguage': { languageForPath: () => 'plaintext' },
    'monaco-editor/esm/vs/editor/editor.api.js': {
      languages: { getLanguages: () => [] }, editor: {
        createModel: text => ({ text, dispose() { disposed++; } }),
        createDiffEditor: (_element, config) => { options = config; return { setModel: models => { pair = models; }, dispose() { disposed++; } }; },
      },
    },
  });
  HistoryDiff({ diff: { path: 'file', before: 'before', after: 'after' }, format: 'text', theme: 'light' });
  const cleanup = effect();
  assert.equal(options.readOnly, true); assert.equal(options.originalEditable, false);
  assert.equal(pair.original.text, 'before'); assert.equal(pair.modified.text, 'after');
  cleanup(); assert.equal(disposed, 3);
});
