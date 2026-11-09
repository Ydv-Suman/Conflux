const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const moduleValue = { exports: {} };
new Function('module', 'exports', ts.transpileModule(fs.readFileSync(require.resolve('../src/features/history/versionQueue.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(moduleValue, moduleValue.exports);
const { createVersionQueue } = moduleValue.exports;
const scope = { projectId: '11111111-1111-4111-8111-111111111111', teamId: '22222222-2222-4222-8222-222222222222', workstreamId: '33333333-3333-4333-8333-333333333333' };
const a = { ...scope, documentId: 'file-a' }, b = { ...scope, documentId: 'file-b' };
const connected = { phase: 'connected', ready: true, pending: false, persisting: false, message: '' };
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
function harness(initial = null) {
  let saved = initial, failSave = false, failCreate = null;
  const requests = [], callbacks = new Map(), disposed = [], statuses = [];
  const queue = createVersionQueue({
    load: async () => structuredClone(saved),
    save: async value => { if (failSave) throw new Error('disk failure'); saved = structuredClone(value); },
    create: async job => { requests.push(structuredClone(job)); if (failCreate) throw failCreate; },
    recover: async (job, onState) => { callbacks.set(job.documentId, onState); return { retry() {}, dispose() { disposed.push(job.documentId); } }; },
    onStatus: value => statuses.push(value),
  });
  return { queue, requests, callbacks, disposed, statuses, saved: () => saved,
    failSave: value => { failSave = value; }, failCreate: value => { failCreate = value; } };
}

test('open files never publish versions; closing A waits for its own receipts and leaves B open', async () => {
  const h = harness(), one = h.queue.retain(a), two = h.queue.retain(b);
  try {
    one.update(connected); two.update(connected);
    await h.queue.enqueue(a); await flush();
    assert.equal(h.requests.length, 0);
    assert.equal(h.saved().jobs.length, 1);
    one.release(); await flush();
    h.callbacks.get('file-a')({ ...connected, pending: true }); await flush();
    assert.equal(h.requests.length, 0);
    h.callbacks.get('file-a')(connected); await flush();
    assert.equal(h.requests.length, 1); assert.equal(h.requests[0].documentId, 'file-a');
    assert.deepEqual(h.saved().jobs, []);
    assert.ok(!h.callbacks.has('file-b'));
  } finally { h.queue.dispose(); }
});

test('offline requests survive restart with the same IDs and distinct close boundaries', async () => {
  const h = harness(), session = h.queue.retain(a);
  session.update({ ...connected, phase: 'reconnecting', pending: true });
  await h.queue.enqueue({ ...a, afterOperationId: '44444444-4444-4444-8444-444444444444' });
  await h.queue.enqueue({ ...a, afterOperationId: '55555555-5555-4555-8555-555555555555' });
  await flush(); assert.equal(h.requests.length, 0);
  const original = h.saved(); h.queue.dispose();
  const recovered = harness(original);
  try {
    await flush(); recovered.callbacks.get('file-a')(connected); await flush();
    assert.deepEqual(recovered.requests.map(job => job.requestId), original.jobs.map(job => job.requestId));
    assert.deepEqual(recovered.requests.map(job => job.afterOperationId), original.jobs.map(job => job.afterOperationId));
    assert.deepEqual(recovered.saved().jobs, []);
  } finally { recovered.queue.dispose(); }
});

test('lost HTTP replies and failed local removal retry the original checkpoint request', async () => {
  const h = harness(), session = h.queue.retain(a);
  try {
    session.update(connected); await h.queue.enqueue(a); session.release(); await flush();
    h.failCreate(Object.assign(new Error('reply lost'), { status: 503 }));
    h.callbacks.get('file-a')(connected); await flush();
    const id = h.saved().jobs[0].requestId;
    h.failCreate(null); h.failSave(true); h.queue.retry(); await flush();
    assert.equal(h.saved().jobs[0].requestId, id);
    h.failSave(false); h.queue.retry(); await flush();
    assert.equal(h.requests.length, 3);
    assert.ok(h.requests.every(job => job.requestId === id)); assert.deepEqual(h.saved().jobs, []);
  } finally { h.queue.dispose(); }
});

test('failed enqueue cannot close a file safely, and denied requests remain durable until explicit retry', async () => {
  const h = harness(), session = h.queue.retain(a);
  try {
    session.update(connected); h.failSave(true);
    await assert.rejects(h.queue.enqueue(a), /disk failure/); assert.equal(h.requests.length, 0);
    h.failSave(false); await h.queue.enqueue(a); session.release(); await flush();
    h.failCreate(Object.assign(new Error('access denied'), { status: 403 }));
    h.callbacks.get('file-a')(connected); await flush();
    await h.queue.pump(); await flush(); assert.equal(h.requests.length, 1); assert.equal(h.saved().jobs.length, 1);
    h.failCreate(null); h.queue.retry(); await flush();
    h.callbacks.get('file-a')(connected); await flush();
    assert.deepEqual(h.saved().jobs, []);
  } finally { h.queue.dispose(); }
});

test('reopening a file cancels background recovery and permits its previous close after the active file synchronizes', async () => {
  const h = harness(), first = h.queue.retain(a);
  try {
    first.update(connected); await h.queue.enqueue(a); first.release(); await flush();
    const reopened = h.queue.retain(a);
    assert.ok(h.disposed.includes('file-a'));
    reopened.update({ ...connected, pending: true }); await flush(); assert.equal(h.requests.length, 0);
    reopened.update(connected); await flush(); assert.equal(h.requests.length, 1);
    assert.deepEqual(h.saved().jobs, []);
  } finally { h.queue.dispose(); }
});

test('corrupt queue state is never overwritten by a new close', async () => {
  const h = harness({ version: 99, jobs: [] });
  try { await assert.rejects(h.queue.enqueue(a), /could not be recovered/); assert.equal(h.saved().version, 99); }
  finally { h.queue.dispose(); }
});

test('an already acknowledged close publishes its fixed boundary without reopening the document', async () => {
  const h = harness(), session = h.queue.retain(a);
  try {
    session.update(connected); await h.queue.enqueue({ ...a, afterSequence: 12 }); await flush();
    assert.equal(h.requests.length, 0);
    session.release(); await flush();
    assert.equal(h.requests.length, 1); assert.equal(h.requests[0].afterSequence, 12);
    assert.equal(h.callbacks.size, 0); assert.deepEqual(h.saved().jobs, []);
  } finally { h.queue.dispose(); }
});
