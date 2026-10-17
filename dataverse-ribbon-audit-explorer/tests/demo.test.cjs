const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { JSDOM } = require('jsdom');
(async () => {
  const { createDemoServer } = await import('../scripts/serve-demo.mjs');
  const server = createDemoServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const response = await fetch(base + '/');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /SYNTHETIC DEMO/);
    assert.match(response.headers.get('content-security-policy'), /connect-src 'none'/);
    assert.equal((await fetch(base + '/package.json')).status, 404);
    assert.equal((await fetch(base + '/src/%2e%2e%2fpackage.json')).status, 404);
    assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  const dom = new JSDOM(fs.readFileSync('demo/index.html', 'utf8'), {
      runScripts: 'outside-only',
      url: 'http://127.0.0.1:4175/demo/index.html',
    }),
    w = dom.window;
  w.AbortController = AbortController;
  try {
    w.eval(fs.readFileSync('demo/fixture-transport.js', 'utf8'));
    for (const f of ['core', 'transport', 'commands', 'app'])
      w.eval(fs.readFileSync('src/' + f + '.js', 'utf8'));
    await w.document.getElementById('scan').onclick();
    assert.match(w.document.getElementById('status').textContent, /Collected/);
    assert.equal(w.document.getElementById('notelist').textContent, '');
    const text = w.document.getElementById('list').textContent;
    for (const finding of [
      'Unmanaged override',
      'Unmanaged creation candidate',
      'Unmanaged hide action',
      'Affected by unmanaged command/rule',
      'Unmanaged layer over managed component',
      'Unmanaged ribbon parent',
    ])
      assert(text.includes(finding), finding);
    assert.match(text, /Target control: demo.global.control/);
    assert.match(text, /Field: demo_request.statuscode/);
    await assert.rejects(() => w.fetch('https://unexpected.example.test/'), /does not connect/);
    assert(!fs.readFileSync('src/index.html', 'utf8').includes('fixture-transport'));
    console.log('Synthetic demo and loopback server passed.');
  } finally {
    dom.window.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
