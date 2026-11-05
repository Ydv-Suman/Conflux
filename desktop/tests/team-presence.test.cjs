const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('require', 'module', 'exports', code)(name => name in mocks ? mocks[name] : require(name), module, module.exports);
  return module.exports;
}
const { connectTeamPresence } = load('features/teams/presenceConnection.ts');
const team = '11111111-1111-4111-8111-111111111111';
const otherTeam = '22222222-2222-4222-8222-222222222222';
const alice = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bob = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const settle = () => new Promise(setImmediate);
let sockets, connections;
const originalSocket = global.WebSocket;
class Socket {
  listeners = new Map();
  sent = [];
  closed = false;
  constructor(url) { this.url = url; sockets.push(this); }
  addEventListener(name, handler) { this.listeners.set(name, [...(this.listeners.get(name) || []), handler]); }
  emit(name, data) { for (const handler of this.listeners.get(name) || []) handler(data); }
  send(data) { this.sent.push(data); }
  close() { this.closed = true; this.emit('close', { code: 1000 }); }
  drop(code) { this.closed = true; this.emit('close', { code }); }
  snapshot(data = {}) { this.emit('message', { data: JSON.stringify({ type: 'presence', teamId: team, count: 1, ...data }) }); }
}
beforeEach(t => {
  sockets = []; connections = [];
  global.WebSocket = Socket;
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
});
afterEach(() => { connections.forEach(connection => connection.dispose()); global.WebSocket = originalSocket; });
async function connect(overrides = {}) {
  const states = [], tokens = [];
  const connection = connectTeamPresence({
    endpoint: `ws://localhost/ws/teams/${team}/presence`, teamId: team,
    getToken: async rejected => { tokens.push(rejected); return rejected ? 'fresh-token' : 'token'; },
    onState: state => states.push(state), ...overrides,
  });
  connections.push(connection);
  await settle();
  return { connection, states, tokens, socket: sockets.at(-1), latest: () => states.at(-1) };
}

test('authenticates without URL credentials and replaces snapshots without inflating counts', async t => {
  const client = await connect();
  client.socket.emit('open');
  assert.ok(!client.socket.url.includes('token'));
  assert.deepEqual(JSON.parse(client.socket.sent[0]), { token: 'token' });
  client.socket.snapshot({ count: 2, userIds: [alice, bob] });
  client.socket.snapshot({ count: 2, userIds: [alice, bob] });
  assert.equal(client.latest().count, 2);
  t.mock.timers.tick(10000);
  assert.equal(client.socket.sent.at(-1), 'ping');
  client.socket.snapshot({ count: 1, userIds: [alice] });
  assert.deepEqual(client.latest().userIds, [alice]);
  client.socket.snapshot();
  assert.equal(client.latest().phase, 'online');
  assert.equal(client.latest().userIds, undefined, 'demotion clears privileged roster');
});

test('disconnect clears the count and roster and reconnect starts a new heartbeat', async t => {
  const client = await connect();
  client.socket.snapshot({ userIds: [alice] });
  client.socket.drop(1013);
  assert.deepEqual(client.latest(), { teamId: team, phase: 'offline', count: null });
  t.mock.timers.tick(500); await settle();
  const next = sockets.at(-1);
  assert.notEqual(next, client.socket);
  next.emit('open'); next.snapshot();
  t.mock.timers.tick(10000);
  assert.equal(next.sent.at(-1), 'ping');
  assert.equal(client.socket.sent.length, 0);
});

test('missing server responses clear stale presence even if the socket stays open', async t => {
  const client = await connect();
  client.socket.snapshot({ userIds: [alice] });
  t.mock.timers.tick(25000);
  assert.equal(client.latest().phase, 'offline');
  assert.equal(client.latest().count, null);
  assert.equal(client.latest().userIds, undefined);
  assert.equal(client.socket.closed, true);
  t.mock.timers.tick(500); await settle();
  sockets.at(-1).snapshot();
  t.mock.timers.tick(10000);
  assert.equal(sockets.at(-1).sent.at(-1), 'ping');
});

test('refreshes expired credentials once and stops after repeated rejection', async t => {
  const client = await connect();
  client.socket.drop(4401);
  t.mock.timers.tick(500); await settle();
  assert.deepEqual(client.tokens, [undefined, 'token']);
  sockets.at(-1).emit('open');
  assert.deepEqual(JSON.parse(sockets.at(-1).sent[0]), { token: 'fresh-token' });
  sockets.at(-1).drop(4401);
  t.mock.timers.tick(60000); await settle();
  assert.equal(sockets.length, 2);
  assert.equal(client.latest().phase, 'offline');
});

test('access and protocol denial stop retries and erase the roster', async t => {
  for (const code of [4403, 1008, 1009]) {
    const client = await connect();
    client.socket.snapshot({ userIds: [alice] });
    client.socket.drop(code);
    assert.equal(client.latest().phase, 'offline');
    assert.equal(client.latest().count, null);
    assert.equal(client.latest().userIds, undefined);
    assert.ok(client.latest().message);
  }
  t.mock.timers.tick(60000); await settle();
  assert.equal(sockets.length, 3);
});

test('a failed session refresh can recover through explicit retry without reopening the editor', async () => {
  let unavailable = true;
  const client = await connect({ getToken: async () => {
    if (unavailable) throw new Error('Session refresh unavailable');
    return 'token';
  } });
  assert.equal(sockets.length, 0);
  assert.match(client.latest().message, /refresh your session/);
  unavailable = false;
  client.connection.retry(); await settle();
  sockets.at(-1).emit('open'); sockets.at(-1).snapshot();
  assert.equal(client.latest().phase, 'online');
  assert.equal(client.latest().count, 1);
  assert.equal(client.latest().message, undefined);
});

test('explicit retry cancels pending reconnect and ignores old socket events', async t => {
  const client = await connect();
  client.socket.drop(1013);
  client.connection.retry(); await settle();
  sockets.at(-1).snapshot();
  client.socket.snapshot({ count: 3 });
  t.mock.timers.tick(500); await settle();
  assert.equal(sockets.length, 2);
  assert.equal(client.latest().count, 1);
});

test('rejects malformed and cross-team snapshots instead of showing stale or fabricated counts', async t => {
  for (const data of [
    { teamId: otherTeam }, { count: 0 }, { count: 129 }, { count: 1.5 },
    { userIds: [alice, bob] }, { count: 2, userIds: [alice, alice] }, { userIds: ['not-a-uuid'] },
    { userIds: null }, { type: 'unknown' },
  ]) {
    const client = await connect();
    client.socket.snapshot({ userIds: [alice] });
    client.socket.snapshot(data);
    assert.equal(client.latest().phase, 'offline');
    assert.equal(client.latest().count, null);
    assert.equal(client.latest().userIds, undefined);
    assert.equal(client.socket.closed, true);
  }
  const count = sockets.length;
  t.mock.timers.tick(60000); await settle();
  assert.equal(sockets.length, count);
});

test('team switch/disposal ignores old events, cancels timers, and cancels pending authentication', async t => {
  const first = await connect();
  first.socket.snapshot({ userIds: [alice] });
  first.connection.dispose();
  const length = first.states.length;
  const second = await connect({ teamId: otherTeam, endpoint: `ws://localhost/ws/teams/${otherTeam}/presence` });
  second.socket.snapshot({ teamId: otherTeam });
  first.socket.snapshot({ count: 2, userIds: [alice, bob] });
  assert.equal(first.states.length, length);
  assert.equal(second.latest().teamId, otherTeam);
  second.connection.dispose();
  let resolve;
  const pending = await connect({ getToken: () => new Promise(done => { resolve = done; }) });
  pending.connection.dispose(); resolve('token'); await settle();
  t.mock.timers.tick(60000); await settle();
  assert.equal(sockets.length, 2);
  assert.equal(first.socket.closed, true);
});

// Exercise React effects and cleanup without starting the native runtime.
function hooks() {
  const slots = []; let cursor = 0, effects = [];
  return {
    react: {
      ...React,
      useCallback(fn) { return fn; },
      useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
      useState(initial) {
        const i = cursor++;
        if (!(i in slots)) slots[i] = initial;
        return [slots[i], value => { slots[i] = value; }];
      },
      useEffect(effect, deps) {
        const i = cursor++, previous = slots[i];
        if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) {
          effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; });
        }
      },
    },
    render(fn, props) { cursor = 0; return fn(props); },
    effects() { const pending = effects; effects = []; pending.forEach(run => run()); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test('one presence subscription survives file changes and closes on team changes or logout', () => {
  const h = hooks(), calls = [];
  const { useTeamPresence } = load('features/teams/useTeamPresence.ts', {
    react: h.react, '../../config': { COLLABORATION_WS_URL: 'ws://localhost' },
    '../auth/session': { getCollaborationToken() {} },
    './presenceConnection': { connectTeamPresence(options) {
      const call = { ...options, disposed: false }; calls.push(call);
      return { dispose() { call.disposed = true; } };
    } },
  });
  h.render(useTeamPresence, team); h.effects();
  calls[0].onState({ teamId: team, phase: 'online', count: 2 });
  assert.equal(h.render(useTeamPresence, team).presence.count, 2); h.effects();
  assert.equal(calls.length, 1);
  assert.equal(h.render(useTeamPresence, otherTeam).presence, null); h.effects();
  assert.equal(calls[0].disposed, true);
  assert.equal(calls.length, 2);
  assert.equal(h.render(useTeamPresence, undefined).presence, null); h.effects();
  assert.equal(calls[1].disposed, true);
  h.unmount();
});

test('admin roster opens with live member IDs and disappears immediately after demotion or disconnect', async () => {
  const h = hooks();
  const { TeamPresenceIndicator } = load('features/teams/TeamPresenceIndicator.tsx', {
    react: h.react, '../../components/Modal': { Modal: () => null }, './api': { listTeamMembers: async () => [] },
  });
  const presence = { teamId: team, phase: 'online', count: 2, userIds: [alice, bob] };
  let tree = h.render(TeamPresenceIndicator, { presence }); h.effects();
  tree.props.children[0].props.onClick();
  tree = h.render(TeamPresenceIndicator, { presence }); h.effects();
  assert.deepEqual(tree.props.children[1].props.userIds, [alice, bob]);
  tree = h.render(TeamPresenceIndicator, { presence: { ...presence, count: 1, userIds: [alice] } }); h.effects();
  assert.deepEqual(tree.props.children[1].props.userIds, [alice]);
  tree = h.render(TeamPresenceIndicator, { presence: { teamId: team, phase: 'online', count: 1 } });
  assert.equal(tree.props.children[1], false);
  assert.equal(tree.props.children[0].type, 'span'); h.effects();
  tree = h.render(TeamPresenceIndicator, { presence }); h.effects();
  assert.equal(tree.props.children[1], false, 'promotion does not reopen a discarded roster');
  tree.props.children[0].props.onClick();
  tree = h.render(TeamPresenceIndicator, { presence: { teamId: team, phase: 'offline', count: null } });
  assert.equal(tree.props.children[1], false);
  assert.ok(renderToStaticMarkup(tree).includes('Offline')); h.effects(); h.unmount();
});

test('offline indicator exposes the failure reason and offers explicit retry', () => {
  const h = hooks(); let retries = 0;
  const { TeamPresenceIndicator } = load('features/teams/TeamPresenceIndicator.tsx', {
    react: h.react, '../../components/Modal': { Modal: () => null }, './api': { listTeamMembers: async () => [] },
  });
  const tree = h.render(TeamPresenceIndicator, {
    presence: { teamId: team, phase: 'offline', count: null, message: 'Unable to refresh your session.' },
    onRetry: () => { retries++; },
  }); h.effects();
  const button = tree.props.children[0];
  assert.equal(button.props['aria-label'], 'Retry team presence');
  assert.match(button.props.title, /Unable to refresh your session/);
  button.props.onClick(); assert.equal(retries, 1);
  h.unmount();
});

test('roster resolves only online IDs, escapes names, and shows fetch errors', async () => {
  const parent = hooks(), modal = props => React.createElement('section', null, props.children);
  let reject = false, requests = 0;
  const child = hooks();
  const { TeamPresenceIndicator } = load('features/teams/TeamPresenceIndicator.tsx', {
    react: { ...parent.react, useState: (...args) => (renderingChild ? child.react : parent.react).useState(...args),
      useEffect: (...args) => (renderingChild ? child.react : parent.react).useEffect(...args) },
    '../../components/Modal': { Modal: modal }, './api': { listTeamMembers: async id => {
      requests++; assert.equal(id, team); if (reject) throw new Error('offline');
      return [{ userId: alice, fullName: '<Alice>', username: 'alice', role: 'ADMIN' },
        { userId: bob, fullName: 'Offline Bob', username: 'bob', role: 'DEVELOPER' }];
    } },
  });
  let renderingChild = false;
  const presence = { teamId: team, phase: 'online', count: 1, userIds: [alice] };
  let tree = parent.render(TeamPresenceIndicator, { presence }); parent.effects();
  tree.props.children[0].props.onClick();
  tree = parent.render(TeamPresenceIndicator, { presence }); parent.effects();
  const roster = tree.props.children[1]; renderingChild = true;
  let view = child.render(roster.type, roster.props); child.effects();
  assert.ok(renderToStaticMarkup(view).includes('Loading members')); await settle();
  view = child.render(roster.type, roster.props); child.effects();
  const html = renderToStaticMarkup(view);
  assert.ok(html.includes('&lt;Alice&gt;')); assert.ok(!html.includes('Offline Bob'));
  assert.equal(requests, 1);
  reject = true;
  child.render(roster.type, { ...roster.props, userIds: [alice, bob] }); child.effects(); await settle();
  view = child.render(roster.type, { ...roster.props, userIds: [alice, bob] }); child.effects();
  assert.ok(renderToStaticMarkup(view).includes('Member details could not load'));
  child.unmount(); parent.unmount();
});
