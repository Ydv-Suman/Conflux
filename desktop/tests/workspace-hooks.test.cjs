const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const settle = () => new Promise(setImmediate);

// Run hook callbacks and effect cleanup without a browser or native Git process.
function harness(file, mocks) {
  const slots = [];
  let cursor = 0;
  let pending = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ||= { current: initial };
    },
    useCallback(callback) { return callback; },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        pending.push(() => {
          previous?.cleanup?.();
          slots[index] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const module = { exports: {} };
  const filename = path.resolve(__dirname, '../src/app', file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react') return react;
    if (name === './messages') return { messageFor: (error, fallback) => error.message || fallback };
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected import: ${name}`);
  }, module, module.exports);
  return {
    render(...args) { cursor = 0; return Object.values(module.exports)[0](...args); },
    effects() { const effects = pending; pending = []; effects.forEach(run => run()); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

function selectionMocks(listProjects) {
  return {
    '../features/projects/api': { listProjects, listProjectTeams: async () => [] },
    '../features/teams/api': { listTeams: async () => [] },
    '../features/repository/api': { isDesktop: () => false },
  };
}

test('declining the unsaved-work guard leaves selection intact and makes no request', async () => {
  let calls = 0;
  const hook = harness('useWorkspaceSelection.ts', selectionMocks(async () => { calls++; return []; }));
  const state = hook.render(() => false, () => {});
  await state.load('other', null);
  assert.equal(calls, 0);
  assert.equal(hook.render(() => false, () => {}).loading, false);
});

test('an older workspace response cannot replace the latest selection', async () => {
  const old = deferred();
  let calls = 0;
  const hook = harness('useWorkspaceSelection.ts', selectionMocks(() => ++calls === 1 ? old.promise : Promise.resolve([{ projectId: 'new' }])));
  const render = () => hook.render(() => true, () => {});
  const first = render().load('old', null);
  await render().load('new', null);
  old.resolve([{ projectId: 'old' }]);
  await first;
  assert.equal(render().project.projectId, 'new');
  assert.equal(render().loading, false);
});

test('opening a team selects its default shared workspace without duplicate streams', async () => {
  const stream = { workstreamId: 'shared' };
  const mocks = selectionMocks(async () => [{ projectId: 'project' }]);
  Object.assign(mocks['../features/projects/api'], {
    listProjectTeams: async () => [{ teamId: 'team' }],
    listWorkstreams: async () => [stream, { workstreamId: 'previous' }],
    getDefaultWorkstream: async () => stream,
  });
  Object.assign(mocks['../features/teams/api'], {
    listTeams: async () => [{ teamId: 'team' }], getTeam: async () => ({ teamId: 'team' }),
    listTeamMembers: async () => [], getMyTeamCapabilities: async () => ({ capabilities: [] }),
  });
  let opened = 0;
  const hook = harness('useWorkspaceSelection.ts', mocks);
  const render = () => hook.render(() => true, () => opened++);
  await render().load('project', 'team');
  assert.equal(render().activeWorkstream, stream);
  assert.deepEqual(render().workstreams.map(item => item.workstreamId), ['shared', 'previous']);
  assert.equal(opened, 1);
  await render().load('project', 'team', false);
  assert.equal(render().activeWorkstream, null);
  assert.equal(opened, 1);
});

function repositoryHarness(native) {
  return harness('useWorkspaceRepository.ts', {
    '../features/projects/api': { getProjectRepository: async () => null },
    '../features/projects/sharedWorkspace': { isRepositoryReady: () => true },
    '../features/repository/api': { isDesktop: () => true, ...native },
  });
}
const options = projectId => ({
  project: { projectId }, activeWorkstream: null, loading: false, busy: false,
  setActiveWorkstream() {}, setWorkstreams() {}, setRequestError() {},
});

test('repository restoration ignores a result after switching projects', async () => {
  const old = deferred();
  const hook = repositoryHarness({ restoreRepository: id => id === 'old' ? old.promise : Promise.resolve({ path: '/new' }) });
  hook.render(options('old')); hook.effects();
  hook.render(options('new')); hook.effects();
  await settle();
  old.resolve({ path: '/old' });
  await settle();
  assert.equal(hook.render(options('new')).repository.path, '/new');
  hook.unmount();
});

test('saving retains the repository boundary and expected previous content', async () => {
  const writes = [];
  const hook = repositoryHarness({ restoreRepository: async () => ({ path: '/repo' }), writeRepositoryFile: async (...args) => writes.push(args) });
  hook.render(options('project')); hook.effects();
  await settle();
  await hook.render(options('project')).saveRepositoryFile('/repo/file.ts', 'next', 'previous');
  assert.deepEqual(writes, [['/repo/file.ts', 'next', '/repo', 'previous']]);
  hook.unmount();
});
