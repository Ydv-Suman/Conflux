const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');

const originalTs = require.extensions['.ts'];
const originalTsx = require.extensions['.tsx'];
const compile = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
require.extensions['.ts'] = compile;
require.extensions['.tsx'] = compile;
const mock = (relative, exports) => {
  const filename = path.resolve(__dirname, relative);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
const calls = [];
let request;
let restore;
let create;
mock('../src/config.ts', { WORKSPACE_API_URL: 'workspace', API_URL: 'identity' });
mock('../src/features/auth/session.ts', { authenticatedServiceRequest: async (...args) => { calls.push(args); return request(...args); } });
mock('../src/features/repository/api.ts', {
  restoreRepository: async (...args) => { calls.push(['restore', ...args]); return restore(...args); },
  createWorktree: async (...args) => { calls.push(['create', ...args]); return create(...args); },
  connectRepository: async (...args) => { calls.push(['connect', ...args]); return local; },
});
const api = require('../src/features/projects/api.ts');
const { ApiError } = require('../src/api.ts');
const { openSharedRepository, initializeSharedWorkspace } = require('../src/features/projects/sharedWorkspace.ts');
const { SharedWorkspaceSetup } = require('../src/features/projects/SharedWorkspaceSetup.tsx');
require.extensions['.ts'] = originalTs;
require.extensions['.tsx'] = originalTsx;

const revision = 'a'.repeat(40);
const stream = { projectId: 'project-1', teamId: 'team-1', workstreamId: 'shared-1', name: 'Team workspace', branchName: 'conflux/team/team-1', baseRevision: revision, currentRevision: revision, defaultWorkstream: true, repositoryReady: true };
const pending = { ...stream, baseRevision: null, currentRevision: null, repositoryReady: false };
const local = { path: '/local/project', name: 'Project', branch: stream.branchName, revision, branches: [stream.branchName], modified: false, files: [], lastOpenedFile: null };
const source = { ...local, branch: 'main', branches: ['main'] };
beforeEach(() => { calls.length = 0; request = async () => stream; restore = async () => null; create = async () => local; });

test('default lookup and initialization use the shared APIs with encoded IDs and actual Git revision', async () => {
  await api.getDefaultWorkstream('a/b', 'c d');
  await api.initializeDefaultRepository('a/b', 'c d', stream.name, stream.branchName, revision);
  assert.deepEqual(calls, [
    ['workspace', '/api/projects/a%2Fb/teams/c%20d/workstreams/default', 'GET'],
    ['workspace', '/api/projects/a%2Fb/teams/c%20d/workstreams/default/repository', 'PUT', { name: stream.name, branchName: stream.branchName, baseRevision: revision }],
  ]);
});

test('uninitialized workspaces never invoke local Git', async () => {
  assert.equal(await openSharedRepository(pending), null);
  assert.equal(await openSharedRepository({ ...stream, currentRevision: null }), null);
  assert.deepEqual(calls, []);
});

test('existing shared mapping is reused without creating a new workstream or branch, including dirty local files', async () => {
  restore = async () => ({ ...local, modified: true });
  assert.equal((await openSharedRepository(stream)).modified, true);
  assert.deepEqual(calls, [['restore', 'project-1', 'shared-1']]);
});

test('new members without a local project copy are prompted to connect one', async () => {
  assert.equal(await openSharedRepository(stream), null);
  assert.deepEqual(calls, [['restore', 'project-1', 'shared-1'], ['restore', 'project-1', null]]);
});

test('missing shared branch is created from current shared revision, not original base', async () => {
  const currentRevision = 'b'.repeat(40);
  restore = async (_projectId, id) => id ? null : source;
  create = async () => ({ ...local, revision: currentRevision });
  await openSharedRepository({ ...stream, currentRevision });
  assert.deepEqual(calls.at(-1), ['create', 'project-1', 'shared-1', stream.branchName, currentRevision, true]);
});

test('existing shared branch is opened without recreating it', async () => {
  restore = async (_projectId, id) => id ? null : { ...source, branches: ['main', stream.branchName] };
  await openSharedRepository(stream);
  assert.deepEqual(calls.at(-1), ['create', 'project-1', 'shared-1', stream.branchName, revision, false]);
});

test('a clone already on the shared branch is connected directly', async () => {
  restore = async (_projectId, id) => id ? null : local;
  await openSharedRepository(stream);
  assert.deepEqual(calls.at(-1), ['connect', 'project-1', 'shared-1', '/local/project']);
  assert.ok(!calls.some(([command]) => command === 'create'));
});

test('choosing a corrected folder replaces a mismatched mapping without deleting it', async () => {
  restore = async () => ({ ...local, branch: 'wrong' });
  await openSharedRepository(stream, local);
  assert.deepEqual(calls, [['connect', 'project-1', 'shared-1', '/local/project']]);
});

test('wrong branch or revision stops collaboration without Git mutations', async () => {
  for (const invalid of [{ ...local, branch: 'wrong' }, { ...local, revision: 'b'.repeat(40) }]) {
    calls.length = 0;
    restore = async () => invalid;
    await assert.rejects(openSharedRepository(stream), /shared/);
    assert.deepEqual(calls, [['restore', 'project-1', 'shared-1']]);
  }
});

test('concurrent opens share the same worktree operation and failed opens can retry', async () => {
  restore = async (_projectId, id) => id ? null : source;
  const [first, second] = await Promise.all([openSharedRepository(stream), openSharedRepository(stream)]);
  assert.equal(first, second);
  assert.equal(calls.filter(([command]) => command === 'create').length, 1);
  create = async () => { throw new Error('Missing commit'); };
  await assert.rejects(openSharedRepository(stream), /Missing commit/);
  create = async () => local;
  assert.equal(await openSharedRepository(stream), local);
});

test('simultaneous setup joins the winner’s default without replacing branch or revision', async () => {
  const winner = { ...stream, branchName: 'team/existing', currentRevision: 'b'.repeat(40) };
  request = async (_base, _path, method) => {
    if (method === 'PUT') throw new ApiError('Already initialized', 409, null);
    return winner;
  };
  assert.equal(await initializeSharedWorkspace(pending, source), winner);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][2], 'PUT');
  assert.equal(calls[1][2], 'GET');
});

test('setup does not hide permission failures or branch conflicts', async () => {
  request = async () => { throw new ApiError('Forbidden', 403, null); };
  await assert.rejects(initializeSharedWorkspace(pending, source), /Forbidden/);
  assert.equal(calls.length, 1);
  calls.length = 0;
  request = async (_base, _path, method) => {
    if (method === 'PUT') throw new ApiError('Branch taken', 409, null);
    return pending;
  };
  await assert.rejects(initializeSharedWorkspace(pending, source), /Branch taken/);
});

test('dirty shared branch and existing non-current branch cannot publish initialization', async () => {
  await assert.rejects(initializeSharedWorkspace(pending, { ...local, modified: true }), /Commit or stash/);
  await assert.rejects(initializeSharedWorkspace(pending, { ...source, branches: [stream.branchName] }), /Open conflux/);
  assert.deepEqual(calls, []);
});

const render = (props = {}) => renderToStaticMarkup(SharedWorkspaceSetup({ stream: pending, repository: null, desktop: true, canInitialize: false, busy: false, error: null, onConnect() {}, onInitialize() {}, onRetry() {}, onExplore() {}, ...props }));
test('setup UI distinguishes waiting, initialization, local clone, and browser-only states', () => {
  const waiting = render();
  assert.ok(waiting.includes('Waiting for workspace setup'));
  assert.ok(!waiting.includes('<button'));
  const setup = render({ canInitialize: true, repository: source });
  assert.ok(setup.includes('Set up shared workspace</button>'));
  const clone = render({ stream });
  assert.ok(clone.includes('Select local folder'));
  assert.ok(!clone.includes('Set up shared workspace</button>'));
  const browser = render({ desktop: false, canInitialize: true, repository: source });
  assert.ok(browser.includes('Open Conflux desktop'));
  assert.ok(!browser.includes('<button'));
});

test('local failure UI offers retry and never offers Explorer for a rejected repository', () => {
  const html = render({ stream, repository: local, error: 'Wrong branch <main>' });
  assert.ok(html.includes('role="alert"'));
  assert.ok(html.includes('Wrong branch &lt;main&gt;'));
  assert.ok(html.includes('Retry</button>'));
  assert.ok(!html.includes('Open Explorer</button>'));
});


test('a dirty source on another branch initializes from its last commit', async () => {
  await initializeSharedWorkspace(pending, { ...source, modified: true });
  assert.equal(calls[0][2], 'PUT');
  assert.equal(calls[0][3].baseRevision, source.revision);
  assert.equal(calls[0][3].branchName, pending.branchName);
});

test('dirty source setup is enabled with an explicit committed-files explanation', () => {
  const html = render({ canInitialize: true, repository: { ...source, modified: true } });
  assert.ok(html.includes('Set up from last commit</button>'));
  assert.ok(html.includes('uncommitted changes stay in this folder and will not be included'));
  assert.ok(!html.includes('disabled'));
  const blocked = render({ canInitialize: true, repository: { ...local, modified: true } });
  assert.ok(blocked.includes('disabled'));
  assert.ok(blocked.includes('Commit or stash'));
});
