const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { createAutoSave } = require('../src/features/editor/autoSave.ts');
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function setup(t, write) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let content = 'initial';
  const writes = [], saved = [], errors = [];
  const saver = createAutoSave({ initialContent: content, getContent: () => content,
    write: async (value, previous) => { writes.push([value, previous]); if (write) await write(value); },
    onSaved: (value) => saved.push(value), onError: (error) => errors.push(error), onSaving() {},
  });
  t.after(() => saver.dispose());
  return { saver, writes, saved, errors, change: (value) => { content = value; saver.changed(); } };
}
test('does not save partial replay, then debounces local and remote edits', async (t) => {
  const h = setup(t); h.change('partial history'); t.mock.timers.tick(1000); await settle();
  assert.deepEqual(h.writes, []);
  h.change('complete shared history'); h.saver.setReady(true); t.mock.timers.tick(599); await settle();
  assert.deepEqual(h.writes, []);
  h.change('typing'); t.mock.timers.tick(400); h.change('final'); t.mock.timers.tick(600); await settle();
  assert.deepEqual(h.writes, [['final', 'initial']]); assert.deepEqual(h.saved, ['final']);
});
test('serializes slow writes and saves changes made while a write is running', async (t) => {
  let finish;
  const h = setup(t, (value) => value === 'first' ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve());
  h.saver.setReady(true); h.change('first'); t.mock.timers.tick(600); await settle();
  h.change('second'); t.mock.timers.tick(600); await settle(); assert.equal(h.writes.length, 1);
  finish(); await settle();
  assert.deepEqual(h.writes, [['first', 'initial'], ['second', 'first']]);
  assert.deepEqual(h.saved, ['first', 'second']);
});
test('failed saves remain unsaved without an automatic retry loop and can be retried', async (t) => {
  let fail = true;
  const h = setup(t, () => { if (fail) throw new Error('Disk unavailable'); });
  h.saver.setReady(true); h.change('edited'); t.mock.timers.tick(600); await settle();
  assert.equal(h.errors.length, 1); assert.deepEqual(h.saved, []);
  t.mock.timers.tick(10000); await settle(); assert.equal(h.writes.length, 1);
  fail = false; await h.saver.flush(); assert.deepEqual(h.saved, ['edited']);
  assert.deepEqual(h.writes[1], ['edited', 'initial']);
});
test('blur/manual flush saves immediately, unchanged text does not write, disposal cancels pending writes', async (t) => {
  const h = setup(t); h.saver.setReady(true); h.change('edited'); await h.saver.flush();
  assert.equal(h.writes.length, 1); await h.saver.flush(); assert.equal(h.writes.length, 1);
  h.change('later'); h.saver.dispose(); t.mock.timers.tick(1000); await settle();
  assert.equal(h.writes.length, 1);
});

test('Yjs updates autosave local and remote text while preserving line endings', async (t) => {
  const Y = require('yjs');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = new Y.Doc(), peer = new Y.Doc();
  const text = doc.getText('content');
  const writes = [];
  const saver = createAutoSave({ initialContent: 'first\r\n', getContent: () => text.toString(),
    write: async (content) => { writes.push(content); }, onSaved() {}, onError(error) { throw error; }, onSaving() {},
  });
  doc.on('update', saver.changed);
  t.after(() => { saver.dispose(); doc.destroy(); peer.destroy(); });
  text.insert(0, 'first\r\n');
  t.mock.timers.tick(1000); await settle(); assert.deepEqual(writes, []);
  saver.setReady(true); text.insert(text.length, 'local\r\n');
  t.mock.timers.tick(600); await settle(); assert.deepEqual(writes, ['first\r\nlocal\r\n']);
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  peer.getText('content').insert(peer.getText('content').length, 'remote\r\n');
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer), 'remote');
  t.mock.timers.tick(600); await settle();
  assert.equal(writes.at(-1), 'first\r\nlocal\r\nremote\r\n');
});
