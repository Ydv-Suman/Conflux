const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
class ApiError extends Error {}
const token = (name) => `header.${Buffer.from(JSON.stringify({ sub: 'user-one', username: name })).toString('base64url')}.signature`;
let refreshes = 0;
const apiPath = path.resolve(__dirname, '../src/api.ts');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: {
  ApiError, request() {},
  async post(route) {
    if (route === '/api/auth/login') return { accessToken: token('old') };
    if (route === '/api/auth/refresh') { refreshes++; return { accessToken: token('new') }; }
  },
} };
const session = require('../src/features/auth/session.ts');

test('multiple document connections reuse a refresh and never resend an already rejected token', async () => {
  await session.login('user', 'password');
  assert.equal(await session.getCollaborationToken(), token('old'));
  const replacements = await Promise.all([
    session.getCollaborationToken(token('old')), session.getCollaborationToken(token('old')),
  ]);
  assert.deepEqual(replacements, [token('new'), token('new')]);
  assert.equal(refreshes, 1);
  assert.equal(await session.getCollaborationToken(token('old')), token('new'));
  assert.equal(refreshes, 1, 'A slower tab reuses the token already refreshed by another tab');
});
