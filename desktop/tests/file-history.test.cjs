const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/features', file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('require', 'module', 'exports', code)(name => name in mocks ? mocks[name] : require(name), module, module.exports);
  return module.exports;
}
const calls = [];
const api = load('history/api.ts', {
  '../../config': { COLLABORATION_WS_URL: 'wss://collab.example' },
  '../auth/session': { authenticatedServiceRequest: async (...args) => { calls.push(args); } },
});
test('history and diff use authenticated exact-scope endpoints with stable sequence cursors', async () => {
  const scope = { projectId: 'p /', teamId: 't?', workstreamId: 'w#' };
  await api.getHistory(scope, 'file/one', 37);
  await api.getVersionDiff(scope, 'file/one', 15);
  assert.deepEqual(calls.map(call => call[0]), ['https://collab.example', 'https://collab.example']);
  assert.equal(calls[0][1], '/api/projects/p%20%2F/teams/t%3F/workstreams/w%23/documents/file%2Fone/history?before=37');
  assert.equal(calls[1][1], '/api/projects/p%20%2F/teams/t%3F/workstreams/w%23/documents/file%2Fone/history/15');
  assert.ok(calls.every(call => call[2] === 'GET'));
});
test('legacy, migration, imported and unexpected records never claim verified authorship', () => {
  for (const kind of ['LEGACY_UPDATE', 'MIGRATION_BASELINE', 'IMPORTED_BASELINE', 'FUTURE_KIND'])
    assert.ok(api.versionLabel({ kind }).includes('authorship unknown'));
  assert.equal(api.versionLabel({ kind: 'ATTRIBUTED_EDIT' }), 'Collaborative edit');
});

// Exercise real component effects and cleanup using the same lightweight hook approach as workspace tests.
function harness(mocks) {
  const slots = []; let cursor = 0, pending = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useEffect(effect, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) pending.push(() => {
        previous?.cleanup?.(); slots[index] = { deps, cleanup: effect() };
      });
    },
  };
  const { FileHistory } = load('history/FileHistory.tsx', {
    react, 'react-dom': { createPortal: node => node },
    '../../components/Modal': { Modal: ({ children }) => React.createElement('div', null, children) },
    '../teams/api': { listTeamMembers: async () => [] }, './api': { ...api, ...mocks },
    './HistoryDiff': { HistoryDiff: ({ diff }) => React.createElement('pre', null, `diff-${diff.version.sequence}`) }, './history.css': {},
  });
  return {
    render() { cursor = 0; return FileHistory({ scope: { projectId: 'p', teamId: 't', workstreamId: 'w' }, documentId: 'd', path: 'main.py', theme: 'dark', onClose() {} }); },
    effects() { const next = pending; pending = []; next.forEach(effect => effect()); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
const settle = () => new Promise(setImmediate);
function buttons(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(buttons);
  return [...(tree.type === 'button' ? [tree] : []), ...buttons(tree.props?.children)];
}
test('paging clears stale diffs, refresh revocation clears records, and late responses are discarded', async () => {
  const oldWindow = global.window, oldDocument = global.document;
  let tick, removed = 0, revoked = false, resolveOld;
  global.document = { body: {} };
  global.window = { setInterval: fn => { tick = fn; return 1; }, clearInterval: () => { removed++; }, addEventListener() {}, removeEventListener() {} };
  const version = sequence => ({ sequence, actorId: 'account', timestamp: '2026-11-07T00:00:00Z', kind: 'ATTRIBUTED_EDIT' });
  const requests = [];
  const component = harness({
    getHistory: async (_scope, _doc, before) => {
      requests.push(before);
      if (revoked) throw new Error('Access denied');
      return { path: 'renamed.py', items: [version(before ? 1 : 3)], nextBefore: before ? null : 3 };
    },
    getVersionDiff: async (_scope, _doc, sequence) => sequence === 1 ? new Promise(resolve => { resolveOld = resolve; }) : { version: version(sequence), before: 'before', after: 'after' },
  });
  const flush = async () => { component.render(); component.effects(); await settle(); };
  try {
    for (let i = 0; i < 3; i++) await flush();
    assert.ok(renderToStaticMarkup(component.render()).includes('diff-3'));
    buttons(component.render()).find(button => button.props.children === 'Older versions').props.onClick();
    for (let i = 0; i < 2; i++) await flush();
    assert.deepEqual(requests, [undefined, 3]);
    assert.ok(!renderToStaticMarkup(component.render()).includes('diff-3'));
    buttons(component.render()).find(button => button.props.children === 'Newer versions').props.onClick();
    for (let i = 0; i < 3; i++) await flush();
    resolveOld({ version: version(1), before: 'old', after: 'old' }); await settle();
    assert.ok(renderToStaticMarkup(component.render()).includes('diff-3'));
    revoked = true; tick();
    for (let i = 0; i < 2; i++) await flush();
    const html = renderToStaticMarkup(component.render());
    assert.ok(html.includes('Access denied')); assert.ok(!html.includes('diff-3')); assert.ok(!html.includes('Edited by'));
  } finally { component.unmount(); global.window = oldWindow; global.document = oldDocument; }
  assert.equal(removed, 1);
});
test('Monaco comparison is read-only and releases both models and the editor', () => {
  let effect, options, disposed = 0, modelPair;
  const snapshot = load('editor/documentSnapshot.ts');
  const { HistoryDiff } = load('history/HistoryDiff.tsx', {
    react: { useRef: () => ({ current: {} }), useState: () => ['', () => {}], useEffect: fn => { effect = fn; } },
    'monaco-editor/esm/vs/editor/editor.api.js': {
      languages: { getLanguages: () => [] },
      editor: { createModel: text => ({ text, dispose: () => { disposed++; } }), createDiffEditor: (_element, config) => {
        options = config; return { setModel: pair => { modelPair = pair; }, dispose: () => { disposed++; } };
      } },
    },
    '../editor/documentSnapshot': snapshot, '../editor/editorLanguage': { languageForPath: () => 'plaintext' },
  });
  HistoryDiff({ diff: { path: 'file.txt', before: 'AAA=', after: 'AQEKAAQBB2NvbnRlbnQFaGVsbG8A' }, theme: 'dark' });
  const cleanup = effect();
  assert.equal(options.readOnly, true); assert.equal(options.originalEditable, false);
  assert.equal(modelPair.original.text, ''); assert.equal(modelPair.modified.text, 'hello');
  cleanup(); assert.equal(disposed, 3);
});
