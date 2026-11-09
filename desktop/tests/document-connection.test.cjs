const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Y = require('yjs');
const realSetTimeout = require('node:timers').setTimeout;
const digest = crypto.subtle.digest.bind(crypto.subtle);
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { connectDocument, documentIdForPath } = require('../src/features/editor/documentConnection.ts');
let activity, pendingDigests, digestDelay;
const settle = async () => {
  const deadline = Date.now() + 5000;
  let quietTurns = 0;
  while (quietTurns < 2 || pendingDigests > 0) {
    assert.ok(Date.now() < deadline, 'Document fixture did not settle within 5 seconds');
    const previous = activity;
    await new Promise(setImmediate);
    quietTurns = activity === previous ? quietTurns + 1 : 0;
  }
};
let sockets, history, participants, owner, messages, rejectToken, holdInitialization, holdReceipts;
let attributedMode, bindings, operations, nextWriter;
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
  emit(name, event) { activity++; for (const callback of this.listeners.get(name) || []) callback(event); }
  deliver(value) {
    queueMicrotask(() => { if (this.readyState === 1) this.emit('message', { data: typeof value === 'string' ? value : Uint8Array.from(value).buffer }); });
  }
  control(type) { this.deliver(JSON.stringify({ type })); }
  send(value) {
    activity++;
    assert.equal(this.readyState, 1);
    const data = typeof value === 'string' ? value : Uint8Array.from(value);
    messages.push({ socket: this, data });
    queueMicrotask(() => {
      if (this.readyState !== 1) return;
      if (typeof data === 'string') {
        const credentials = JSON.parse(data);
        if (this.authenticated) {
          assert.ok(attributedMode, 'Only attributed edits use client text frames');
          const edit = credentials;
          const binding = [...bindings.values()].find((item) => item.writerId === edit.writerId);
          assert.equal(binding?.actor, this.actor, 'Writer must belong to this account');
          const bytes = Buffer.from(edit.update, 'base64');
          const previous = operations.get(edit.operationId);
          const acknowledge = (record) => {
            if (!holdReceipts) this.deliver(JSON.stringify({ type: 'ack', operationId: edit.operationId, writerId: edit.writerId,
              sha256: require('node:crypto').createHash('sha256').update(bytes).digest('hex'), sequence: record.sequence }));
          };
          if (previous) {
            assert.equal(previous.update, edit.update); assert.equal(previous.writerId, edit.writerId);
            acknowledge(previous); return;
          }
          if (!history.length && holdInitialization) return;
          assert.ok(history.length || (owner === this && edit.type === 'seed'));
          assert.ok(!history.length || edit.type === 'edit');
          const first = history.length === 0;
          history.push(bytes);
          const record = { ...edit, sequence: history.length };
          operations.set(edit.operationId, record);
          for (const peer of participants) {
            if (peer !== this) peer.deliver(bytes);
            if (first) peer.control('synced');
          }
          owner = undefined;
          acknowledge(record); return;
        }
        assert.equal(credentials.teamId, 'team-one');
        if (rejectToken(credentials.token)) { this.drop(rejectToken(credentials.token)); return; }
        this.authenticated = true;
        this.actor = credentials.token;
        if (attributedMode && credentials.protocol === 2) {
          let binding = bindings.get(credentials.registrationId);
          if (!binding) { binding = { writerId: ++nextWriter, actor: this.actor }; bindings.set(credentials.registrationId, binding); }
          this.deliver(JSON.stringify({ type: 'protocol', version: 2, initialOperationId: operations.keys().next().value }));
          this.deliver(JSON.stringify({ type: 'writer', requestId: credentials.registrationId, writerId: binding.writerId }));
        }
        participants.add(this);
        if (history.length) { history.forEach((update) => this.deliver(update)); this.control('synced'); }
        else if (!owner) { owner = this; this.control('initialize'); }
      } else {
        assert.ok(this.authenticated, 'Binary data must follow authentication');
        if (!history.length && holdInitialization) return;
        assert.ok(history.length || owner === this, 'Only the elected participant seeds the document');
        const acknowledge = () => { if (!holdReceipts) this.deliver(JSON.stringify({ type: 'ack', sha256: require('node:crypto').createHash('sha256').update(data).digest('hex'), sequence: history.findIndex((item) => Buffer.from(item).equals(Buffer.from(data))) + 1 })); };
        if (history.some((update) => Buffer.from(update).equals(Buffer.from(data)))) { acknowledge(); return; }
        const first = history.length === 0;
        history.push(data);
        for (const peer of participants) {
          if (peer !== this) peer.deliver(data);
          if (first) peer.control('synced');
        }
        owner = undefined;
        acknowledge();
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
  activity = 0; pendingDigests = 0; digestDelay = 0;
  // Keep real SHA-256, but track its worker completion independently of fake timers.
  t.mock.method(crypto.subtle, 'digest', async (...args) => {
    pendingDigests++; activity++;
    try {
      if (digestDelay) await new Promise((resolve) => realSetTimeout(resolve, digestDelay));
      return await digest(...args);
    } finally { pendingDigests--; activity++; }
  });
  sockets = []; history = []; participants = new Set(); messages = [];
  attributedMode = false; bindings = new Map(); operations = new Map(); nextWriter = 100;
  owner = undefined; rejectToken = () => 0; holdInitialization = false; holdReceipts = false;
  global.WebSocket = Socket;
  t.mock.timers.enable({ apis: ['setTimeout'] });
});
afterEach(async () => {
  connections.splice(0).forEach((connection) => connection.dispose());
  await settle();
  docs.splice(0).forEach((doc) => doc.destroy());
  global.WebSocket = originalSocket;
});
function memoryStorage() { let value = null; return { load: async () => structuredClone(value), save: async (next) => { value = structuredClone(next); } }; }
function open(initialContent = 'base', getToken = async () => 'valid', storage = memoryStorage()) {
  const doc = new Y.Doc(); docs.push(doc);
  const states = [];
  const connection = connectDocument({ doc, endpoint: 'ws://collaboration/doc', teamId: 'team-one', initialContent,
    getToken, storage, onState: (state) => { activity++; states.push(state); } });
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
  assert.equal(JSON.parse(messages[0].data).protocol, 2);
  assert.equal(JSON.parse(messages[0].data).teamId, 'team-one');
  assert.equal(JSON.parse(messages[0].data).token, 'valid');
  assert.equal(JSON.parse(messages[0].data).acknowledgements, true);
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
  holdReceipts = true;
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
  await settle();
  a.connection.dispose();
  resolve('valid'); await settle();
  const count = a.states.length;
  a.text.insert(0, 'after close');
  assert.equal(sockets.length, 0);
  assert.equal(a.states.length, count);
});

test('a failed first connection never seeds an offline copy or enables saving', async (t) => {
  rejectToken = () => 1013;
  const a = open();
  await settle();
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
  a.text.insert(0, 'x'.repeat(2 * 1024 * 1024));
  await settle();
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

test('offline edits survive a destroyed document and restart while another peer keeps editing', async () => {
  const storage = memoryStorage();
  const a = open('base', undefined, storage), b = open(); await settle();
  sockets[0].drop(1006); await settle();
  a.text.insert(0, 'offline:'); b.text.insert(b.text.length, ':online'); await settle();
  assert.ok((await storage.load()).pending.length);
  a.connection.dispose(); a.doc.destroy();
  const recovered = open('stale disk', undefined, storage); await settle();
  assert.equal(recovered.text.toString(), 'offline:base:online');
  assert.equal(recovered.text.toString(), b.text.toString());
  assert.equal(recovered.states.at(-1).pending, false);
  assert.deepEqual((await storage.load()).pending, []);
});

test('lost receipts survive restart and retry exact bytes without duplicate history', async () => {
  const storage = memoryStorage();
  const a = open('base', undefined, storage); await settle();
  holdReceipts = true;
  a.text.insert(0, 'pending:'); await settle();
  const pending = (await storage.load()).pending;
  assert.equal(pending.length, 1);
  assert.equal(a.states.at(-1).pending, true);
  const count = history.length;
  a.connection.dispose(); a.doc.destroy(); holdReceipts = false;
  const recovered = open('stale', undefined, storage); await settle();
  assert.equal(recovered.text.toString(), 'pending:base');
  assert.equal(history.length, count);
  assert.equal(recovered.states.at(-1).pending, false);
  assert.ok(messages.some(({ data }) => typeof data !== 'string' && Buffer.from(data).toString('base64') === pending[0]));
});

test('close recovery persists the exact accepted revision alongside its document snapshot', async () => {
  const storage = memoryStorage();
  const a = open('base', undefined, storage); await settle();
  const remote = new Y.Doc({ gc: false });
  remote.getText('content').insert(0, 'remote:');
  sockets[0].deliver(JSON.stringify({ type: 'revision', sequence: 17 }));
  sockets[0].deliver(Y.encodeStateAsUpdate(remote));
  await settle();
  const saved = await a.connection.persist();
  assert.equal(saved.sequence, 17);
  const restored = new Y.Doc({ gc: false });
  Y.applyUpdate(restored, Buffer.from(saved.snapshot, 'base64'));
  assert.equal(restored.getText('content').toString(), a.text.toString());
  assert.ok(restored.getText('content').toString().includes('remote:'));
  restored.destroy(); remote.destroy();
});

test('no update leaves the device before its local persistence completes', async () => {
  const base = memoryStorage(); let release;
  const storage = { load: base.load, save: async (value) => {
    if (release === null) await new Promise((resolve) => { release = resolve; });
    await base.save(value);
  } };
  const a = open('base', undefined, storage); await settle();
  const count = history.length; release = null;
  a.text.insert(0, 'durable:'); await settle();
  assert.equal(a.states.at(-1).persisting, true);
  assert.equal(history.length, count);
  release(); await settle();
  assert.equal(history.length, count + 1);
  assert.equal(a.states.at(-1).pending, false);
});

test('storage failures stop synchronization and retry preserves the unsent edit', async () => {
  const base = memoryStorage(); let fail = false;
  const storage = { load: base.load, save: async (value) => { if (fail) throw Error('disk full'); await base.save(value); } };
  const a = open('base', undefined, storage); await settle();
  const count = history.length; fail = true;
  a.text.insert(0, 'keep:'); await settle();
  assert.equal(a.states.at(-1).phase, 'error');
  assert.equal(a.states.at(-1).pending, true);
  assert.equal(history.length, count);
  fail = false; a.connection.retry(); await settle();
  assert.equal(a.text.toString(), 'keep:base');
  assert.equal(a.states.at(-1).pending, false);
  assert.equal(history.length, count + 1);
});

test('failed or corrupt recovery loads never open a socket or overwrite stored state', async () => {
  let saves = 0;
  const storage = { load: async () => ({ version: 1, snapshot: 'corrupt', pending: [], ready: true }), save: async () => { saves++; } };
  const a = open('disk', undefined, storage); await settle();
  assert.equal(a.states.at(-1).phase, 'error');
  assert.equal(a.states.at(-1).ready, false);
  assert.equal(sockets.length, 0); assert.equal(saves, 0);
});

test('reopening a tab waits for the old instance to finish persisting edits', async () => {
  const base = memoryStorage(); let release;
  const storage = { load: base.load, save: async (value) => {
    if (release === null) await new Promise((resolve) => { release = resolve; });
    await base.save(value);
  } };
  const a = open('base', undefined, storage); await settle();
  sockets[0].drop(1006); await settle(); release = null;
  a.text.insert(0, 'queued:'); await settle();
  a.connection.dispose(); a.doc.destroy();
  const b = open('stale', undefined, storage); await settle();
  assert.equal(b.states.at(-1).ready, false);
  release(); await settle();
  assert.equal(b.text.toString(), 'queued:base');
  assert.equal(b.states.at(-1).pending, false);
});

test('unknown receipts cannot clear pending updates and missing receipts trigger a safe retry', async (t) => {
  const a = open(); await settle(); holdReceipts = true;
  a.text.insert(0, 'unacknowledged:'); await settle();
  const count = history.length;
  sockets[0].deliver(JSON.stringify({ type: 'ack', sha256: '0'.repeat(64), sequence: 100 })); await settle();
  assert.equal(a.states.at(-1).pending, true);
  t.mock.timers.tick(15000); await settle();
  assert.equal(a.states.at(-1).phase, 'reconnecting');
  holdReceipts = false; t.mock.timers.tick(500); await settle();
  assert.equal(history.length, count);
  assert.equal(a.states.at(-1).pending, false);
});

test('settling waits for delayed real hashing before checking convergence and receipts', async () => {
  digestDelay = 25;
  const a = open(), b = open();
  await settle();
  assert.equal(a.states.at(-1).phase, 'connected');
  assert.equal(b.text.toString(), 'base');
  a.text.insert(0, 'Alice:'); b.text.insert(b.text.length, ':Bob');
  await settle();
  assert.equal(a.text.toString(), 'Alice:base:Bob');
  assert.equal(a.text.toString(), b.text.toString());
  assert.equal(a.states.at(-1).pending, false);
  assert.equal(b.states.at(-1).pending, false);
});


test('attributed editing persists writer envelopes and seeds existing text without claiming it as an edit', async () => {
  attributedMode = true;
  const storage = memoryStorage();
  const a = open('existing code', async () => 'alice', storage), b = open('stale', async () => 'bob');
  await settle();
  assert.equal(a.states.at(-1).writable, true);
  assert.equal(a.doc.gc, false);
  assert.equal((await storage.load()).version, 2);
  assert.equal([...operations.values()][0].type, 'seed');
  a.text.insert(0, 'Alice:'); b.text.insert(b.text.length, ':Bob');
  await settle();
  assert.equal(a.text.toString(), b.text.toString());
  assert.equal(a.text.toString(), 'Alice:existing code:Bob');
  assert.equal(a.states.at(-1).pending, false);
  assert.equal(b.states.at(-1).pending, false);
  assert.ok([...operations.values()].slice(1).every((operation) => operation.type === 'edit'));
});

test('attributed pending edits retain original operation and writer identities across restart', async () => {
  attributedMode = true;
  const storage = memoryStorage();
  const a = open('base', async () => 'alice', storage), b = open('base', async () => 'bob');
  await settle();
  sockets[0].drop(1006); await settle();
  a.text.insert(0, 'offline:'); b.text.insert(b.text.length, ':online'); await settle();
  const pending = (await storage.load()).pending[0];
  assert.equal(pending.kind, 'edit');
  a.connection.dispose(); a.doc.destroy();
  const recovered = open('stale', async () => 'alice', storage); await settle();
  assert.notEqual(recovered.doc.clientID, pending.writerId, 'A new window uses a new writer for future edits');
  assert.equal(operations.get(pending.operationId).writerId, pending.writerId);
  assert.equal(operations.get(pending.operationId).update, pending.update);
  assert.equal(recovered.text.toString(), 'offline:base:online');
  recovered.text.insert(0, 'new:'); await settle();
  assert.equal(recovered.text.toString(), b.text.toString());
  assert.equal(recovered.states.at(-1).pending, false);
});

test('attributed lost receipts retry exactly once logically after restart', async () => {
  attributedMode = true;
  const storage = memoryStorage();
  const a = open('base', async () => 'alice', storage); await settle();
  holdReceipts = true;
  a.text.insert(0, 'saved:'); await settle();
  const pending = (await storage.load()).pending[0], count = operations.size;
  a.connection.dispose(); a.doc.destroy(); holdReceipts = false;
  const recovered = open('stale', async () => 'alice', storage); await settle();
  assert.equal(operations.size, count);
  assert.equal(operations.get(pending.operationId).update, pending.update);
  assert.equal(recovered.states.at(-1).pending, false);
});

test('attributed receipts must match operation, writer, and exact bytes', async () => {
  attributedMode = true;
  const storage = memoryStorage();
  const a = open('base', undefined, storage); await settle(); holdReceipts = true;
  a.text.insert(0, 'pending:'); await settle();
  const edit = (await storage.load()).pending[0];
  for (const override of [{ writerId: edit.writerId + 1 }, { sha256: '0'.repeat(64) }, { operationId: crypto.randomUUID() }]) {
    sockets[0].deliver(JSON.stringify({ type: 'ack', operationId: edit.operationId, writerId: edit.writerId, sha256: edit.sha256, sequence: 2, ...override }));
    await settle();
    assert.equal((await storage.load()).pending.length, 1);
  }
});

test('an attributed recovery cannot silently downgrade to an old server', async () => {
  attributedMode = true;
  const storage = memoryStorage();
  const a = open('base', undefined, storage); await settle();
  a.connection.dispose(); a.doc.destroy(); attributedMode = false;
  const recovered = open('stale', undefined, storage); await settle();
  assert.equal(recovered.states.at(-1).phase, 'error');
  assert.equal(recovered.states.at(-1).writable, false);
  assert.equal((await storage.load()).version, 2);
});

test('attributed edits do not leave the device before envelope persistence', async () => {
  attributedMode = true;
  const base = memoryStorage(); let release;
  const storage = { load: base.load, save: async (value) => {
    if (release === null) await new Promise((resolve) => { release = resolve; });
    await base.save(value);
  } };
  const a = open('base', undefined, storage); await settle();
  const count = operations.size; release = null;
  a.text.insert(0, 'durable:'); await settle();
  assert.equal(operations.size, count);
  release(); await settle();
  assert.equal(operations.size, count + 1);
  assert.equal(a.states.at(-1).pending, false);
});

test('a lost initial baseline receipt survives restart without seeding twice', async () => {
  attributedMode = true; holdReceipts = true;
  const storage = memoryStorage();
  const a = open('base', undefined, storage); await settle();
  assert.equal((await storage.load()).pending[0].kind, 'seed');
  a.connection.dispose(); a.doc.destroy(); holdReceipts = false;
  const recovered = open('stale', undefined, storage); await settle();
  assert.equal(recovered.text.toString(), 'base');
  assert.equal(operations.size, 1);
  assert.equal(recovered.states.at(-1).pending, false);
});

test('a replaced uncommitted baseline stops safely rather than duplicating initial contents', async () => {
  attributedMode = true; holdInitialization = true;
  const storage = memoryStorage();
  const a = open('first baseline', async () => 'alice', storage), b = open('second baseline', async () => 'bob');
  await settle();
  holdInitialization = false;
  sockets[0].drop(1006); await settle();
  a.connection.dispose(); a.doc.destroy();
  assert.equal(b.text.toString(), 'second baseline');
  const recovered = open('stale', async () => 'alice', storage); await settle();
  assert.equal(recovered.states.at(-1).phase, 'error');
  assert.match(recovered.states.at(-1).message, /different baselines/);
  assert.equal(recovered.text.toString(), 'first baseline');
  assert.equal(operations.size, 1);
});

test('clean legacy recovery negotiates attribution without duplicating saved content', async () => {
  const old = new Y.Doc(); docs.push(old); old.clientID = 40;
  old.getText('content').insert(0, 'legacy'); old.getText('content').delete(0, 1);
  const baseline = Y.encodeStateAsUpdate(old);
  history.push(baseline); attributedMode = true;
  const saved = memoryStorage();
  await saved.save({ version: 1, snapshot: Buffer.from(baseline).toString('base64'), pending: [], ready: true });
  const client = open('egacy', async () => 'valid', saved); await settle();
  const handshake = JSON.parse(messages.find(item => typeof item.data === 'string').data);
  assert.equal(handshake.protocol, 2); assert.equal(handshake.migrateLegacy, true);
  assert.equal(client.text.toString(), 'egacy'); assert.equal((await saved.load()).version, 2);
  assert.notEqual(client.doc.clientID, 40);
  client.text.insert(5, '!'); await settle();
  assert.equal(client.text.toString(), 'egacy!'); assert.equal(client.states.at(-1).pending, false);
  assert.equal([...operations.values()][0].type, 'edit');
});

test('unsent legacy recovery is preserved and never relabeled after migration', async () => {
  const old = new Y.Doc(); docs.push(old); old.getText('content').insert(0, 'offline work');
  const encoded = Buffer.from(Y.encodeStateAsUpdate(old)).toString('base64');
  const saved = memoryStorage();
  await saved.save({ version: 1, snapshot: encoded, pending: [encoded], ready: true });
  rejectToken = () => 4410;
  const client = open('base', async () => 'valid', saved); await settle();
  assert.equal(JSON.parse(messages[0].data).protocol, undefined);
  assert.equal(client.states.at(-1).phase, 'error');
  assert.match(client.states.at(-1).message, /unsent legacy/);
  assert.equal(client.text.toString(), 'offline work');
  assert.deepEqual((await saved.load()).pending, [encoded]); assert.equal((await saved.load()).version, 1);
});
