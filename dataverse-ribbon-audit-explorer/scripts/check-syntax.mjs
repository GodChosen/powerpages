import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function walk(dir) {
  for (const f of await readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, f.name);
    if (f.isDirectory()) await walk(target);
    else if (/\.(js|mjs|cjs)$/.test(f.name)) {
      const result = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
      if (result.status !== 0) throw Error(result.stderr || 'Syntax check failed: ' + f.name);
    }
  }
}
for (const dir of ['src', 'scripts', 'demo', 'tests']) await walk(path.join(root, dir));
console.log('JavaScript syntax passed for runtime, demo, scripts and tests.');
