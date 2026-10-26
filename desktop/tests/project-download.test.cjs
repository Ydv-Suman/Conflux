const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');
const compile = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
require.extensions['.ts'] = compile;
require.extensions['.tsx'] = compile;
const mock = (relative, exports) => {
  const filename = path.resolve(__dirname, relative);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
let desktop, folder, handler, current, configuration, roles, saved;
const calls = [];
const revision = 'a'.repeat(40);
const stream = { projectId: 'p1', teamId: 't1', workstreamId: 'w1', name: 'Shared', branchName: 'conflux/team/t1', baseRevision: revision, currentRevision: 'b'.repeat(40), repositoryReady: true };
const remote = { projectId: 'p1', repositoryUrl: 'https://git.example.com/repo.git', accessMode: 'PUBLIC', canonicalBranch: 'main', canonicalRevision: revision, version: 1 };
const local = { branch: stream.branchName, revision: stream.currentRevision, branches: [stream.branchName], path: '/download', files: [] };
mock('../src/config.ts', { WORKSPACE_API_URL: 'workspace' });
mock('../src/features/auth/session.ts', { authenticatedServiceRequest: async (...args) => { calls.push(args); return handler(...args); } });
mock('../src/features/teams/api.ts', { getMyTeamCapabilities: async () => { calls.push(['capabilities']); return { capabilities: roles }; } });
mock('../src/features/repository/api.ts', {
  isDesktop: () => desktop,
  selectDownloadFolder: async () => { calls.push(['picker']); return folder; },
  restoreRepository: async () => saved,
  downloadRepository: async (...args) => { calls.push(['clone', ...args]); return local; },
});
mock('../src/features/projects/sharedWorkspace.ts', {
  isRepositoryReady: (value) => value.repositoryReady && !!value.currentRevision && !!value.baseRevision,
  validateSharedRepository: (value, repo) => { assert.equal(repo.branch, value.branchName); assert.equal(repo.revision, value.currentRevision); },
  initializeSharedWorkspace: async (value) => { calls.push(['initialize', value]); current = stream; return stream; },
  openSharedRepository: async (...args) => { calls.push(['open', ...args]); return local; },
});
const api = require('../src/features/projects/api.ts');
const { downloadSharedProject } = require('../src/features/projects/projectDownload.ts');
const { SharedWorkspaceSetup } = require('../src/features/projects/SharedWorkspaceSetup.tsx');
const { configurationFromGit } = require('../src/features/projects/RepositorySettings.tsx');
beforeEach(() => {
  calls.length = 0; desktop = true; folder = '/downloads'; current = stream; configuration = remote; roles = ['JOIN_WORKSTREAM']; saved = null;
  handler = async (_base, route) => route.endsWith('/repository') ? configuration : current;
});

test('repository GET normalizes unconfigured response and PUT includes concurrency version', async () => {
  configuration = undefined;
  assert.equal(await api.getProjectRepository('project/a'), null);
  const { projectId, version, ...fields } = remote;
  await api.updateProjectRepository(projectId, fields, version);
  assert.deepEqual(calls, [
    ['workspace', '/api/projects/project%2Fa/repository', 'GET'],
    ['workspace', '/api/projects/p1/repository', 'PUT', { ...fields, expectedVersion: 1 }],
  ]);
});

test('invitation project list contains only projects assigned to that team', async () => {
  handler = async (_base, route) => route === '/api/projects'
    ? [{ projectId: 'a' }, { projectId: 'b' }]
    : route.includes('/a/') ? [{ teamId: 't1' }] : [{ teamId: 't2' }];
  assert.deepEqual(await api.listTeamProjects('t1'), [{ projectId: 'a' }]);
});

test('cancelling download does not request metadata, clone, or close the current editor', async () => {
  folder = null; let started = false;
  assert.equal(await downloadSharedProject('p1', 't1', () => { started = true; }), null);
  assert.equal(started, false);
  assert.deepEqual(calls, [['picker']]);
});

test('browser cannot invoke the folder picker or native clone', async () => {
  desktop = false;
  await assert.rejects(downloadSharedProject('p1', 't1'), /Conflux desktop/);
  assert.deepEqual(calls, []);
});

test('developer download uses current shared revision and opens that same workstream', async () => {
  let started = false;
  const result = await downloadSharedProject('p1', 't1', () => { started = true; });
  assert.equal(started, true);
  assert.equal(result.stream.workstreamId, 'w1');
  assert.deepEqual(calls.find(([name]) => name === 'clone'), ['clone', remote, folder, stream.branchName, stream.currentRevision]);
  assert.ok(calls.some(([name]) => name === 'open'));
  assert.ok(!calls.some(([name]) => name === 'initialize'));
});

test('authorized manager downloads and initializes an unconfigured shared workstream', async () => {
  current = { ...stream, currentRevision: null, baseRevision: null, repositoryReady: false };
  roles = ['JOIN_WORKSTREAM', 'CREATE_WORKSTREAM'];
  const result = await downloadSharedProject('p1', 't1');
  assert.equal(calls.find(([name]) => name === 'clone')[4], revision);
  assert.ok(calls.some(([name]) => name === 'initialize'));
  assert.equal(result.stream, stream);
});

test('developer can download a pending project without escalating setup permissions', async () => {
  current = { ...stream, currentRevision: null, baseRevision: null, repositoryReady: false };
  const result = await downloadSharedProject('p1', 't1');
  assert.equal(result.stream.repositoryReady, false);
  assert.ok(!calls.some(([name]) => name === 'initialize' || name === 'open'));
});

test('unconfigured remote or missing join permission never starts clone', async () => {
  configuration = null;
  await assert.rejects(downloadSharedProject('p1', 't1'), /configure the shared repository/);
  configuration = remote; roles = [];
  await assert.rejects(downloadSharedProject('p1', 't1'), /role does not allow/);
  assert.ok(!calls.some(([name]) => name === 'clone'));
});

test('an existing valid shared mapping is opened without a second clone', async () => {
  saved = local;
  const result = await downloadSharedProject('p1', 't1');
  assert.equal(result.repository, local);
  assert.ok(!calls.some(([name]) => name === 'clone'));
});

test('access is checked again after Git completes before opening the editor', async () => {
  let checks = 0;
  handler = async (_base, route) => {
    if (route.endsWith('/default') && ++checks === 2) roles = [];
    return route.endsWith('/repository') ? configuration : current;
  };
  await assert.rejects(downloadSharedProject('p1', 't1'), /access changed/);
  assert.ok(calls.some(([name]) => name === 'clone'));
  assert.ok(!calls.some(([name]) => name === 'open'));
});

test('workspace exposes download only when a remote and a download action are available', () => {
  const render = (overrides = {}) => renderToStaticMarkup(SharedWorkspaceSetup({ stream, repository: null, desktop: true, canInitialize: false, busy: false, error: null, remote, onDownload() {}, onConnect() {}, onInitialize() {}, onRetry() {}, onExplore() {}, ...overrides }));
  assert.ok(render().includes('Download project</button>'));
  assert.ok(!render({ remote: null }).includes('Download project</button>'));
  assert.ok(!render({ desktop: false }).includes('Download project</button>'));
  assert.ok(!render({ onDownload: undefined }).includes('Download project</button>'));
  assert.ok(render({ downloading: true, busy: true }).includes('Downloading and checking'));
});


test('Git metadata prefills URL, branch, full revision, and transport-based access', () => {
  const https = configurationFromGit({ remoteUrl: remote.repositoryUrl, branch: 'feature/predict', revision });
  assert.deepEqual(https, { repositoryUrl: remote.repositoryUrl, accessMode: 'HTTPS_CREDENTIAL_HELPER', canonicalBranch: 'feature/predict', canonicalRevision: revision });
  const ssh = configurationFromGit({ remoteUrl: 'ssh://git@example.com/repo.git', branch: 'main', revision });
  assert.equal(ssh.accessMode, 'SSH_AGENT');
  const missing = configurationFromGit({ remoteUrl: null, branch: '', revision });
  assert.equal(missing.repositoryUrl, '');
  assert.equal(missing.canonicalBranch, '');
  assert.equal(missing.canonicalRevision, revision);
});
