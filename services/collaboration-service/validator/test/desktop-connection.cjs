// Runs the real desktop connection against the Java test server (dummy test accounts only).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const desktop = createRequire(path.resolve('../../desktop/package.json'));
const ts = desktop('typescript'), Y = desktop('yjs');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { connectDocument } = desktop('./src/features/editor/documentConnection.ts');
const NativeSocket = global.WebSocket, sockets = [];
global.WebSocket = class extends NativeSocket {
  constructor(url) { super(url); sockets.push(this); }
};
const all = [];
function storage() {
  let value = null;
  return { load: async () => structuredClone(value), save: async (next) => { value = structuredClone(next); } };
}
function open(actor, saved = storage()) {
  const doc = new Y.Doc({ gc: false });
  const client = { doc, saved, state: null };
  client.connection = connectDocument({ doc, endpoint: process.argv[2], teamId: process.argv[3], initialContent: 'base',
    storage: saved, getToken: async () => actor, onState: (state) => { client.state = state; } });
  all.push(client);
  return client;
}
async function until(predicate) {
  const end = Date.now() + 15000;
  while (!await predicate()) {
    assert.ok(Date.now() < end, `Timed out: ${JSON.stringify(all.map((c) => c.state))}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
(async () => {
  try {
    const a = open('alice'), b = open('bob');
    await until(() => [a, b].every((c) => c.state?.phase === 'connected' && !c.state.pending));
    assert.equal(a.doc.getText('content').toString(), 'base');
    assert.equal(b.doc.getText('content').toString(), 'base');
    assert.equal((await a.saved.load()).version, 2);
    a.doc.getText('content').insert(0, 'Alice:');
    b.doc.getText('content').insert(0, 'Bob:');
    await until(() => !a.state.pending && !b.state.pending
      && a.doc.getText('content').toString() === b.doc.getText('content').toString());
    sockets[0].close();
    await until(() => a.state.phase === 'reconnecting');
    a.doc.getText('content').insert(0, 'offline:');
    await until(() => a.state.pending && !a.state.persisting);
    const pending = (await a.saved.load()).pending[0];
    assert.equal(pending.kind, 'edit');
    a.connection.dispose(); a.doc.destroy();
    b.doc.getText('content').insert(b.doc.getText('content').length, ':online');
    await until(() => !b.state.pending);
    const recovered = open('alice', a.saved);
    await until(() => recovered.state?.phase === 'connected' && !recovered.state.pending
      && recovered.doc.getText('content').toString() === b.doc.getText('content').toString());
    assert.notEqual(recovered.doc.clientID, pending.writerId);
    assert.ok(recovered.doc.getText('content').toString().includes('offline:'));
    recovered.doc.getText('content').delete(0, 1);
    await until(() => !recovered.state.pending && recovered.doc.getText('content').toString() === b.doc.getText('content').toString());
    console.log(JSON.stringify({ ok: true, pendingOperation: pending.operationId }));
  } finally {
    for (const client of all) { client.connection.dispose(); client.doc.destroy(); }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
