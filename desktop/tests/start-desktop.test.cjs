const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');
const { launchPlan, start } = require('../scripts/start-desktop.cjs');

test('normal startup preserves the normal profile and forwards Tauri flags', () => {
  assert.equal(launchPlan([]).length, 1);
  assert.deepEqual(launchPlan(['one']), launchPlan([]));
  assert.equal(launchPlan(['--release'])[0].args.at(-1), '--release');
  assert.throws(() => launchPlan(['three']), /npm start -- two/);
});

test('two apps share a frontend but isolate browser sessions, native data, and build output', () => {
  const [frontend, ...apps] = launchPlan(['two']);
  assert.match(frontend.args[0], /vite/);
  const configs = apps.map((app) => JSON.parse(app.args.at(-1)));
  assert.equal(apps.length, 2);
  assert.notEqual(configs[0].identifier, configs[1].identifier);
  assert.notEqual(apps[0].env.CARGO_TARGET_DIR, apps[1].env.CARGO_TARGET_DIR);
  for (const config of configs) {
    assert.equal(config.build.beforeDevCommand, '');
    assert.equal(config.app.windows[0].incognito, true);
    assert.equal(config.app.windows[0].width, 940);
  }
  assert.deepEqual(launchPlan(['2']), launchPlan(['two']));
});

test('a failed child stops the entire development process group', (t) => {
  const children = [];
  const stopped = [];
  const previousExitCode = process.exitCode;
  t.after(() => { process.exitCode = previousExitCode; });
  t.mock.method(childProcess, 'spawn', () => {
    const child = new EventEmitter();
    child.pid = 1000 + children.length;
    children.push(child);
    return child;
  });
  t.mock.method(process, 'kill', (pid, signal) => stopped.push([pid, signal]));
  t.mock.method(childProcess, 'spawnSync', (_command, args) => stopped.push(args));
  const listeners = process.listenerCount('SIGINT');
  start(launchPlan(['two']));
  children[0].emit('exit', 1, null);
  assert.equal(process.exitCode, 1);
  assert.equal(stopped.length, 3);
  assert.equal(process.listenerCount('SIGINT'), listeners);
  if (process.platform !== 'win32') {
    assert.deepEqual(stopped, [[-1000, 'SIGTERM'], [-1001, 'SIGTERM'], [-1002, 'SIGTERM']]);
  }
  children[1].emit('exit', null, 'SIGTERM');
  assert.equal(stopped.length, 3);
});
