// Runs the production desktop transport against the packaged Java relay. Identity/Workspace are fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const ts = require('typescript');
const Y = require('yjs');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { connectDocument, documentIdForPath } = require('../src/features/editor/documentConnection.ts');
const jar = path.resolve(process.env.COLLABORATION_JAR || path.join(__dirname, '../../services/collaboration-service/target/collaboration-service-0.0.1-SNAPSHOT.jar'));
if (!fs.existsSync(jar)) throw new Error('Package Collaboration Service first with ./mvnw package, or set COLLABORATION_JAR.');
const project = '00000000-0000-4000-8000-000000000001';
const team = '00000000-0000-4000-8000-000000000002';
const stream = '00000000-0000-4000-8000-000000000003';
const actors = { alice: '00000000-0000-4000-8000-000000000004', bob: '00000000-0000-4000-8000-000000000005' };
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'conflux-live-'));
const docs = [], connections = [];
let backend, port = 0, logs = '', revoked = false;
const services = http.createServer((request, response) => {
  const actor = request.headers.authorization?.replace('Bearer ', '');
  response.setHeader('Content-Type', 'application/json');
  if (!actors[actor]) { response.writeHead(401); response.end('{}'); return; }
  if (revoked && actor === 'bob') { response.writeHead(403); response.end('{}'); return; }
  if (request.url === `/api/teams/${team}/capabilities/me`) {
    response.end(JSON.stringify({ teamId: team, userId: actors[actor], capabilities: ['JOIN_WORKSTREAM', 'EDIT_DOCUMENT'] }));
  } else if (request.url === `/api/projects/${project}/teams/${team}/workstreams/${stream}`) {
    response.end(JSON.stringify({ projectId: project, teamId: team, workstreamId: stream, repositoryReady: true, status: 'ACTIVE' }));
  } else { response.writeHead(404); response.end('{}'); }
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (!condition()) { if (Date.now() > end) throw new Error(message); await delay(20); }
}
async function start() {
  let started = false;
  logs = '';
  backend = spawn('java', ['-jar', jar, `--server.port=${port}`], { env: {
    ...process.env, IDENTITY_API_URL: `http://127.0.0.1:${services.address().port}`,
    WORKSPACE_API_URL: `http://127.0.0.1:${services.address().port}`, COLLABORATION_DATA_DIR: temporary,
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let failure;
  backend.on('error', (error) => { failure = error; });
  const output = (chunk) => {
    logs = (logs + chunk).slice(-64000);
    const match = logs.match(/Netty started on port (\d+)/);
    if (match) { port = Number(match[1]); started = true; }
  };
  backend.stdout.on('data', output); backend.stderr.on('data', output);
  await until(() => {
    if (failure) throw failure;
    if (backend.exitCode !== null) throw new Error(`Relay exited during startup: ${logs}`);
    return started;
  }, `Relay did not start: ${logs}`, 30000);
}
async function stop() {
  if (!backend || backend.exitCode !== null) return;
  const exited = once(backend, 'exit');
  const processToStop = backend;
  const timeout = setTimeout(() => processToStop.kill('SIGKILL'), 6000);
  backend.kill('SIGTERM');
  try { await exited; } finally { clearTimeout(timeout); }
}
function peer(name, initialContent = 'base') {
  const doc = new Y.Doc(); docs.push(doc);
  const peer = { doc, text: doc.getText('content'), state: undefined };
  const endpoint = `ws://127.0.0.1:${port}/ws/projects/${project}/workstreams/${stream}/documents/${documentIdForPath('src/main.ts')}`;
  const connection = connectDocument({ doc, endpoint, teamId: team, initialContent,
    getToken: async () => name, onState: (state) => { peer.state = state; } });
  connections.push(connection);
  return peer;
}
(async () => {
  try {
    services.listen(0, '127.0.0.1'); await once(services, 'listening');
    await start();
    const alice = peer('alice'), bob = peer('bob');
    await until(() => alice.state.phase === 'connected' && bob.state.phase === 'connected', 'Initial synchronization failed');
    assert.equal(alice.text.toString(), 'base'); assert.equal(bob.text.toString(), 'base');
    alice.text.insert(0, 'Alice:'); bob.text.insert(0, 'Bob:');
    await until(() => alice.text.toString() === bob.text.toString(), 'Concurrent edits did not converge');
    assert.ok(alice.text.toString().includes('Alice:')); assert.ok(alice.text.toString().includes('Bob:'));
    await stop();
    await until(() => alice.state.phase === 'reconnecting' && bob.state.phase === 'reconnecting', 'Disconnect was not detected');
    alice.text.insert(alice.text.length, ':offline-A'); bob.text.insert(bob.text.length, ':offline-B');
    assert.equal(alice.state.pending, true); assert.equal(bob.state.pending, true);
    await start();
    await until(() => alice.state.phase === 'connected' && bob.state.phase === 'connected'
      && alice.text.toString() === bob.text.toString(), 'Restart recovery did not converge');
    assert.ok(alice.text.toString().includes(':offline-A')); assert.ok(alice.text.toString().includes(':offline-B'));
    const history = await fetch(`http://127.0.0.1:${port}/api/projects/${project}/teams/${team}/workstreams/${stream}/documents/${documentIdForPath('src/main.ts')}/activity`, {
      headers: { Authorization: 'Bearer alice' },
    }).then((response) => { assert.equal(response.status, 200); return response.json(); });
    assert.ok(history.items.some((entry) => entry.actorId === actors.alice));
    assert.ok(history.items.some((entry) => entry.actorId === actors.bob));
    revoked = true;
    await until(() => bob.state.phase === 'denied', 'Revoked member was not disconnected');
    assert.ok(bob.text.toString().includes(':offline-B'));
    console.log('PASS: authenticated clients, simultaneous Yjs edits, restart/offline recovery, contributor records, and revocation.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    connections.forEach((connection) => connection.dispose()); docs.forEach((doc) => doc.destroy());
    await stop(); services.closeAllConnections(); await new Promise((resolve) => services.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})();
