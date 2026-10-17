import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'artifacts'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    out.push(...(e.isDirectory() ? await walk(p) : [p]));
  }
  return out;
}
const files = await walk(root),
  set = new Set(files.map((p) => path.resolve(p)));
let count = 0;
const errors = [];
for (const f of files.filter((p) => p.endsWith('.md'))) {
  const text = await readFile(f, 'utf8');
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    let link = match[1].replace(/^<|>$/g, '');
    if (/^(https?:|mailto:|#)/.test(link)) continue;
    link = decodeURIComponent(link.split('#')[0]);
    if (!link) continue;
    const target = path.resolve(path.dirname(f), link);
    count++;
    if (!set.has(target)) errors.push(path.relative(root, f) + ': ' + link);
  }
}
if (errors.length) throw Error('Broken local documentation links:\n' + errors.join('\n'));
console.log(`Documentation links passed (${count} local links).`);
