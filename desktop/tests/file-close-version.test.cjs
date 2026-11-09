const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Y = require('yjs');
function load(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/features', file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('require', 'module', 'exports', code)(name => name in mocks ? mocks[name] : require(name), module, module.exports);
  return module.exports;
}
function harness(documentId = 'file-a') {
  const effects = [], jobs = [], options = [];
  let ref = 0, control, doc, binding, failedRecovery = false, failedQueue = false;
  const scope = { projectId: 'project', teamId: 'team', workstreamId: 'stream' };
  const snapshot = load('editor/documentSnapshot.ts');
  const storage = load('editor/documentStorage.ts', { '@tauri-apps/api/core': { invoke() {} } });
  const monaco = { KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 2 }, languages: { getLanguages: () => [] }, editor: {
    createModel: () => ({ dispose() {} }),
    create: () => ({ updateOptions: value => options.push(value), onDidBlurEditorWidget: () => ({ dispose() {} }), addCommand() {}, dispose() {} }),
  } };
  const mocks = {
    react: { useRef: initial => ({ current: ref++ === 0 ? {} : initial }), useState: initial => [initial, () => {}], useEffect: effect => effects.push(effect) },
    'monaco-editor/esm/vs/editor/editor.api.js': monaco,
    'monaco-editor/esm/vs/basic-languages/monaco.contribution.js': {}, 'monaco-editor/esm/vs/language/json/monaco.contribution.js': {},
    'monaco-editor/esm/vs/editor/editor.worker?worker': {}, 'monaco-editor/esm/vs/language/json/json.worker?worker': {},
    'y-monaco': { MonacoBinding: class { constructor() { binding = this; } destroy() {} } },
    '../../config': { COLLABORATION_WS_URL: 'ws://local' }, '../auth/session': { getCurrentUser: () => ({ id: 'user' }), getCollaborationToken() {} },
    './documentStorage': { ...storage, nativeDocumentStorage: () => ({}) }, './documentSnapshot': snapshot,
    './editorLanguage': { languageForPath: () => 'plaintext' },
    './autoSave': load('editor/autoSave.ts'),
    './documentConnection': { connectDocument: input => {
      doc = input.doc; doc.getText('content').insert(0, 'hello');
      input.onState({ phase: 'connected', ready: true, pending: false, persisting: false, message: '' });
      return { dispose() {}, retry() {}, persist: async () => {
        if (failedRecovery) throw new Error('recovery failure');
        return { version: 2, ready: true, snapshot: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'),
          pending: [{ operationId: 'last-operation' }], sequence: 7 };
      } };
    }, documentIdForPath: value => value },
  };
  const previous = global.self; global.self = {};
  const { CollaborativeEditor } = load('editor/CollaborativeEditor.tsx', mocks);
  global.self = previous;
  CollaborativeEditor({ ...scope, documentId, filePath: documentId, initialContent: 'hello', theme: 'dark', fontSize: 14, fontFamily: 'monospace', active: true,
    onDirtyChange() {}, onConnectionChange() {}, onSave: async () => {}, onVersionControl: value => { control = value; },
    versions: { retain: () => ({ update() {}, release() {} }), enqueue: async target => { if (failedQueue) throw new Error('queue failure'); jobs.push(target); } },
  });
  const cleanup = effects[0]();
  return { jobs, options, control: () => control, text: doc.getText('content'),
    edit: value => doc.transact(() => doc.getText('content').insert(doc.getText('content').length, value), binding),
    failRecovery: () => { failedRecovery = true; }, failQueue: () => { failedQueue = true; }, cleanup };
}

test('typing and pasting never create a version until close preparation', async () => {
  const editor = harness();
  try {
    for (let i = 0; i < 20; i++) editor.edit('\npasted line');
    assert.equal(editor.jobs.length, 0);
    assert.equal(await editor.control().prepare(), true);
    assert.equal(editor.jobs.length, 1);
    assert.equal(editor.jobs[0].documentId, 'file-a');
    assert.equal(editor.jobs[0].afterOperationId, 'last-operation');
  } finally { editor.cleanup(); }
});

test('unchanged files and undone edits produce no version, and disposal does not simulate a close', async () => {
  const editor = harness();
  try {
    assert.equal(await editor.control().prepare(), false);
    assert.equal(editor.jobs.length, 0);
  } finally { editor.cleanup(); }
  const undone = harness();
  undone.edit('x'); undone.text.delete(undone.text.length - 1, 1);
  assert.equal(await undone.control().prepare(), false); undone.cleanup(); assert.equal(undone.jobs.length, 0);
  const crashed = harness(); crashed.edit('not closed'); crashed.cleanup(); assert.equal(crashed.jobs.length, 0);
});

test('two open files create independent requests only for the one being closed', async () => {
  const a = harness('file-a'), b = harness('file-b');
  try {
    a.edit(' A'); b.edit(' B');
    await a.control().prepare();
    assert.equal(a.jobs.length, 1); assert.equal(b.jobs.length, 0);
    await b.control().prepare(); assert.equal(b.jobs.length, 1);
  } finally { a.cleanup(); b.cleanup(); }
});

test('recovery or checkpoint queue failures keep the editor writable for retry', async () => {
  for (const fail of ['failRecovery', 'failQueue']) {
    const editor = harness();
    try {
      editor.edit(' changed'); editor[fail]();
      await assert.rejects(editor.control().prepare(), /failure/);
      assert.equal(editor.jobs.length, 0);
      assert.equal(editor.options.at(-1).readOnly, false);
    } finally { editor.cleanup(); }
  }
});
