const assert = require('node:assert/strict'),
  C = require('../src/core.js'),
  T = require('../src/transport.js'),
  Cmd = require('../src/commands.js');
(async () => {
  const provenance = {
    source: 'local fixture',
    originalVerified: true,
    originalPublisherId: 'customer',
    modifierPublisherIds: [],
    modificationCoverageComplete: true,
  };
  const publishers = {
    customer: { category: 'Customer' },
    ms: { category: 'Microsoft' },
    vendor: { category: 'Third-party' },
  };
  assert.equal(C.classify(provenance, publishers).originCategory, 'Customer-created');
  assert.equal(
    C.classify({ ...provenance, isManaged: true }, publishers).originCategory,
    'Customer-created',
  );
  assert.equal(
    C.classify({ ...provenance, originalPublisherId: 'ms' }, publishers).originCategory,
    'Microsoft standard',
  );
  assert.equal(
    C.classify(
      { ...provenance, originalPublisherId: 'vendor', modifierPublisherIds: ['customer'] },
      publishers,
    ).originCategory,
    'Third-party',
  );
  assert.equal(C.classify(null, publishers).originCategory, 'Unknown');
  assert.equal(
    C.classify(
      { ...provenance, originalPublisherId: 'ms', modifierPublisherIds: ['customer'] },
      publishers,
    ).originCategory,
    C.origins[2],
  );
  assert.equal(
    C.classify(
      { ...provenance, originalPublisherId: 'ms', modifierPublisherIds: ['vendor', 'customer'] },
      publishers,
    ).originCategory,
    'Unknown',
  );
  assert.equal(
    C.classify({ isManaged: true, isCustom: true }, publishers).originCategory,
    'Unknown',
  );
  assert.equal(
    C.classify(
      { ...provenance, originalPublisherId: 'ms', modificationCoverageComplete: false },
      publishers,
    ).originCategory,
    'Unknown',
  );
  const nodes = [
      { key: 'a', originCategory: 'Customer-created' },
      { key: 'b', originCategory: 'Microsoft standard' },
    ],
    edges = [{ from: 'a', to: 'b', reason: 'field', evidence: 'Explicit definition reference' }],
    before = JSON.stringify({ nodes, edges });
  for (const origin of C.origins) {
    nodes.filter((n) => C.matchesOrigin(n, origin));
    C.relations(edges, 'a', 'uses');
    assert.equal(JSON.stringify({ nodes, edges }), before);
  }
  assert.equal(C.relationshipExport(nodes, edges, [nodes[0]]).nodes.length, 2);
  assert.equal(C.dedupeEdges([...edges, ...edges, { ...edges[0], reason: 'sort' }]).length, 2);
  assert.match(C.csv([{ name: ' =HYPERLINK("bad")' }]), /"' =HYPERLINK/);
  let attempts = 0,
    waits = [];
  const client = T.client(
    'https://example.test',
    undefined,
    async () =>
      ++attempts < 3
        ? { ok: false, status: 429, headers: { get: () => '2' } }
        : { ok: true, json: async () => ({ value: [1] }) },
    async (ms) => waits.push(ms),
  );
  assert.deepEqual(await client.all('items'), [1]);
  assert.deepEqual(waits, [2000, 2000]);
  await assert.rejects(() => client.get('https://evil.test/api/data/v9.2/x'), /Rejected paging/);
  await assert.rejects(() => client.get('/outside'), /Rejected paging/);
  let calls = 0;
  const loop = T.client('https://example.test', undefined, async () => {
    calls++;
    return { ok: true, json: async () => ({ value: [], '@odata.nextLink': 'again' }) };
  });
  await assert.rejects(() => loop.all('again'), /Repeated paging/);
  assert.equal(calls, 1);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(() => T.client('https://example.test', cancelled.signal).get('items'), {
    name: 'AbortError',
  });
  assert.equal(
    T.retryDelay('Wed, 21 Oct 2026 07:28:00 GMT', 0, Date.parse('Wed, 21 Oct 2026 07:27:58 GMT')),
    2000,
  );
  const js = Cmd.modern(
    {
      appactionid: 'one',
      name: 'JS',
      location: 1,
      onclickeventtype: 2,
      _onclickeventjavascriptwebresourceid_value: 'lib',
      onclickeventjavascriptfunctionname: 'DoWork',
    },
    [],
  );
  assert(js.edges.some((e) => e.reason === 'JavaScript library'));
  assert.equal(js.placement.location, 'Main grid');
  assert(!js.edges.some((e) => /view:|form:/.test(e.to)));
  const globalCommand = Cmd.modern(
    { appactionid: 'global', name: 'All-table fixture', context: 0, onclickeventtype: 0 },
    [],
  );
  assert.equal(globalCommand.node.table, '(global)');
  assert.equal(globalCommand.node.context, 0);
  const fx = Cmd.modern(
    {
      appactionid: 'two',
      name: 'FX',
      onclickeventtype: 1,
      _onclickeventformulacomponentlibraryid_value: 'formula',
    },
    [],
  );
  assert.match(fx.node.actions[0].body, /Unresolved/);
  console.log(
    'Extension tests passed: provenance, immutable filtering, export counterparts, deduplication, CSV protection, retries, paging isolation, cancellation, modern JS/FX and placement.',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
