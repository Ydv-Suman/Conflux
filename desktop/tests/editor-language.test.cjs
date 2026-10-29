const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { languageForPath } = require('../src/features/editor/editorLanguage.ts');

const languages = [
  { id: 'python', extensions: ['.py', '.pyw'] },
  { id: 'java', extensions: ['.java'] },
  { id: 'typescript', extensions: ['.ts', '.tsx'] },
  { id: 'javascript', extensions: ['.js', '.jsx'] },
  { id: 'rust', extensions: ['.rs'] },
  { id: 'dockerfile', filenames: ['Dockerfile'] },
  { id: 'special', extensions: ['.special.ts'], filenames: ['special.py'] },
];

test('detects languages across paths and falls back for unknown files', () => {
  for (const [path, expected] of [
    ['src/main.py', 'python'], ['Main.JAVA', 'java'], ['C:\\src\\app.tsx', 'typescript'],
    ['app.jsx', 'javascript'], ['lib.rs', 'rust'], ['build/Dockerfile', 'dockerfile'],
    ['notes.unknown', 'plaintext'], ['python', 'plaintext'], ['folder.py/README', 'plaintext'],
  ]) assert.equal(languageForPath(path, languages), expected, path);
});

test('exact filenames and longest extensions take precedence', () => {
  assert.equal(languageForPath('special.py', languages), 'special');
  assert.equal(languageForPath('component.special.ts', languages), 'special');
  assert.equal(languageForPath('component.ts', languages), 'typescript');
});
