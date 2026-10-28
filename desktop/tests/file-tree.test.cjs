const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { baseline, nextChange, applyManifest, explorerTree } = require('../src/features/repository/fileTree.ts');
const { documentIdForPath } = require('../src/features/editor/documentConnection.ts');
const { editorTabsReducer } = require('../src/features/editor/editorTabs.ts');
const { connectTree } = require('../src/features/repository/treeConnection.ts');
const diskEntry = (path, identity = path, kind = 'FILE') => ({ path, identity, kind, fingerprint: 'content' });
const entry = (path, kind = 'FILE') => ({ id: path, path, kind });
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
const waitPoll = async () => { await new Promise((resolve) => setTimeout(resolve, 1050)); await flush(); };

test('baseline keeps old document IDs and parents; rename preserves IDs throughout subtree', () => {
  const initial = baseline(['src/Main.java']);
  assert.equal(initial.find((e) => e.path === 'src/Main.java').id, documentIdForPath('src/Main.java'));
  const moved = applyManifest(initial, { type: 'RENAME', path: 'src', targetPath: 'source' });
  assert.deepEqual(moved.map((e) => e.id), initial.map((e) => e.id));
  assert.deepEqual(moved.map((e) => e.path), ['source', 'source/Main.java']);
  assert.equal(explorerTree(moved)[0].children[0].path, 'source/Main.java');
});

test('local moves use native identity, create missing destination parents first, and delete whole folders once', () => {
  const observed = [diskEntry('src', 'dir', 'DIRECTORY'), diskEntry('src/Main.java', 'file')];
  const state = { version: 3, entries: [entry('src', 'DIRECTORY'), entry('src/Main.java')], observed };
  const renamed = observed.map((e) => ({ ...e, path: e.path.replace('src', 'code') }));
  assert.equal(nextChange(state, renamed).type, 'RENAME');
  assert.equal(nextChange(state, renamed).targetPath, 'code');
  assert.equal(nextChange(state, []).path, 'src');
  const movedIntoNewParent = [observed[0], diskEntry('new', 'new', 'DIRECTORY'), { ...observed[1], path: 'new/Main.java' }];
  const first = nextChange(state, movedIntoNewParent);
  assert.equal(first.type, 'CREATE'); assert.equal(first.entry.path, 'new');
  const second = nextChange({ ...state, entries: applyManifest(state.entries, first) }, movedIntoNewParent);
  assert.equal(second.type, 'RENAME'); assert.equal(second.targetPath, 'new/Main.java');
});

test('renamed tabs retain dirty content and document ID; deleted clean tabs close', () => {
  const state = { files: [{ path: 'Main.java', documentId: 'stable', content: 'unsaved', dirty: true }, { path: 'gone', documentId: 'gone', content: '' }], activePath: 'Main.java' };
  const next = editorTabsReducer(state, { type: 'tree', entries: [{ id: 'stable', path: 'Renamed.java' }] });
  assert.deepEqual(next.files, [{ ...state.files[0], path: 'Renamed.java' }]);
  assert.equal(next.activePath, 'Renamed.java');
  assert.equal(editorTabsReducer(state, { type: 'tree', entries: [] }).files[0].content, 'unsaved');
});

function harness(saved = null) {
  const sockets = [];
  class Socket {
    static OPEN = 1;
    constructor() { this.readyState = 1; this.sent = []; sockets.push(this); }
    send(value) { this.sent.push(JSON.parse(value)); }
    message(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
    close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
  }
  global.WebSocket = Socket;
  let stored = saved;
  let disk = [];
  const applied = [], states = [], trees = [];
  let dirty = [];
  const bridge = {
    load: async () => stored,
    save: async (value) => { stored = structuredClone(value); },
    snapshot: async () => structuredClone(disk),
    baseline: async () => [],
    content: async () => '',
    apply: async (command) => {
      applied.push(command);
      if (command.type === 'CREATE') disk.push(diskEntry(command.entry.path, command.entry.id, command.entry.kind));
      if (command.type === 'DELETE') disk = disk.filter((e) => e.path !== command.path && !e.path.startsWith(command.path + '/'));
      if (command.type === 'RENAME') disk = disk.map((e) => e.path === command.path || e.path.startsWith(command.path + '/') ? { ...e, path: command.targetPath + e.path.slice(command.path.length) } : e);
    },
  };
  const start = () => connectTree({ endpoint: 'ws://test/files', teamId: 'team', bridge, getToken: async () => 'token', dirtyPaths: () => dirty, onTree: (...value) => trees.push(value), onStatus: (value) => states.push(value) });
  return { start, sockets, applied, states, trees, stored: () => stored, setDisk: (value) => { disk = value; }, setDirty: (value) => { dirty = value; } };
}
const event = (version, command) => ({ type: 'event', version, command });
const init = { operationId: 'init', type: 'INITIALIZE', entries: [] };

test('replay applies creates, moves, and deletes without watcher echoes and persists cursor', async () => {
  const h = harness(); const connection = h.start();
  try {
    await flush(); const socket = h.sockets[0]; socket.onopen();
    assert.deepEqual(socket.sent[0], { teamId: 'team', token: 'token', afterVersion: 0 });
    socket.message(event(1, init));
    socket.message(event(2, { operationId: 'create', type: 'CREATE', entry: entry('Main.java'), content: '' }));
    socket.message(event(3, { operationId: 'move', type: 'RENAME', path: 'Main.java', targetPath: 'Other.java' }));
    socket.message(event(4, { operationId: 'delete', type: 'DELETE', path: 'Other.java' }));
    socket.message({ type: 'synced', initialized: true, version: 4 });
    await flush(); await waitPoll();
    assert.deepEqual(h.applied.map((c) => c.type), ['CREATE', 'RENAME', 'DELETE']);
    assert.equal(h.stored().version, 4); assert.deepEqual(h.stored().entries, []);
    assert.equal(socket.sent.length, 1);
  } finally { connection.dispose(); }
});

test('terminal create persists an exact pending command, retries it after restart, and does not apply own echo', async () => {
  const h = harness({ version: 1, entries: [], observed: [] }); let connection = h.start();
  try {
    h.setDisk([diskEntry('Main.java')]); await flush(); let socket = h.sockets[0]; socket.onopen();
    socket.message({ type: 'synced', initialized: true, version: 1 }); await flush();
    const pending = h.stored().pending;
    assert.equal(pending.type, 'CREATE'); assert.equal(pending.content, '');
    assert.deepEqual(socket.sent[1], pending);
    connection.dispose(); connection = h.start(); await flush(); socket = h.sockets[1]; socket.onopen();
    socket.message({ type: 'synced', initialized: true, version: 1 }); await flush();
    assert.deepEqual(socket.sent[1], pending);
    socket.message(event(2, pending)); await flush();
    assert.equal(h.stored().version, 2); assert.equal(h.stored().pending, undefined); assert.equal(h.applied.length, 0);
    socket.message(event(2, pending)); await flush(); assert.equal(h.stored().version, 2);
  } finally { connection.dispose(); }
});

test('dirty remote deletion stops before filesystem mutation or advancing cursor; retry resumes after save', async () => {
  const h = harness({ version: 1, entries: [entry('Main.java')], observed: [diskEntry('Main.java')] });
  h.setDisk([diskEntry('Main.java')]); h.setDirty(['Main.java']); const connection = h.start();
  try {
    await flush(); h.sockets[0].message(event(2, { operationId: 'delete', type: 'DELETE', path: 'Main.java' })); await flush();
    assert.equal(h.states.at(-1).phase, 'error'); assert.equal(h.applied.length, 0); assert.equal(h.stored().version, 1);
    h.setDirty([]); connection.retry(); await flush(); const socket = h.sockets[1]; socket.onopen();
    assert.equal(socket.sent[0].afterVersion, 1);
    socket.message(event(2, { operationId: 'delete', type: 'DELETE', path: 'Main.java' })); await flush();
    assert.equal(h.applied.length, 1); assert.equal(h.stored().version, 2);
  } finally { connection.dispose(); }
});

test('conflicts retain exact pending commands and never rebase destructive operations automatically', async () => {
  const pending = { operationId: 'delete', expectedVersion: 1, type: 'DELETE', path: 'Main.java' };
  const h = harness({ version: 1, entries: [entry('Main.java')], observed: [diskEntry('Main.java')], pending }); const connection = h.start();
  try {
    await flush(); const socket = h.sockets[0]; socket.message({ type: 'synced', initialized: true, version: 1 }); await flush();
    socket.message({ type: 'conflict', operationId: 'delete', version: 2, message: 'Stale version' }); await flush();
    assert.equal(h.states.at(-1).phase, 'error'); assert.deepEqual(h.stored().pending, pending); assert.equal(h.applied.length, 0);
  } finally { connection.dispose(); }
});

test('two desktop peers converge on terminal creation, Explorer rename, and folder deletion without echoes', async () => {
  const initial = { version: 1, entries: [entry('src', 'DIRECTORY')], observed: [diskEntry('src', 'dir', 'DIRECTORY')] };
  const a = harness(structuredClone(initial)); a.setDisk(structuredClone(initial.observed)); const alice = a.start(); await flush();
  const b = harness(structuredClone(initial)); b.setDisk(structuredClone(initial.observed)); const bob = b.start(); await flush();
  try {
    const sa = a.sockets[0], sb = b.sockets[0]; sa.onopen(); sb.onopen();
    sa.message({ type: 'synced', initialized: true, version: 1 }); sb.message({ type: 'synced', initialized: true, version: 1 }); await flush();
    a.setDisk([...initial.observed, diskEntry('src/Main.java', 'new-inode')]); await waitPoll();
    const created = sa.sent.at(-1); assert.equal(created.type, 'CREATE');
    for (const socket of [sa, sb]) socket.message(event(2, created)); await flush();
    assert.equal(b.stored().entries.find((e) => e.path === 'src/Main.java').id, created.entry.id);
    await bob.edit({ type: 'RENAME', operationId: 'local-rename', path: 'src/Main.java', targetPath: 'src/Other.java' }); await flush();
    const renamed = sb.sent.at(-1); assert.equal(renamed.type, 'RENAME');
    for (const socket of [sa, sb]) socket.message(event(3, renamed)); await flush();
    assert.equal(a.stored().entries.find((e) => e.path === 'src/Other.java').id, created.entry.id);
    await alice.edit({ type: 'DELETE', operationId: 'local-delete', path: 'src' }); await flush();
    const deleted = sa.sent.at(-1); assert.equal(deleted.type, 'DELETE');
    for (const socket of [sa, sb]) socket.message(event(4, deleted)); await flush(); await waitPoll();
    assert.deepEqual(a.stored().entries, []); assert.deepEqual(b.stored().entries, []);
    assert.equal(sa.sent.length, 3); assert.equal(sb.sent.length, 2);
  } finally { alice.dispose(); bob.dispose(); }
});

test('opening a renamed document does not duplicate its existing tab or replace unsaved text', () => {
  const original = { path: 'before', documentId: 'same-id', content: 'unsaved', dirty: true };
  const result = editorTabsReducer({ files: [original], activePath: 'before' }, { type: 'open', file: { path: 'after', documentId: 'same-id', content: 'disk' } });
  assert.deepEqual(result.files, [{ ...original, path: 'after' }]);
});
