const test = require('node:test');
const assert = require('node:assert/strict');
const Y = require('yjs');

test('concurrent document edits converge', () => {
  const alice = new Y.Doc();
  const bob = new Y.Doc();

  alice.getText('shared-document').insert(0, 'Alice');
  bob.getText('shared-document').insert(0, 'Bob');
  Y.applyUpdate(alice, Y.encodeStateAsUpdate(bob));
  Y.applyUpdate(bob, Y.encodeStateAsUpdate(alice));

  assert.equal(
    alice.getText('shared-document').toString(),
    bob.getText('shared-document').toString(),
  );
});
