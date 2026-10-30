const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const previousTsx = require.extensions['.tsx'];
require.extensions['.tsx'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText, filename);
const { ProjectNavigation } = require('../src/features/projects/ProjectNavigation.tsx');
require.extensions['.tsx'] = previousTsx;

function findTeamButton(element) {
  if (!element || typeof element !== 'object') return null;
  if (element.type === 'button' && element.props.className.includes('project-team-switch')) return element;
  for (const child of [element.props?.children].flat(Infinity)) {
    const match = findTeamButton(child);
    if (match) return match;
  }
  return null;
}

for (const openShared of [true, false]) {
  test(`team selection ${openShared ? 'from Explorer opens work' : 'from team navigation opens details'}, including the current team`, () => {
    const calls = [];
    const element = ProjectNavigation({
      projects: [{ projectId: 'project', name: 'Project' }], project: { projectId: 'project' },
      projectTeams: [{ teamId: 'team', name: 'Team' }], team: { teamId: 'team' },
      openShared, disabled: false, onSelect: async (...args) => calls.push(args),
      onCreate() {}, onClose() {},
    });
    findTeamButton(element).props.onClick();
    assert.deepEqual(calls, [['project', 'team', openShared]]);
  });
}
