const childProcess = require('node:child_process');
const path = require('node:path');
const config = require('../src-tauri/tauri.conf.json');

const desktop = path.resolve(__dirname, '..');
const tauri = require.resolve('@tauri-apps/cli/tauri.js');

function launchPlan(args) {
  if (args[0] !== 'two' && args[0] !== '2') {
    if (args[0] === 'one' || args[0] === '1') args = args.slice(1);
    if (args[0] && !args[0].startsWith('-')) {
      throw new Error('Use npm start for one app, or npm start -- two for two apps.');
    }
    return [{ args: [tauri, 'dev', ...args] }];
  }

  const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  return [
    { args: [vite] },
    ...[1, 2].map((instance) => ({
      args: [tauri, 'dev', ...args.slice(1), '--config', JSON.stringify({
        identifier: `${config.identifier}.dev${instance}`,
        build: { beforeDevCommand: '' },
        app: { windows: config.app.windows.map((window) => ({
          ...window,
          title: `${window.title} — Test ${instance}`,
          incognito: true,
        })) },
      })],
      env: { CARGO_TARGET_DIR: path.join(desktop, 'src-tauri/target', `dev${instance}`) },
    })),
  ];
}

function start(plan) {
  const children = [];
  let stopping = false;

  function stop(code) {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children) {
      if (!child.pid) continue;
      if (process.platform === 'win32') {
        childProcess.spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    }
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  }

  const onInterrupt = () => stop(130);
  const onTerminate = () => stop(143);
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);

  for (const launch of plan) {
    const child = childProcess.spawn(process.execPath, launch.args, {
      cwd: desktop,
      env: { ...process.env, ...launch.env },
      stdio: 'inherit',
      detached: process.platform !== 'win32',
    });
    children.push(child);
    child.once('error', (error) => { console.error(error.message); stop(1); });
    child.once('exit', (code, signal) => stop(code ?? (signal ? 1 : 0)));
  }
}

if (require.main === module) {
  try { start(launchPlan(process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { launchPlan, start };
