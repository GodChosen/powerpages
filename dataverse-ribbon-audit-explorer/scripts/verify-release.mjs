import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { JSDOM } from 'jsdom';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const arg = process.argv.indexOf('--directory'),
  directory = arg < 0 ? path.join(root, 'releases') : path.resolve(process.argv[arg + 1]);
const dom = new JSDOM(''),
  parser = new dom.window.DOMParser(),
  xml = (text) => {
    const d = parser.parseFromString(text, 'application/xml');
    assert(!d.querySelector('parsererror'), 'Malformed release XML');
    return d;
  };
const digest = (x) => createHash('sha256').update(x).digest('hex');
const expected = ['app.js', 'commands.js', 'core.js', 'index.html', 'style.css', 'transport.js'];
const result = {
  version: pkg.version,
  solutionVersion: pkg.version + '.0',
  validation: 'Local package/source verification; no new-environment import is implied.',
  files: [],
};
try {
  for (const kind of ['unmanaged', 'managed']) {
    const name = `DataverseRibbonAuditExplorer_${pkg.version}_${kind}.zip`,
      buffer = await readFile(path.join(directory, name));
    assert(buffer.length < 5 * 1024 * 1024, 'Unexpectedly large solution package');
    const files = unzipSync(buffer);
    let total = 0;
    for (const [name, content] of Object.entries(files)) {
      assert(!name.includes('..') && !name.includes('\\'), 'Unsafe archive path');
      total += content.length;
      assert(
        !/https?:\/\/[^/\s"\x27]+\.crm\d*\.dynamics\.com|[a-z0-9.-]+\.onmicrosoft\.com|[A-Z]:\\Users\\/i.test(
          new TextDecoder().decode(content),
        ),
        'Private deployment material in ' + name,
      );
    }
    assert(total < 10 * 1024 * 1024, 'Unexpected inflated size');
    const text = (n) => {
      assert(files[n], `Missing ${n}`);
      return new TextDecoder().decode(files[n]);
    };
    const manifest = xml(text('solution.xml'));
    assert.equal(
      manifest.querySelector('SolutionManifest > Version')?.textContent,
      pkg.version + '.0',
    );
    assert.equal(
      manifest.querySelector('SolutionManifest > Managed')?.textContent,
      kind === 'managed' ? '1' : '0',
    );
    assert.equal(manifest.querySelector('UniqueName')?.textContent, 'DataverseDependencyExplorer');
    assert.equal(manifest.querySelectorAll('RootComponents > RootComponent').length, 8);
    const content = text('customizations.xml'),
      custom = xml(content);
    assert(
      !custom.querySelector('AppModuleRoleMaps > Role'),
      'Environment app-role assignments must not ship',
    );
    assert(!content.includes('AppModule_Default_Icon'), 'External icon dependency must not ship');
    assert(
      !content.includes('settingdefinitionid.uniquename="AppChannel"'),
      'Environment channel setting must not ship',
    );
    const resources = [...custom.querySelectorAll('WebResources > WebResource')];
    assert.equal(resources.length, 6);
    const hashes = {};
    for (const resource of resources) {
      const logical = resource.querySelector('Name').textContent,
        file = logical.split('/').pop();
      assert(expected.includes(file));
      const zipName = resource.querySelector('FileName').textContent.replace(/^\//, '');
      assert(files[zipName], 'Missing packed resource ' + zipName);
      const source = await readFile(path.join(root, 'src', file));
      assert.equal(digest(files[zipName]), digest(source), `Source mismatch for ${file}`);
      hashes[file] = digest(source);
      if (file === 'index.html') {
        const deps = xml(resource.querySelector('DependencyXml').textContent);
        assert.equal(deps.querySelectorAll('Library').length, 5);
      }
    }
    result.files.push({
      name,
      bytes: buffer.length,
      sha256: digest(buffer),
      resourceSha256: hashes,
    });
  }
  await writeFile(path.join(directory, 'checksums.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(
    'Both release packages passed: version, managed flags, eight roots, six exact source hashes, five dependencies and portable app metadata.',
  );
} finally {
  dom.window.close();
}
