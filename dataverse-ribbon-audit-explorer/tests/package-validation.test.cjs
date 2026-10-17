const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  { spawnSync } = require('node:child_process'),
  { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate');
const root = path.resolve(__dirname, '..'),
  version = require('../package.json').version;
const artifacts = path.join(root, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const dir = fs.mkdtempSync(path.join(artifacts, 'manifest-regression-'));
for (const kind of ['unmanaged', 'managed']) {
  const name = `DataverseRibbonAuditExplorer_${version}_${kind}.zip`;
  fs.copyFileSync(path.join(root, 'releases', name), path.join(dir, name));
}
const name = `DataverseRibbonAuditExplorer_${version}_managed.zip`,
  file = path.join(dir, name),
  entries = unzipSync(fs.readFileSync(file));
const xml = strFromU8(entries['solution.xml']);
assert.match(xml, /<MissingDependencies\b/);
entries['solution.xml'] = strToU8(xml.replace(/<MissingDependencies\s*\/>/, ''));
fs.writeFileSync(file, zipSync(entries));
const result = spawnSync(
  process.execPath,
  [path.join(root, 'scripts/verify-release.mjs'), '--directory', dir],
  { cwd: root, encoding: 'utf8' },
);
assert.notEqual(result.status, 0, 'The invalid manifest must fail verification');
assert.match(result.stderr, /dependency container/);
console.log(
  'Manifest regression passed: omitting the required empty dependency container is rejected.',
);
