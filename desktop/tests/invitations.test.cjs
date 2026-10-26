const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');

// Load the TypeScript components with the installed compiler; no test dependency is needed.
const originalTs = require.extensions['.ts'];
const originalTsx = require.extensions['.tsx'];
const compile = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
require.extensions['.ts'] = compile;
require.extensions['.tsx'] = compile;
const calls = [];
const sessionPath = path.resolve(__dirname, '../src/features/auth/session.ts');
require.cache[sessionPath] = {
  id: sessionPath, filename: sessionPath, loaded: true,
  exports: {
    authenticatedPost: async (...args) => { calls.push(['POST', ...args]); return {}; },
    authenticatedRequest: async (...args) => { calls.push(['REQUEST', ...args]); return []; },
  },
};
const api = require('../src/features/teams/api.ts');
const { InvitationInbox } = require('../src/features/invitations/Invitations.tsx');
require.extensions['.ts'] = originalTs;
require.extensions['.tsx'] = originalTsx;

const invitation = {
  invitationId: 'invitation-1', teamId: 'team-1', teamName: '<Payments>',
  inviterUsername: 'alice', proposedRole: 'SENIOR_DEVELOPER', expiresAt: '2099-01-01T00:00:00Z',
};
const inbox = (overrides = {}) => ({
  items: [invitation], visibleCount: 10, loadMore: () => {}, loading: false, error: null, pendingId: null, feedback: null,
  refresh: async () => {}, respond: async () => true, ...overrides,
});
const render = (data) => renderToStaticMarkup(InvitationInbox({ inbox: data, onAccepted: async () => {} }));
const button = (element, label) => {
  if (!element || typeof element !== 'object') return null;
  if (element.type === 'button' && element.props['aria-label'] === label) return element;
  for (const child of [element.props?.children].flat(Infinity)) {
    const match = button(child, label);
    if (match) return match;
  }
  return null;
};

test('inviting uses the invitation endpoint and response actions never target members directly', async () => {
  calls.length = 0;
  await api.inviteTeamMember('team-1', 'target@example.com', 'DEVELOPER');
  await api.listMyInvitations();
  await api.respondToInvitation('invitation-1', true);
  await api.respondToInvitation('invitation-1', false);
  await api.cancelTeamInvitation('team-1', 'invitation-1');
  assert.deepEqual(calls, [
    ['POST', '/api/teams/team-1/invitations', { email: 'target@example.com', role: 'DEVELOPER' }],
    ['REQUEST', '/api/users/me/invitations', 'GET'],
    ['POST', '/api/invitations/invitation-1/accept'],
    ['POST', '/api/invitations/invitation-1/decline'],
    ['REQUEST', '/api/teams/team-1/invitations/invitation-1', 'DELETE'],
  ]);
});

test('invitation content escapes team names and displays inviter, role, and both actions', () => {
  const html = render(inbox());
  assert.ok(html.includes('&lt;Payments&gt;'));
  assert.ok(html.includes('@alice invited you as a senior developer.'));
  assert.ok(html.includes('Accept invitation to'));
  assert.ok(html.includes('Decline invitation to'));
});

test('loading, empty, and error states are distinct', () => {
  assert.ok(render(inbox({ items: [], loading: true })).includes('Loading invitations'));
  assert.ok(render(inbox({ items: [] })).includes('No pending invitations'));
  const failure = render(inbox({ items: [], error: 'Service unavailable' }));
  assert.ok(failure.includes('role="alert"'));
  assert.ok(failure.includes('Service unavailable'));
  assert.ok(!failure.includes('No pending invitations'));
});

test('access refresh happens only after successful acceptance', async () => {
  for (const accepted of [true, false]) {
    let refreshed = 0;
    const responses = [];
    const element = InvitationInbox({
      inbox: inbox({ respond: async (item, accept) => { responses.push([item.invitationId, accept]); return accepted; } }),
      onAccepted: async (received) => { assert.equal(received, invitation); refreshed++; },
    });
    button(element, 'Accept invitation to <Payments>').props.onClick();
    await new Promise(setImmediate);
    assert.deepEqual(responses, [['invitation-1', true]]);
    assert.equal(refreshed, accepted ? 1 : 0);
  }
});

test('declining never refreshes team access', async () => {
  let refreshed = false;
  let response;
  const element = InvitationInbox({
    inbox: inbox({ respond: async (item, accept) => { response = [item.invitationId, accept]; return true; } }),
    onAccepted: async () => { refreshed = true; },
  });
  button(element, 'Decline invitation to <Payments>').props.onClick();
  await new Promise(setImmediate);
  assert.deepEqual(response, ['invitation-1', false]);
  assert.equal(refreshed, false);
});

test('actions are disabled while an invitation response is pending', () => {
  const element = InvitationInbox({ inbox: inbox({ pendingId: invitation.invitationId }), onAccepted: async () => {} });
  assert.equal(button(element, 'Accept invitation to <Payments>').props.disabled, true);
  assert.equal(button(element, 'Decline invitation to <Payments>').props.disabled, true);
});


test('only the latest ten invitations render, with load more only when needed', () => {
  const items = Array.from({ length: 21 }, (_, index) => ({
    ...invitation, invitationId: `invitation-${index}`, teamName: `Team ${index}`,
  }));
  const first = render(inbox({ items }));
  assert.equal((first.match(/class="invitation-card"/g) || []).length, 10);
  assert.ok(first.includes('Load more'));
  assert.ok(!first.includes('Accept an invitation to join a team'));
  const next = render(inbox({ items, visibleCount: 20 }));
  assert.equal((next.match(/class="invitation-card"/g) || []).length, 20);
  assert.ok(next.includes('Load more'));
  const all = render(inbox({ items, visibleCount: 30 }));
  assert.equal((all.match(/class="invitation-card"/g) || []).length, 21);
  assert.ok(!all.includes('Load more'));
  assert.ok(!render(inbox({ items: items.slice(0, 10) })).includes('Load more'));
});
