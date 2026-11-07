const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Y = require('yjs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(file, mocks) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/contributions', file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('require', 'module', 'exports', code)(name => name in mocks ? mocks[name] : require(name), module, module.exports);
  return module.exports;
}
const calls = [];
const api = load('api.ts', {
  '../../config': { COLLABORATION_WS_URL: 'wss://collab.example' },
  '../auth/session': { authenticatedServiceRequest: async (...args) => { calls.push(args); return {}; } },
});

test('uses scoped authenticated HTTP endpoints and encodes filters', async () => {
  const scope = { projectId: 'project', teamId: 'team', workstreamId: 'stream' };
  const window = api.dateWindow('2026-11-01', '2026-11-06');
  await api.getReport(scope, { ...window, actorId: 'a&b', documentId: 'main' });
  assert.equal(calls.at(-1)[0], 'https://collab.example');
  assert.ok(calls.at(-1)[1].startsWith('/api/projects/project/teams/team/workstreams/stream/contributions?'));
  const query = new URL('https://test' + calls.at(-1)[1]).searchParams;
  assert.equal(query.get('actorId'), 'a&b'); assert.equal(query.get('until'), '2026-11-07T00:00:00.000Z');
  await api.getEvidence(scope, { documentId: 'a/b', sequence: 7 });
  assert.ok(calls.at(-1)[1].endsWith('/documents/a%2Fb/changes/7'));
});

test('date windows are UTC inclusive dates with an exclusive end and bounded duration', () => {
  assert.deepEqual(api.dateWindow('2026-11-01', '2026-11-01'), { from: '2026-11-01T00:00:00.000Z', until: '2026-11-02T00:00:00.000Z' });
  for (const pair of [['', ''], ['2026-11-02', '2026-11-01'], ['2024-01-01', '2026-01-01']]) assert.throws(() => api.dateWindow(...pair));
});

test('evidence reconstructs Unicode and deletion snapshots without changing their source', () => {
  const doc = new Y.Doc({ gc: false });
  doc.getText('content').insert(0, 'hello 🌍');
  const before = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
  doc.getText('content').delete(0, 6);
  const after = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
  assert.equal(api.snapshotText(before), 'hello 🌍'); assert.equal(api.snapshotText(after), '🌍');
  assert.equal(api.snapshotText(before), 'hello 🌍');
  assert.throws(() => api.snapshotText('invalid'));
  doc.destroy();
});

test('dashboard entry is hidden for ordinary members and mismatched team scopes', () => {
  const { ContributionsButton } = load('ContributionsDashboard.tsx', {
    '../../api': { ApiError: class extends Error {} }, '../../components/Modal': { Modal: () => null },
    '../teams/api': { listTeamMembers: async () => [] }, './api': api, './contributions.css': {},
  });
  const scope = { projectId: 'project', teamId: 'team', workstreamId: 'stream' };
  for (const role of ['ADMIN', 'TEAM_LEAD', 'SENIOR_DEVELOPER', 'DEVELOPER', 'VIEWER']) {
    const html = renderToStaticMarkup(React.createElement(ContributionsButton, { scope, capabilities: { teamId: 'team', role } }));
    assert.equal(html.includes('Contributions'), ['ADMIN', 'TEAM_LEAD'].includes(role));
  }
  assert.equal(renderToStaticMarkup(React.createElement(ContributionsButton, { scope, capabilities: { teamId: 'other', role: 'ADMIN' } })), '');
});

const { ContributionResults } = load('ContributionsDashboard.tsx', {
  '../../api': { ApiError: class extends Error {} }, '../../components/Modal': { Modal: () => null },
  '../teams/api': { listTeamMembers: async () => [] }, './api': api, './contributions.css': {},
});
const emptyReport = { generatedAt: '2026-11-07T00:00:00Z', members: [], unverifiedMembers: [], dailyChanges: [], matchingDays: 0, changes: [], matchingChanges: 0, offset: 0,
  filesWithoutHistory: 4, legacyFiles: 7, importedFiles: 0, unknownRecords: 388 };
const renderResults = (report, extra = {}) => renderToStaticMarkup(React.createElement(ContributionResults, {
  scope: { projectId: 'p', teamId: 't', workstreamId: 'w' }, report, name: id => id, onMember: () => {}, onPage: () => {}, ...extra,
}));
test('empty report replaces empty tables and pagination with one useful state', () => {
  const html = renderResults(emptyReport);
  assert.ok(html.includes('No attributed edits yet'));
  assert.ok(html.includes('Earlier activity exists'));
  assert.ok(html.includes('<summary>Partial history</summary>'));
  assert.ok(!html.includes('<table'));
  assert.ok(!html.includes('<nav'));
  assert.ok(!html.includes('<details open'));
});
test('all members is a brief clickable summary, including admins without attributed edits', () => {
  const report = { ...emptyReport, members: [{ actorId: 'Alice', edits: 9, inserted: 560, deleted: 560, files: 1 }], unverifiedMembers: [{ actorId: 'Admin', records: 257 }] };
  const html = renderResults(report, { roster: [{ userId: 'Admin', role: 'ADMIN' }] });
  assert.ok(html.includes('Contributions by member')); assert.ok(html.includes('Admin'));
  assert.ok(html.includes('Unverified history available')); assert.ok(!html.includes('View changes'));
});
test('member details display one file/day row without repeating the member or date', () => {
  const report = { ...emptyReport, members: [{ actorId: 'Alice', edits: 9, inserted: 560, deleted: 560, files: 1 }],
    matchingDays: 1, dailyChanges: [{ documentId: 'main', path: 'main.ts', actorId: 'Alice', day: '2026-11-07', edits: 9, inserted: 560, deleted: 560, deletedFile: false }] };
  const html = renderResults(report, { selectedMember: 'Alice' });
  assert.equal((html.match(/Alice/g) || []).length, 1);
  assert.equal((html.match(/>2026-11-07</g) || []).length, 1);
  assert.ok(html.includes('View changes')); assert.ok(html.includes('aria-expanded="false"'));
  assert.ok(!html.includes('<table')); assert.ok(!html.includes('<nav'));
  assert.ok(renderResults({ ...report, matchingDays: 101 }, { selectedMember: 'Alice' }).includes('Daily change pages'));
});
test('all time does not send date bounds', async () => {
  await api.getReport({ projectId: 'p', teamId: 't', workstreamId: 'w' }, { allTime: true, from: '', until: '', actorId: '', documentId: '' });
  const query = new URL('https://test' + calls.at(-1)[1]).searchParams;
  assert.equal(query.get('allTime'), 'true'); assert.equal(query.has('from'), false); assert.equal(query.has('until'), false);
});
