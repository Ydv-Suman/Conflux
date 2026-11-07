import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { validate, MAX_BYTES } from '../validate.mjs';

const encode = (bytes) => Buffer.from(bytes).toString('base64');
const empty = encode(new Uint8Array([0, 0]));
const snapshot = (doc) => encode(Y.encodeStateAsUpdate(doc));
function doc(t, clientID) {
  const value = new Y.Doc({ gc: false });
  value.clientID = clientID;
  t.after(() => value.destroy());
  return value;
}
function edit(value, action) {
  let bytes;
  const capture = (update) => { bytes = update; };
  value.on('update', capture);
  try { action(value.getText('content')); } finally { value.off('update', capture); }
  return encode(bytes);
}
const apply = (value, bytes) => Y.applyUpdate(value, Buffer.from(bytes, 'base64'));
const check = (baseline, update, writerId) => validate({ baseline, update, writerId });
const rejects = (action, code) => assert.throws(action, (error) => error.code === code);

test('accepts a writer-bound insert and returns tentative text and exact ranges', (t) => {
  const alice = doc(t, 10);
  const result = check(empty, edit(alice, (text) => text.insert(0, 'hello')), 10);
  assert.equal(result.before, '');
  assert.equal(result.after, 'hello');
  assert.deepEqual(result.inserted, [{ clientId: 10, clock: 0, length: 5 }]);
  assert.deepEqual(result.deleted, []);
  assert.equal(result.changed, true);
  assert.equal(result.snapshot, snapshot(alice));
});

test('rejects new foreign structs, including a forged writer ID in a snapshot', (t) => {
  const alice = doc(t, 10);
  const update = edit(alice, (text) => text.insert(0, 'alice'));
  rejects(() => check(empty, update, 20), 'FOREIGN_WRITER');
});

test('Bob can include known Alice structs without acquiring credit for them', (t) => {
  const alice = doc(t, 10), bob = doc(t, 20);
  const a = edit(alice, (text) => text.insert(0, 'Alice'));
  const baseline = check(empty, a, 10).snapshot;
  apply(bob, a);
  edit(bob, (text) => text.insert(text.length, ' Bob'));
  const result = check(baseline, snapshot(bob), 20);
  assert.equal(result.after, 'Alice Bob');
  assert.deepEqual(result.inserted, [{ clientId: 20, clock: 0, length: 4 }]);
  const replay = check(result.snapshot, snapshot(bob), 20);
  assert.equal(replay.changed, false);
  assert.deepEqual(replay.inserted, []);
});

test('merged and split encodings of an append keep identical origin evidence', (t) => {
  const alice = doc(t, 10);
  const first = edit(alice, (text) => text.insert(0, 'a'));
  const second = edit(alice, (text) => text.insert(1, 'b'));
  const result = check(check(empty, first, 10).snapshot, second, 10);
  assert.equal(check(result.snapshot, second, 10).changed, false);
  assert.equal(check(result.snapshot, snapshot(alice), 10).changed, false);
});

test('conflicting bytes for a known struct are rejected even though Yjs ignores them', (t) => {
  const alice = doc(t, 10), forged = doc(t, 10);
  const a = edit(alice, (text) => text.insert(0, 'a'));
  const lie = edit(forged, (text) => text.insert(0, 'b'));
  rejects(() => check(check(empty, a, 10).snapshot, lie, 10), 'CONFLICTING_STRUCT');
});

test('concurrent edits converge under either acceptance order', (t) => {
  const alice = doc(t, 10), bob = doc(t, 20);
  const a = edit(alice, (text) => text.insert(0, 'a'));
  const b = edit(bob, (text) => text.insert(0, 'b'));
  const ab = check(check(empty, a, 10).snapshot, b, 20);
  const ba = check(check(empty, b, 20).snapshot, a, 10);
  assert.equal(ab.after, ba.after);
  assert.equal(ab.snapshot, ba.snapshot);
});

test('deletion evidence identifies targets and replay creates no effective deletion', (t) => {
  const alice = doc(t, 10), bob = doc(t, 20);
  const a = edit(alice, (text) => text.insert(0, 'abc'));
  const baseline = check(empty, a, 10).snapshot;
  apply(bob, a);
  const removal = edit(bob, (text) => text.delete(1, 1));
  const result = check(baseline, removal, 20);
  assert.equal(result.after, 'ac');
  assert.deepEqual(result.inserted, []);
  assert.deepEqual(result.deleted, [{ clientId: 10, clock: 1, length: 1 }]);
  assert.equal(check(result.snapshot, removal, 20).changed, false);
  assert.equal(check(result.snapshot, snapshot(bob), 20).changed, false);
});

test('unknown deletion targets and incomplete clock sequences are rejected', (t) => {
  const alice = doc(t, 10);
  edit(alice, (text) => text.insert(0, 'a'));
  const second = edit(alice, (text) => text.insert(1, 'b'));
  rejects(() => check(empty, second, 10), 'CLOCK_GAP');
  const removal = edit(alice, (text) => text.delete(0, 1));
  rejects(() => check(empty, removal, 10), 'MISSING_DELETE_TARGET');
});

test('missing foreign anchors are rejected without mutating baseline', (t) => {
  const alice = doc(t, 10), bob = doc(t, 20);
  apply(bob, edit(alice, (text) => text.insert(0, 'a')));
  const b = edit(bob, (text) => text.insert(1, 'b'));
  rejects(() => check(empty, b, 20), 'MISSING_DEPENDENCY');
  assert.equal(check(snapshot(alice), b, 20).after, 'ab');
});

test('formatting, embeds, maps, foreign roots, and GC snapshots fail closed', (t) => {
  for (const change of [
    (d) => d.getMap('users').set('author', 'alice'),
    (d) => d.getText('other').insert(0, 'x'),
    (d) => d.getText('content').insertEmbed(0, { author: 'alice' }),
    (d) => d.getText('content').insert(0, 'x', { bold: true }),
  ]) {
    const value = doc(t, 10);
    change(value);
    rejects(() => check(empty, snapshot(value), 10), 'UNSUPPORTED_CONTENT');
  }
  const gc = doc(t, 10);
  gc.gc = true;
  gc.getText('content').insert(0, 'deleted');
  gc.getText('content').delete(0, 7);
  rejects(() => check(empty, snapshot(gc), 10), 'UNSUPPORTED_CONTENT');
});

test('bounds malformed data and rejects author claims and trailing bytes', (t) => {
  const alice = doc(t, 10);
  const a = edit(alice, (text) => text.insert(0, 'a'));
  rejects(() => validate({ baseline: empty, update: a, writerId: 10, authorId: 'alice' }), 'INVALID_REQUEST');
  rejects(() => check(empty, a, -1), 'INVALID_WRITER');
  rejects(() => check(empty, 'not base64', 10), 'INVALID_ENCODING');
  rejects(() => check(empty, encode(Buffer.from([255])), 10), 'MALFORMED_UPDATE');
  rejects(() => check(empty, encode(Buffer.concat([Buffer.from(a, 'base64'), Buffer.from([0])])), 10), 'TRAILING_BYTES');
  rejects(() => check(empty, encode(Buffer.alloc(MAX_BYTES + 1)), 10), 'INVALID_ENCODING');
  const large = doc(t, 10);
  rejects(() => check(empty, edit(large, (text) => text.insert(0, 'a'.repeat(100_001))), 10), 'CONTENT_LIMIT');
});

test('interleaved insertion and deletion survive reconstruction and alternative snapshots', (t) => {
  const alice = doc(t, 10), bob = doc(t, 20), restored = doc(t, 30);
  let state = check(empty, edit(alice, (text) => text.insert(0, 'hello 🌍')), 10).snapshot;
  apply(bob, state);
  const update = edit(bob, (text) => { text.insert(2, '!'); text.delete(0, 1); });
  // The listener captures the last update; the snapshot includes both transactions.
  assert.ok(update);
  state = check(state, snapshot(bob), 20).snapshot;
  apply(restored, state);
  const replay = check(state, snapshot(restored), 30);
  assert.equal(replay.changed, false);
  assert.equal(replay.after, 'e!llo 🌍');
});

test('reconstructs a deterministic mixed-edit history with snapshots and duplicate delivery', (t) => {
  const writers = [doc(t, 10), doc(t, 20)];
  let baseline = empty;
  for (let step = 0; step < 60; step++) {
    const writer = writers[step % 2];
    apply(writer, baseline);
    const update = edit(writer, (text) => {
      if (step % 3 === 0 && text.length > 0) text.delete(step % text.length, 1);
      else text.insert(step % (text.length + 1), String.fromCharCode(65 + step % 26));
    });
    const result = check(baseline, step % 4 === 0 ? snapshot(writer) : update, writer.clientID);
    assert.equal(result.after, writer.getText('content').toString());
    baseline = result.snapshot;
    assert.equal(check(baseline, update, writer.clientID).changed, false);
    assert.equal(check(baseline, snapshot(writer), writer.clientID).changed, false);
  }
});

test('concurrent deletion of the same text only records its effective removal once', (t) => {
  const alice = doc(t, 10), bob = doc(t, 20);
  const baseline = check(empty, edit(alice, (text) => text.insert(0, 'abc')), 10).snapshot;
  apply(bob, baseline);
  const a = edit(alice, (text) => text.delete(0, 2));
  const b = edit(bob, (text) => text.delete(0, 2));
  const result = check(baseline, a, 10);
  const repeated = check(result.snapshot, b, 20);
  assert.deepEqual(repeated.deleted, []);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.after, 'c');
});

test('does not silently mutate another writer\'s surrogate pair when inserting inside it', (t) => {
  const alice = doc(t, 10), bob = doc(t, 20);
  const a = edit(alice, (text) => text.insert(0, '🌍'));
  const baseline = check(empty, a, 10).snapshot;
  apply(bob, a);
  const split = edit(bob, (text) => text.insert(1, 'x'));
  rejects(() => check(baseline, split, 20), 'UNSUPPORTED_TEXT_SPLIT');
});

test('imports durable mixed-writer history without credit and preserves IDs for later edits', async (t) => {
  const { importHistory } = await import('../validate.mjs');
  const alice = doc(t, 10), bob = doc(t, 20);
  const a = edit(alice, text => text.insert(0, 'old'));
  apply(bob, a);
  const b = edit(bob, text => text.insert(3, ' work'));
  const imported = importHistory({ history: [a, b, b] });
  assert.equal(imported.after, 'old work'); assert.equal(imported.changed, false);
  assert.deepEqual(imported.inserted, []); assert.deepEqual(imported.deleted, []);
  assert.deepEqual(imported.importedWriters.sort(), [10, 20]);
  const current = doc(t, 30); apply(current, imported.snapshot);
  const update = edit(current, text => text.insert(8, '!'));
  const result = check(imported.snapshot, update, 30);
  assert.equal(result.after, 'old work!'); assert.deepEqual(result.inserted, [{ clientId: 30, clock: 0, length: 1 }]);
  assert.equal(check(result.snapshot, update, 30).changed, false);
  assert.equal(check(imported.snapshot, b, 30).changed, false);
});

test('imports deleted legacy text without resurrecting it or crediting tombstones', async (t) => {
  const { importHistory } = await import('../validate.mjs');
  const legacy = new Y.Doc(); t.after(() => legacy.destroy()); legacy.clientID = 10;
  legacy.getText('content').insert(0, 'abcdef'); legacy.getText('content').delete(1, 3);
  const imported = importHistory({ history: [snapshot(legacy)] });
  assert.equal(imported.after, 'aef');
  const current = doc(t, 30); apply(current, imported.snapshot);
  const update = edit(current, text => text.insert(1, 'X'));
  const result = check(imported.snapshot, update, 30);
  assert.equal(result.after, 'aXef'); assert.equal(result.inserted[0].length, 1);
  assert.equal(check(result.snapshot, snapshot(legacy), 30).changed, false);
});

test('migration rejects malformed, unsupported, and incomplete legacy histories', async (t) => {
  const { importHistory } = await import('../validate.mjs');
  const value = doc(t, 10); value.getMap('secrets').set('key', 'value');
  rejects(() => importHistory({ history: [snapshot(value)] }), 'UNSUPPORTED_CONTENT');
  rejects(() => importHistory({ history: [encode(new Uint8Array([255]))] }), 'MALFORMED_UPDATE');
  const other = doc(t, 20); edit(other, text => text.insert(0, 'a'));
  const dependent = edit(other, text => text.insert(1, 'b'));
  rejects(() => importHistory({ history: [dependent] }), 'INCOMPLETE_BASELINE');
});
