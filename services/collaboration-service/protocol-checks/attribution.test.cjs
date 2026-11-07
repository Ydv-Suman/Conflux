const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const Y = require('../../../desktop/node_modules/yjs');

// Executable protocol assumptions, not tests of an implemented attribution ledger.
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function edit(doc, change) {
  let bytes;
  const capture = (update) => { bytes = update; };
  doc.on('update', capture);
  try { change(doc.getText('content')); } finally { doc.off('update', capture); }
  assert.ok(bytes);
  return bytes;
}

test('a reconnect snapshot includes another writer without transferring its struct identity', () => {
  const alice = new Y.Doc(), bob = new Y.Doc(), restored = new Y.Doc();
  try {
    const aliceId = alice.clientID;
    const a = edit(alice, (text) => text.insert(0, 'Alice'));
    Y.applyUpdate(bob, a);
    const bobId = bob.clientID;
    const b = edit(bob, (text) => text.insert(text.length, ' Bob'));
    const snapshot = Y.encodeStateAsUpdate(bob);
    assert.notEqual(hash(snapshot), hash(a));
    assert.notEqual(hash(snapshot), hash(b));
    assert.deepEqual(new Set(Y.decodeUpdate(snapshot).structs.map((s) => s.id.client)), new Set([aliceId, bobId]));
    Y.applyUpdate(restored, snapshot);
    const version = Y.encodeStateVector(restored);
    Y.applyUpdate(restored, a);
    Y.applyUpdate(restored, b);
    assert.deepEqual(Y.encodeStateVector(restored), version);
    assert.equal(restored.getText('content').toString(), 'Alice Bob');
  } finally { alice.destroy(); bob.destroy(); restored.destroy(); }
});

test('a deletion carries the target writer identity, not the deleting account', () => {
  const alice = new Y.Doc(), bob = new Y.Doc();
  try {
    const a = edit(alice, (text) => text.insert(0, 'abc'));
    Y.applyUpdate(bob, a);
    const before = Y.encodeStateVector(bob);
    const deletion = edit(bob, (text) => text.delete(1, 1));
    const decoded = Y.decodeUpdate(deletion);
    assert.equal(decoded.structs.length, 0);
    assert.deepEqual([...decoded.ds.clients.keys()], [alice.clientID]);
    assert.deepEqual(Y.encodeStateVector(bob), before);
    Y.applyUpdate(alice, deletion);
    Y.applyUpdate(alice, deletion);
    assert.equal(alice.getText('content').toString(), 'ac');
  } finally { alice.destroy(); bob.destroy(); }
});

test('transaction origin is local metadata and is not transmitted as author evidence', () => {
  const alice = new Y.Doc(), bob = new Y.Doc();
  try {
    let bytes;
    alice.on('update', (update) => { bytes = update; });
    alice.transact(() => alice.getText('content').insert(0, 'x'), { author: 'alice' });
    const receivedOrigins = [];
    bob.on('update', (_update, origin) => receivedOrigins.push(origin));
    const transportOrigin = {};
    Y.applyUpdate(bob, bytes, transportOrigin);
    assert.deepEqual(receivedOrigins, [transportOrigin]);
    assert.equal(bob.getMap('users').size, 0);
  } finally { alice.destroy(); bob.destroy(); }
});

test('a client ID can be selected by a client and therefore requires server-side binding', () => {
  const forged = new Y.Doc(), receiver = new Y.Doc();
  try {
    forged.clientID = 12345;
    const bytes = edit(forged, (text) => text.insert(0, 'unverified'));
    Y.applyUpdate(receiver, bytes);
    assert.equal(Y.decodeUpdate(bytes).structs[0].id.client, 12345);
    assert.equal(receiver.getText('content').toString(), 'unverified');
  } finally { forged.destroy(); receiver.destroy(); }
});
