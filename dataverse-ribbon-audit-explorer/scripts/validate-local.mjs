import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const receipt = path.join(root, 'evidence/local-validation.txt');
if (!process.env.npm_execpath) throw Error('Run through npm run validate.');
await writeFile(
  receipt,
  `Local validation for ${pkg.name} ${pkg.version}\nNode ${process.version}; platform ${process.platform}\nThis is local validation, not a Dataverse import or independent review.\n`,
);
for (const task of ['check', 'test', 'test:demo', 'docs:check', 'release:verify', 'format:check']) {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', task], {
    cwd: root,
    encoding: 'utf8',
  });
  const output = `\n$ npm run ${task}\n${result.stdout || ''}${result.stderr || ''}`;
  await appendFile(receipt, output);
  process.stdout.write(output);
  if (result.status !== 0) throw Error('Validation failed: ' + task);
}
await appendFile(receipt, '\nAll local validation commands passed.\n');
