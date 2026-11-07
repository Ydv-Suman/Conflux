// Real legacy client -> reopened attributed desktop -> late offline legacy client.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const desktop = require('node:module').createRequire(path.resolve('../../desktop/package.json'));
const ts = desktop('typescript'), Y = desktop('yjs');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { connectDocument } = desktop('./src/features/editor/documentConnection.ts');
const endpoint = process.argv[2], teamId = process.argv[3];
async function until(predicate) {
  const deadline = Date.now() + 10000;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'Timed out'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
(async () => {
  const legacy = new Y.Doc(); legacy.clientID = 77; legacy.getText('content').insert(0, 'legacy');
  let saved = { version: 1, ready: true, pending: [], snapshot: Buffer.from(Y.encodeStateAsUpdate(legacy)).toString('base64') };
  const old = new WebSocket(endpoint);
  let synced = false, acknowledged = false, closed = false;
  old.addEventListener('open', () => old.send(JSON.stringify({ teamId, token: 'alice', acknowledgements: true })));
  old.addEventListener('message', event => {
    if (typeof event.data !== 'string') return;
    const message = JSON.parse(event.data);
    if (message.type === 'initialize') old.send(Y.encodeStateAsUpdate(legacy));
    if (message.type === 'synced') synced = true;
    if (message.type === 'ack') acknowledged = true;
  });
  old.addEventListener('close', () => { closed = true; });
  await until(() => synced && acknowledged); old.close(); await until(() => closed);
  const doc = new Y.Doc({ gc: false }); let state;
  const storage = { load: async () => structuredClone(saved), save: async value => { saved = structuredClone(value); } };
  const current = connectDocument({ doc, endpoint, teamId, initialContent: 'legacy', storage,
    getToken: async () => 'alice', onState: value => { state = value; } });
  let late;
  try {
    await until(() => state?.phase === 'connected' && !state.pending);
    assert.equal(saved.version, 2); assert.equal(doc.getText('content').toString(), 'legacy');
    doc.getText('content').insert(6, '!'); await until(() => !state.pending);
    assert.equal(doc.getText('content').toString(), 'legacy!');
    let offlineSaved = { version: 1, ready: true, pending: [Buffer.from(Y.encodeStateAsUpdate(legacy)).toString('base64')], snapshot: Buffer.from(Y.encodeStateAsUpdate(legacy)).toString('base64') };
    const recovered = new Y.Doc(); let recoveryState;
    late = connectDocument({ doc: recovered, endpoint, teamId, initialContent: 'legacy',
      storage: { load: async () => structuredClone(offlineSaved), save: async value => { offlineSaved = structuredClone(value); } },
      getToken: async () => 'bob', onState: value => { recoveryState = value; } });
    await until(() => recoveryState?.phase === 'error');
    assert.match(recoveryState.message, /unsent legacy/); assert.equal(offlineSaved.pending.length, 1);
    recovered.destroy();
    console.log(JSON.stringify({ ok: true }));
  } finally { current.dispose(); late?.dispose(); legacy.destroy(); doc.destroy(); old.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
