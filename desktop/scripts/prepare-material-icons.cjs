const fs = require('node:fs');
const path = require('node:path');
const { generateManifest } = require('material-icon-theme');

const root = path.resolve(__dirname, '..');
const source = path.dirname(require.resolve('material-icon-theme/package.json'));
const output = path.join(root, 'public/material-icons');
const manifestPath = path.join(root, 'src/features/repository/material-icons.generated.json');
// Framework-neutral defaults: generic folder names should not imply Angular.
const manifest = generateManifest({ activeIconPack: 'none' });
fs.mkdirSync(output, { recursive: true });
for (const definition of Object.values(manifest.iconDefinitions)) {
  const filename = path.basename(definition.iconPath);
  if (!/^[\w.-]+\.svg$/.test(filename)) throw new Error(`Invalid icon filename: ${filename}`);
  fs.copyFileSync(path.join(source, 'icons', filename), path.join(output, filename));
  definition.iconPath = filename;
}
fs.copyFileSync(path.join(source, 'LICENSE'), path.join(output, 'LICENSE.txt'));
const json = JSON.stringify(manifest);
// Avoid triggering a Vite reload when dev startup regenerates unchanged mappings.
if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, 'utf8') !== json) fs.writeFileSync(manifestPath, json);
console.log(`Prepared ${Object.keys(manifest.iconDefinitions).length} local Material icons.`);
