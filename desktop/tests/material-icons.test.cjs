const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const { materialIconPath: icon } = require('../src/features/repository/materialIcons.ts');
const manifest = require('../src/features/repository/material-icons.generated.json');

test('recognizes languages, special filenames, dotfiles and case-insensitive names', () => {
  for (const [name, expected] of [['Main.java', 'java'], ['lib.rs', 'rust'], ['app.tsx', 'react_ts'], ['main.py', 'python'], ['package.json', 'nodejs'], ['Dockerfile', 'docker'], ['README.md', 'readme'], ['.gitignore', 'git']]) {
    assert.equal(icon(name), `/material-icons/${expected}.svg`, name);
  }
  assert.equal(icon('SRC/APP.TSX'), icon('app.tsx'));
});

test('specific names and compound extensions win over general extensions', () => {
  assert.notEqual(icon('package.json'), icon('data.json'));
  assert.equal(icon('types.d.ts'), `/material-icons/${manifest.iconDefinitions[manifest.fileExtensions['d.ts']].iconPath}`);
  assert.notEqual(icon('types.d.ts'), icon('types.ts'));
});

test('folders support semantic names, expanded states, roots and generic fallbacks', () => {
  for (const name of ['src', 'tests', 'assets', 'components']) {
    assert.notEqual(icon(name, true), icon('unknown-folder', true));
    assert.notEqual(icon(name, true), icon(name, true, true));
  }
  assert.equal(icon('unknown-file.xyzabc'), '/material-icons/file.svg');
  assert.equal(icon('__proto__'), '/material-icons/file.svg');
  assert.equal(icon('unknown-folder', true), '/material-icons/folder.svg');
  assert.equal(icon('project', true, false, false, true), '/material-icons/folder-root.svg');
});

test('light variants and every mapped asset are bundled locally with the license', () => {
  assert.notEqual(icon('config.toml', false, false, false), icon('config.toml', false, false, true));
  for (const definition of Object.values(manifest.iconDefinitions)) {
    assert.match(definition.iconPath, /^[\w.-]+\.svg$/);
    assert.ok(fs.existsSync(path.join(__dirname, '../public/material-icons', definition.iconPath)), definition.iconPath);
  }
  assert.match(fs.readFileSync(path.join(__dirname, '../public/material-icons/LICENSE.txt'), 'utf8'), /MIT License/);
});
