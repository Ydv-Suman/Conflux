const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function harness(onChange, files = [{ path: 'main.ts', name: 'main.ts', directory: false, children: [] }]) {
  const slots = []; let cursor = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useId: () => 'files',
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useEffect() {},
  };
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/features/repository/RepositoryExplorer.tsx'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('require', 'module', 'exports', code + '\nmodule.exports.InlineName = InlineName;')(name => {
    if (name === 'react') return react;
    if (name === 'react-dom') return { createPortal: node => node };
    if (name === '../../components/Modal') return { Modal: ({ children, onClose }) => require('react').createElement('section', { role: 'dialog', onClose }, children) };
    if (name === '../teams/CollaboratorBadges') return { CollaboratorBadges: () => null };
    if (name === './MaterialIcon') return { MaterialIcon: () => null };
    return require(name);
  }, module, module.exports);
  return (inlineProps) => {
    cursor = 0;
    if (inlineProps) return module.exports.InlineName(inlineProps);
    return module.exports.RepositoryExplorer({
      repository: { name: 'project', files },
      onChange, onOpen() {}, onConnect() {}, onChooseWorkstream() {},
    });
  };
}

function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (node.type?.name === 'InlineName') return [node];
  if (typeof node.type === 'function') return nodes(node.type(node.props));
  return [node, ...nodes(node.props?.children)];
}


global.document = { body: {} };
const file = { path: 'src/main.ts', name: 'main.ts', directory: false, children: [] };
const files = [{ path: 'src', name: 'src', directory: true, children: [file] }];
const settle = () => new Promise(setImmediate);
function choose(render, target, action) {
  const all = () => nodes(render());
  all().find(node => node.props.title === target).props.onContextMenu({ preventDefault() {}, stopPropagation() {} });
  const menu = all().find(node => node.props['aria-label'] === `Actions for ${target}`);
  let prevented = false;
  menu.props.onMouseDown?.({ preventDefault() { prevented = true; } });
  if (!prevented) menu.props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null });
  const button = all().find(node => node.type === 'button' && node.props.children === action);
  assert.ok(button, 'The menu must stay mounted until the click is delivered');
  button.props.onClick();
}

for (const target of ['src', 'src/main.ts']) {
  test(`Rename edits the name of ${target} in its row and preserves the parent`, async () => {
    const commands = [];
    const render = harness(async command => { commands.push(command); }, files);
    choose(render, target, 'Rename');
    const all = nodes(render());
    assert.ok(!all.some(node => node.type === 'form' || node.props.role === 'dialog'));
    const row = all.find(node => node.type === 'li' && node.key === target);
    const input = nodes(row).find(node => node.type?.name === 'InlineName');
    assert.equal(input.props.initialName, target.split('/').pop());
    input.props.onCommit('renamed');
    await settle();
    assert.equal(commands.length, 1);
    assert.equal(commands[0].type, 'RENAME');
    assert.equal(commands[0].path, target);
    assert.equal(commands[0].targetPath, target === 'src' ? 'renamed' : 'src/renamed');
    assert.ok(!nodes(render()).some(node => node.type?.name === 'InlineName'));
  });

  test(`Delete ${target} requires popup confirmation and preserves errors`, async () => {
    let calls = 0;
    const render = harness(async () => { calls++; throw new Error('Save affected tabs first.'); }, files);
    choose(render, target, 'Delete');
    assert.equal(calls, 0);
    const dialog = nodes(render()).find(node => node.props.role === 'dialog');
    assert.ok(dialog);
    assert.ok(!nodes(nodes(render()).find(node => node.type === 'li' && node.key === target)).some(node => node.type === 'form'));
    const buttons = nodes(dialog).filter(node => node.type === 'button');
    assert.equal(buttons[0].props.children, 'Cancel');
    nodes(dialog).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    await settle();
    assert.equal(calls, 1);
    assert.ok(nodes(render()).some(node => node.props.role === 'alert' && node.props.children === 'Save affected tabs first.'));
    nodes(render()).find(node => node.type === 'button' && node.props.children === 'Cancel').props.onClick();
    assert.ok(!nodes(render()).some(node => node.props.role === 'dialog'));
  });
}

test('deletion only submits after confirmation and closes after success', async () => {
  const commands = [];
  const render = harness(async command => { commands.push(command); });
  choose(render, 'main.ts', 'Delete');
  nodes(render()).find(node => node.props.role === 'dialog').props.onClose();
  assert.equal(commands.length, 0);
  choose(render, 'main.ts', 'Delete');
  nodes(render()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  await settle();
  assert.equal(commands[0].type, 'DELETE'); assert.equal(commands[0].path, 'main.ts');
  assert.ok(!nodes(render()).some(node => node.props.role === 'dialog'));
});

test('unchanged names, cancelled renames, and path separators do not submit changes', () => {
  const commands = [];
  const render = harness(async command => { commands.push(command); }, files);
  for (const name of ['main.ts', '../other.ts', 'nested/file.ts', 'nested\\file.ts', '.', '..']) {
    choose(render, 'src/main.ts', 'Rename');
    nodes(render()).find(node => node.type?.name === 'InlineName').props.onCommit(name);
  }
  choose(render, 'src/main.ts', 'Rename');
  nodes(render()).find(node => node.type?.name === 'InlineName').props.onCancel();
  assert.equal(commands.length, 0);
});

test('inline names commit once on Enter and blur, select on focus, and cancel on Escape', () => {
  for (const key of ['Enter', 'Escape']) {
    const render = harness(async () => {});
    const committed = []; let cancelled = 0, selected = false;
    const props = { kind: 'FILE', initialName: 'main.ts', onCommit: name => committed.push(name), onCancel: () => { cancelled++; } };
    const input = nodes(render(props)).find(node => node.type === 'input');
    input.props.ref.current = { value: 'renamed.ts' };
    input.props.onFocus({ currentTarget: { select() { selected = true; } } });
    input.props.onKeyDown({ key, nativeEvent: {}, preventDefault() {}, stopPropagation() {} });
    input.props.onBlur();
    assert.equal(selected, true);
    assert.deepEqual(committed, key === 'Enter' ? ['renamed.ts'] : []);
    assert.equal(cancelled, key === 'Escape' ? 1 : 0);
  }
});

test('keyboard context actions work and focus outside still closes the menu', () => {
  const render = harness(async () => {});
  const all = () => nodes(render());
  const open = () => all().find(node => node.props.title === 'main.ts').props.onKeyDown({ key: 'ContextMenu', preventDefault() {} });
  open();
  all().find(node => node.props['aria-label'] === 'Actions for main.ts').props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null });
  assert.ok(!all().some(node => node.props['aria-label'] === 'Actions for main.ts'));
  open();
  all().find(node => node.type === 'button' && node.props.children === 'Rename').props.onClick();
  assert.ok(all().some(node => node.type?.name === 'InlineName'));
});
