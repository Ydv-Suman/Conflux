const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Y = require('yjs');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { connectDocument, documentIdForPath } = require('../src/features/editor/documentConnection.ts');
const settle = () => new Promise(setImmediate);
let sockets, history, participants, owner, messages, rejectToken, holdInitialization;
const originalSocket = global.WebSocket;
const connections = [];
const docs = [];

class Socket {
  static OPEN = 1;
  readyState = 0;
  bufferedAmount = 0;
  listeners = new Map();
  constructor(url) {
    this.url = url;
    sockets.push(this);
    queueMicrotask(() => { if (this.readyState === 0) { this.readyState = 1; this.emit('open', {}); } });
  }
  addEventListener(name, callback) {
    this.listeners.set(name, [...(this.listeners.get(name) || []), callback]);
  }
  emit(name, event) { for (const callback of this.listeners.get(name) || []) callback(event); }
  deliver(value) {
    queueMicrotask(() => { if (this.readyState === 1) this.emit('message', { data: typeof value === 'string' ? value : Uint8Array.from(value).buffer }); });
  }
  control(type) { this.deliver(JSON.stringify({ type })); }
  send(value) {
    assert.equal(this.readyState, 1);
    const data = typeof value === 'string' ? value : Uint8Array.from(value);
    messages.push({ socket: this, data });
    queueMicrotask(() => {
      if (this.readyState !== 1) return;
      if (typeof data === 'string') {
        assert.equal(this.authenticated, undefined, 'Only authentication uses a client text frame');
        const credentials = JSON.parse(data);
        assert.equal(credentials.teamId, 'team-one');
        if (rejectToken(credentials.token)) { this.drop(rejectToken(credentials.token)); return; }
        this.authenticated = true;
        participants.add(this);
        if (history.length) { history.forEach((update) => this.deliver(update)); this.control('synced'); }
        else if (!owner) { owner = this; this.control('initialize'); }
      } else {
        assert.ok(this.authenticated, 'Binary data must follow authentication');
        if (!history.length && holdInitialization) return;
        assert.ok(history.length || owner === this, 'Only the elected participant seeds the document');
        if (history.some((update) => Buffer.from(update).equals(Buffer.from(data)))) return;
        const first = history.length === 0;
        history.push(data);
        for (const peer of participants) {
          if (peer !== this) peer.deliver(data);
          if (first) peer.control('synced');
        }
        owner = undefined;
      }
    });
  }
  close() { this.drop(1000); }
  drop(code) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    participants.delete(this);
    if (owner === this) {
      owner = participants.values().next().value;
      owner?.control('initialize');
    }
    queueMicrotask(() => this.emit('close', { code }));
  }
}

beforeEach((t) => {
  sockets = []; history = []; participants = new Set(); messages = [];
  owner = undefined; rejectToken = () => 0; holdInitialization = false;
  global.WebSocket = Socket;
  t.mock.timers.enable({ apis: ['setTimeout'] });
});
afterEach(() => {
  connections.splice(0).forEach((connection) => connection.dispose());
  docs.splice(0).forEach((doc) => doc.destroy());
  global.WebSocket = originalSocket;
});
function open(initialContent = 'base', getToken = async () => 'valid') {
  const doc = new Y.Doc(); docs.push(doc);
  const states = [];
  const connection = connectDocument({ doc, endpoint: 'ws://collaboration/doc', teamId: 'team-one', initialContent,
    getToken, onState: (state) => states.push(state) });
  connections.push(connection);
  return { doc, text: doc.getText('content'), states, connection };
}

test('authenticates with a first text frame, keeps credentials out of URL, and waits for sync', async () => {
  holdInitialization = true;
  const a = open();
  await settle();
  assert.equal(a.states.at(-1).phase, 'syncing');
  assert.equal(a.states.at(-1).ready, false);
  assert.equal(sockets[0].url, 'ws://collaboration/doc');
  assert.deepEqual(JSON.parse(messages[0].data), { teamId: 'team-one', token: 'valid' });
  assert.ok(messages[1].data instanceof Uint8Array);
});

test('two simultaneous first opens seed the document exactly once, including empty files', async () => {
  const a = open(), b = open('different stale disk contents');
  await settle();
  assert.equal(a.text.toString(), 'base');
  assert.equal(b.text.toString(), 'base');
  assert.equal(a.states.at(-1).phase, 'connected');
  assert.equal(b.states.at(-1).phase, 'connected');
  assert.equal(history.length, 1, 'Echoed and identical snapshots are not new edits');
});

test('empty files initialize with a real Yjs update', async () => {
  const a = open(''), b = open(''); await settle();
  assert.equal(a.states.at(-1).ready, true);
  assert.equal(b.text.toString(), '');
  assert.ok(history[0].length > 0);
});

test('simultaneous insertions and deletions converge without losing either author’s work', async () => {
  const a = open(), b = open(); await settle();
  a.text.delete(0, 1);
  a.text.insert(0, 'Alice:');
  b.text.insert(0, 'Bob:');
  await settle();
  assert.equal(a.text.toString(), b.text.toString());
  assert.ok(a.text.toString().includes('Alice:'));
  assert.ok(a.text.toString().includes('Bob:'));
  assert.ok(a.text.toString().endsWith('ase'));
});

test('reconnect preserves offline edits, merges remote changes, and sends no token in a URL', async (t) => {
  const a = open(), b = open(); await settle();
  sockets[0].drop(1006); await settle();
  a.text.insert(0, 'offline:');
  b.text.insert(b.text.length, ':online'); await settle();
  assert.equal(a.states.at(-1).pending, true);
  assert.equal(a.states.at(-1).phase, 'reconnecting');
  t.mock.timers.tick(500); await settle();
  assert.equal(a.text.toString(), b.text.toString());
  assert.equal(a.text.toString(), 'offline:base:online');
  assert.equal(a.states.at(-1).phase, 'connected');
  assert.equal(a.states.at(-1).pending, false);
});

test('replayed empty documents stay empty instead of restoring stale disk text', async () => {
  const a = open(); await settle();
  a.text.delete(0, a.text.length); await settle();
  a.connection.dispose(); await settle();
  const b = open('stale disk text'); await settle();
  assert.equal(b.states.at(-1).ready, true);
  assert.equal(b.text.toString(), '');
});

test('disconnecting before initialization is persisted does not seed text twice', async (t) => {
  holdInitialization = true;
  const a = open(); await settle();
  assert.equal(a.text.toString(), 'base');
  sockets[0].drop(1006); await settle();
  holdInitialization = false;
  t.mock.timers.tick(500); await settle();
  assert.equal(a.text.toString(), 'base');
  assert.equal(a.states.at(-1).phase, 'connected');
});

test('refreshes rejected credentials once and reconnects with the replacement', async (t) => {
  rejectToken = (token) => token === 'expired' ? 4401 : 0;
  const requests = [];
  const a = open('base', async (rejected) => { requests.push(rejected); return rejected ? 'replacement' : 'expired'; });
  await settle(); t.mock.timers.tick(500); await settle();
  assert.deepEqual(requests, [undefined, 'expired']);
  assert.equal(a.states.at(-1).phase, 'connected');
});

test('a repeated authentication failure stops retries and does not seed the document', async (t) => {
  rejectToken = () => 4401;
  const a = open(); await settle(); t.mock.timers.tick(500); await settle();
  assert.equal(a.states.at(-1).phase, 'denied');
  assert.equal(a.text.toString(), '');
  t.mock.timers.tick(60000); await settle();
  assert.equal(sockets.length, 2);
});

test('revocation stops automatic reconnect, preserves text, and allows an explicit retry', async (t) => {
  const a = open(); await settle();
  a.text.insert(0, 'mine:'); await settle();
  sockets[0].drop(4403); await settle();
  assert.equal(a.states.at(-1).phase, 'denied');
  assert.equal(a.states.at(-1).pending, true);
  assert.equal(a.text.toString(), 'mine:base');
  t.mock.timers.tick(60000); await settle(); assert.equal(sockets.length, 1);
  a.connection.retry(); await settle(); assert.equal(a.states.at(-1).phase, 'connected');
});

test('disposing while credentials are loading prevents late sockets and removes listeners', async () => {
  let resolve;
  const a = open('base', () => new Promise((done) => { resolve = done; }));
  a.connection.dispose();
  resolve('valid'); await settle();
  const count = a.states.length;
  a.text.insert(0, 'after close');
  assert.equal(sockets.length, 0);
  assert.equal(a.states.length, count);
});

test('a failed first connection never seeds an offline copy or enables saving', async (t) => {
  holdInitialization = true;
  const a = open();
  await Promise.resolve();
  sockets[0].drop(1013); await settle();
  assert.equal(a.text.toString(), '');
  assert.equal(a.states.at(-1).ready, false);
  a.connection.dispose(); t.mock.timers.tick(60000); await settle(); assert.equal(sockets.length, 1);
});

test('backpressure reconnects with the retained document rather than dropping updates', async (t) => {
  const a = open(); await settle();
  sockets[0].bufferedAmount = 4 * 1024 * 1024;
  a.text.insert(0, 'pending:'); await settle();
  assert.equal(a.states.at(-1).pending, true);
  t.mock.timers.tick(500); await settle();
  const b = open(); await settle();
  assert.equal(b.text.toString(), 'pending:base');
});

test('oversized updates stop safely and leave text available to save locally', async () => {
  const a = open(); await settle();
  a.text.insert(0, 'x'.repeat(2 * 1024 * 1024)); await settle();
  assert.equal(a.states.at(-1).phase, 'error');
  assert.equal(a.states.at(-1).ready, true);
  assert.equal(a.states.at(-1).pending, true);
  assert.equal(a.text.length, 2 * 1024 * 1024 + 4);
  assert.ok(messages.filter(({ data }) => typeof data !== 'string').every(({ data }) => data.length <= 2 * 1024 * 1024));
});

test('invalid protocol data stops the connection instead of replaying local disk contents', async () => {
  const a = open(); await settle();
  sockets[0].deliver('{bad json'); await settle();
  assert.equal(a.states.at(-1).phase, 'error');
  assert.equal(a.text.toString(), 'base');
});

test('legacy replay markers explain that the backend must restart without enabling editing', async () => {
  holdInitialization = true;
  const a = open(); await settle();
  sockets[0].deliver(new Uint8Array()); await settle();
  assert.equal(a.states.at(-1).phase, 'error');
  assert.equal(a.states.at(-1).ready, false);
  assert.match(a.states.at(-1).message, /old protocol.*Restart the updated backend/);
  assert.equal(a.text.toString(), 'base', 'Existing editor contents remain available for retry');
});

test('path mapping remains deterministic, bounded, and distinguishes matching readable prefixes', () => {
  assert.equal(documentIdForPath('src/main.ts'), documentIdForPath('src/main.ts'));
  assert.notEqual(documentIdForPath('src/main.ts'), documentIdForPath('src-main.ts'));
  assert.match(documentIdForPath('ü/'.repeat(150)), /^[A-Za-z0-9._-]{1,128}$/);
});
