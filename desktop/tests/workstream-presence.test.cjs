const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Y = require('yjs');
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
const { connectWorkstreamPresence, noCursor } = load('teams/workstreamPresence.ts');
const { collaborator } = load('teams/collaborators.ts');
const { CollaboratorBadges } = load('teams/CollaboratorBadges.tsx');
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
const scope = { projectId: ids[0], teamId: ids[1], workstreamId: ids[2] };
const peer = { sessionId: ids[3], userId: ids[2], documentId: 'file', anchor: null, head: null };
const settle = () => new Promise(setImmediate);
let sockets, connections;
const originalSocket = global.WebSocket;
class Socket {
  listeners = new Map(); sent = []; closed = false;
  constructor(url) { this.url = url; sockets.push(this); }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  emit(name, data) { this.listeners.get(name)?.(data); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.closed = true; this.emit('close', { code: 1000 }); }
  snapshot(changes = {}) { this.emit('message', { data: JSON.stringify({ type: 'workstream-presence', ...scope, selfId: ids[0], participants: [peer], ...changes }) }); }
}
beforeEach(t => {
  sockets = []; connections = []; global.WebSocket = Socket;
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
});
afterEach(() => { connections.forEach(client => client.dispose()); global.WebSocket = originalSocket; });
async function connect(overrides = {}) {
  const states = [], tokens = [];
  const client = connectWorkstreamPresence({ endpoint: 'ws://local/presence', scope,
    getToken: async rejected => { tokens.push(rejected); return rejected ? 'fresh' : 'secret'; }, onState: value => states.push(value), ...overrides });
  connections.push(client); await settle();
  return { client, states, tokens, socket: sockets.at(-1), latest: () => states.at(-1) };
}
test('authenticates in first frame and coalesces continuous cursor motion without starving updates', async t => {
  const h = await connect(); h.socket.emit('open');
  assert.equal(h.socket.url, 'ws://local/presence'); assert.deepEqual(h.socket.sent[0], { teamId: scope.teamId, token: 'secret' });
  h.socket.snapshot(); assert.equal(h.latest().phase, 'online');
  for (let index = 0; index < 10; index++) {
    h.client.update({ documentId: 'file', anchor: 'AA==', head: 'AQ==' }); t.mock.timers.tick(10);
  }
  assert.deepEqual(h.socket.sent.at(-1), { type: 'presence', documentId: 'file', anchor: 'AA==', head: 'AQ==' });
  assert.equal(h.socket.sent.length, 3, 'unchanged positions are not retransmitted');
  h.client.update({ documentId: 'next-file', anchor: null, head: null }); t.mock.timers.tick(50);
  assert.equal(h.socket.sent.at(-1).documentId, 'next-file');
  h.client.update(noCursor); t.mock.timers.tick(50); assert.equal(h.socket.sent.at(-1).documentId, null);
  t.mock.timers.tick(10000); assert.equal(h.socket.sent.at(-1).type, 'presence');
});
test('disconnect clears peers, reconnect republishes active file, and revocation stops retries', async t => {
  const h = await connect(); h.socket.snapshot();
  h.client.update({ documentId: 'file', anchor: null, head: null }); t.mock.timers.tick(50);
  h.socket.close(); assert.equal(h.latest().phase, 'offline'); assert.deepEqual(h.latest().participants, []);
  t.mock.timers.tick(500); await settle(); const next = sockets.at(-1); next.snapshot();
  assert.equal(next.sent.at(-1).documentId, 'file');
  next.emit('close', { code: 4403 }); t.mock.timers.tick(30000); await settle(); assert.equal(sockets.length, 2);
});
test('refreshes one rejected token and rejects cross-scope or malformed snapshots', async t => {
  const h = await connect(); h.socket.emit('close', { code: 4401 }); t.mock.timers.tick(500); await settle();
  assert.deepEqual(h.tokens, [undefined, 'secret']);
  const next = sockets.at(-1); next.emit('close', { code: 4401 }); t.mock.timers.tick(30000); await settle(); assert.equal(sockets.length, 2);
  for (const changes of [{ teamId: ids[3] }, { participants: [peer, peer] }, { participants: [{ ...peer, anchor: 'bad' }] }]) {
    const bad = await connect(); bad.socket.snapshot(changes);
    assert.equal(bad.latest().phase, 'offline'); assert.deepEqual(bad.latest().participants, []); assert.equal(bad.socket.closed, true);
  }
});
test('disposal during token lookup does not create a late socket', async () => {
  let resolve; const h = await connect({ getToken: () => new Promise(done => { resolve = done; }) });
  h.client.dispose(); resolve('token'); await settle(); assert.equal(sockets.length, 0);
});
test('file badges use first initials, deduplicate windows, and escape names', () => {
  const person = collaborator(peer, '<Alice>');
  const html = renderToStaticMarkup(React.createElement(CollaboratorBadges, { documentId: 'file', participants: [person, { ...person, sessionId: ids[0] }] }));
  assert.equal((html.match(/class="collaborator-initial"/g) || []).length, 1);
  assert.ok(html.includes('&lt;Alice&gt;')); assert.ok(!html.includes('<Alice>'));
  const crowded = renderToStaticMarkup(React.createElement(CollaboratorBadges, { documentId: 'file',
    participants: ids.map((userId, index) => collaborator({ ...peer, userId }, `User ${index}`)) }));
  assert.equal((crowded.match(/class="collaborator-initial"/g) || []).length, 3);
  assert.ok(crowded.includes('+1'));
  assert.equal(collaborator(peer, ' Alice Brown ').initial, 'A');
  assert.equal(collaborator(peer, 'Alice').color, collaborator(peer, 'Renamed').color);
  assert.equal(renderToStaticMarkup(React.createElement(CollaboratorBadges, { documentId: 'other', participants: [person] })), '');
});
test('relative cursors track concurrent edits without changing the document and dispose cleanly', () => {
  const previousDocument = global.document;
  global.document = { createElement: () => ({ style: {}, children: [], setAttribute() {}, appendChild(child) { this.children.push(child); } }) };
  const doc = new Y.Doc(), text = doc.getText('content'); text.insert(0, 'hello');
  const widgets = new Map(); let selectionChanged, decorations = [], published;
  const model = { getPositionAt: index => ({ lineNumber: 1, column: index + 1 }), getOffsetAt: position => position.column - 1 };
  const editor = {
    createDecorationsCollection: () => ({ set: values => { decorations = values; }, clear: () => { decorations = []; } }),
    addContentWidget: widget => widgets.set(widget.getId(), widget), removeContentWidget: widget => widgets.delete(widget.getId()), getOption: () => 20,
    getSelection: () => ({ getSelectionStart: () => ({ lineNumber: 1, column: 2 }), getPosition: () => ({ lineNumber: 1, column: 4 }) }),
    onDidChangeCursorSelection: listener => { selectionChanged = listener; return { dispose: () => { selectionChanged = null; } }; },
  };
  const storage = { encodeUpdate: bytes => Buffer.from(bytes).toString('base64'), decodeUpdate: value => new Uint8Array(Buffer.from(value, 'base64')) };
  const { createLiveCursors } = load('editor/liveCursors.ts', { './documentStorage': storage,
    'monaco-editor/esm/vs/editor/editor.api.js': { editor: { EditorOption: { lineHeight: 1 }, ContentWidgetPositionPreference: { EXACT: 0 } }, Range: class { constructor(...values) { this.values = values; } } } });
  const live = createLiveCursors(doc, text, model, editor, (anchor, head) => { published = { anchor, head }; });
  try {
    const before = Y.encodeStateAsUpdate(doc); selectionChanged();
    assert.deepEqual(Y.encodeStateAsUpdate(doc), before, 'publishing cursor state never writes a Yjs update');
    live.setPeers([collaborator({ ...peer, ...published }, 'Alice')]);
    assert.equal(widgets.size, 1); assert.equal(decorations.length, 1);
    let widget = [...widgets.values()][0]; assert.equal(widget.getPosition().position.column, 4);
    assert.equal(widget.getDomNode().children[0].textContent, 'A');
    text.insert(0, 'XX'); widget = [...widgets.values()][0]; assert.equal(widget.getPosition().position.column, 6);
    live.setPeers([{ ...collaborator(peer, 'Bob'), anchor: 'bad', head: 'bad' }]); assert.equal(widgets.size, 0);
    live.dispose(); assert.equal(widgets.size, 0); assert.equal(selectionChanged, null);
  } finally { doc.destroy(); global.document = previousDocument; }
});

test('presence hook advertises only the active visible file and clears scope and session state', async () => {
  const previousDocument = global.document, previousWindow = global.window;
  const events = new Map();
  global.document = { hidden: false, addEventListener: (name, callback) => events.set(name, callback), removeEventListener: name => events.delete(name) };
  global.window = { addEventListener() {}, removeEventListener() {} };
  const slots = [], effects = [], controllers = []; let index = 0;
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useRef(initial) { const slot = index++; return slots[slot] ||= { current: initial }; },
    useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = initial; return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }]; },
    useMemo(factory, deps) { const slot = index++; if (!equal(slots[slot]?.deps, deps)) slots[slot] = { deps, value: factory() }; return slots[slot].value; },
    useEffect(effect, deps) { const slot = index++; if (!equal(slots[slot]?.deps, deps)) effects.push(() => { slots[slot]?.cleanup?.(); slots[slot] = { deps, cleanup: effect() }; }); },
  };
  const { useWorkstreamPresence } = load('teams/useWorkstreamPresence.ts', {
    react, '../../config': { COLLABORATION_WS_URL: 'ws://local' },
    '../auth/session': { getCollaborationToken: async () => 'secret', getCurrentUser: () => ({ id: ids[0], username: 'Owner' }) },
    './api': { listTeamMembers: async () => [{ userId: peer.userId, fullName: 'Alice Brown', username: 'alice' }] },
    './collaborators': { collaborator }, './workstreamPresence': { noCursor, connectWorkstreamPresence: options => {
      const controller = { options, sent: [], disposed: false, update(value) { this.sent.push(value); }, dispose() { this.disposed = true; }, retry() {} };
      controllers.push(controller); return controller;
    } },
  });
  const render = currentScope => { index = 0; const result = useWorkstreamPresence(currentScope); while (effects.length) effects.shift()(); return result; };
  try {
    let hook = render(scope); await settle(); hook = render(scope);
    const connection = controllers[0]; hook.api.setDocument('file');
    assert.equal(connection.sent.at(-1).documentId, 'file');
    connection.options.onState({ ...scope, phase: 'online', selfId: ids[0], participants: [peer, { ...peer, sessionId: ids[0], userId: ids[0] }] });
    hook = render(scope); assert.equal(hook.participants[0].initial, 'A');
    assert.equal(hook.api.peers('file').length, 1, 'own session never renders as a remote cursor');
    assert.equal(hook.api.peers('other').length, 0);
    hook.api.cursor('file', 'AA==', 'AQ==');
    global.document.hidden = true; events.get('visibilitychange')(); assert.deepEqual(connection.sent.at(-1), noCursor);
    global.document.hidden = false; events.get('visibilitychange')(); assert.equal(connection.sent.at(-1).head, 'AQ==');
    hook.api.setDocument('next'); hook.api.clear('file'); assert.equal(connection.sent.at(-1).documentId, 'next', 'cleanup for a previously active file cannot clear the next file');
    hook.api.clear('next'); assert.deepEqual(connection.sent.at(-1), noCursor);
    connection.options.onState({ ...scope, phase: 'offline', participants: [] });
    hook = render(scope); assert.deepEqual(hook.participants, []); assert.deepEqual(hook.api.peers('file'), []);
    hook = render({ ...scope, workstreamId: ids[3] }); assert.equal(connection.disposed, true); assert.deepEqual(hook.api.peers('file'), []);
    render(null); assert.equal(controllers[1].disposed, true); assert.equal(events.size, 0);
  } finally { for (const slot of slots) slot?.cleanup?.(); global.document = previousDocument; global.window = previousWindow; }
});
