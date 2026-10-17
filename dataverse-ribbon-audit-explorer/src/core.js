(function (root) {
  'use strict';
  const key = (kind, id) => kind + ':' + String(id).replace(/[{}]/g, '').toLowerCase();
  const label = (x) => x?.UserLocalizedLabel?.Label || x?.LocalizedLabels?.[0]?.Label || '';
  function csv(
    rows,
    cols = [
      'table',
      'kind',
      'name',
      'id',
      'viewType',
      'owner',
      'ownerId',
      'creatorId',
      'queryType',
      'formType',
      'state',
      'createdOn',
      'modifiedOn',
      'commandType',
      'appId',
      'location',
      'hidden',
      'disabled',
      'actions',
      'rules',
      'visibility',
      'controlTypes',
      'runtimeParameters',
      'definitionCoverage',
      'unboundLayoutColumns',
      'coverage',
      'source',
      'webresourceType',
      'isManaged',
      'declaredTable',
      'context',
      'contextValue',
      'contextEntityId',
      'customStatus',
      'originCategory',
      'originReason',
      'provenance',
      'collectedAt',
    ],
  ) {
    const cell = (x) => {
      let s = typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x ?? '');
      if (/^[\s\u0000-\u001f]*[=+@-]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    return (
      '\ufeff' +
      [cols, ...rows.map((r) => cols.map((c) => r[c]))]
        .map((r) => r.map(cell).join(','))
        .join('\r\n')
    );
  }
  function relations(edges, node, direction) {
    return edges.filter((e) => e[direction === 'uses' ? 'from' : 'to'] === node);
  }
  const origins = [
    'All',
    'Customer-created',
    'Microsoft component with customer customisations',
    'Microsoft standard',
    'Third-party',
    'Unknown',
  ];
  const matchesOrigin = (n, o) => !o || o === 'All' || (n.originCategory || 'Unknown') === o;
  function classify(provenance = {}, publishers = {}) {
    const unknown = (reason) => ({ originCategory: 'Unknown', originReason: reason });
    if (
      !provenance ||
      typeof provenance !== 'object' ||
      typeof provenance.originalPublisherId !== 'string' ||
      (provenance.modifierPublisherIds !== undefined &&
        !Array.isArray(provenance.modifierPublisherIds))
    )
      return unknown('Invalid or incomplete provenance evidence');
    if (!provenance.source || !provenance.originalVerified || !provenance.originalPublisherId)
      return unknown('No verified introducing definition');
    const original = publishers[provenance.originalPublisherId.toLowerCase()]?.category;
    const modifiers = (provenance.modifierPublisherIds || []).map((id) =>
      typeof id === 'string' ? publishers[id.toLowerCase()]?.category : undefined,
    );
    if (!original || modifiers.some((x) => !x)) return unknown('Publisher mapping incomplete');
    if (original === 'Customer')
      return {
        originCategory: 'Customer-created',
        originReason: 'Verified customer introducing definition: ' + provenance.source,
      };
    if (original === 'Third-party')
      return {
        originCategory: 'Third-party',
        originReason: 'Verified vendor original; modifiers retained: ' + provenance.source,
      };
    if (original !== 'Microsoft' || !provenance.modificationCoverageComplete)
      return unknown('Modification coverage incomplete');
    if (modifiers.some((x) => x === 'Third-party'))
      return unknown('Mixed Microsoft/vendor provenance; modifiers retained');
    return {
      originCategory: modifiers.includes('Customer') ? origins[2] : origins[3],
      originReason: 'Verified original and complete modification coverage: ' + provenance.source,
    };
  }
  function dedupeEdges(edges) {
    return [
      ...new Map(
        edges.map((e) => [
          JSON.stringify([e.from, e.to, e.evidence, e.reason, e.source, e.placementId]),
          e,
        ]),
      ).values(),
    ];
  }
  function relationshipExport(nodes, edges, scope) {
    const keys = new Set(scope.map((n) => n.key));
    const selected = dedupeEdges(edges.filter((e) => keys.has(e.from) || keys.has(e.to)));
    const needed = new Set([...keys, ...selected.flatMap((e) => [e.from, e.to])]),
      index = new Map(nodes.map((n) => [n.key, n]));
    return {
      nodes: [...needed].map(
        (k) => index.get(k) || { key: k, kind: 'unresolved', originCategory: 'Unknown' },
      ),
      edges: selected,
    };
  }
  function issueCategory(message) {
    const s = typeof message === 'string' ? message : message.message || '';
    if (/Missing definition/.test(s)) return 'Missing XML definitions';
    if (/Malformed XML|DTD\/entity/.test(s)) return 'Invalid XML definitions';
    if (/Unresolved classic command:/.test(s)) return 'Unresolved command definitions';
    if (/unresolved rule/.test(s)) return 'Unresolved rule definitions';
    if (/\b(401|403):/.test(s)) return 'Access denied';
    if (/\b429:/.test(s)) return 'Throttled requests';
    if (/\b[45]\d\d:/.test(s)) return 'API request failures';
    if (/columns unavailable|schema unavailable/.test(s)) return 'Unavailable metadata columns';
    return 'Other collection issues';
  }
  function resolveReferences(nodes, edges) {
    const aliases = new Map(),
      names = new Map();
    for (const n of nodes) {
      aliases.set(n.key, n.key);
      if (n.kind === 'webresource' && n.id) {
        aliases.set(key('webresourceId', n.id), n.key);
        aliases.set('Component type 61: ' + n.id.toLowerCase(), n.key);
        const name = key('webresource', n.name);
        if (!names.has(name)) names.set(name, new Set());
        names.get(name).add(n.key);
      }
    }
    for (const [name, ids] of names) if (ids.size === 1) aliases.set(name, [...ids][0]);
    return edges.map((e) => {
      const from = aliases.get(e.from) || e.from,
        to = aliases.get(e.to) || e.to;
      return from === e.from && to === e.to
        ? e
        : {
            ...e,
            from,
            to,
            ...(from !== e.from ? { originalFrom: e.originalFrom || e.from } : {}),
            ...(to !== e.to ? { originalTo: e.originalTo || e.to } : {}),
          };
    });
  }
  function coverageSummary(nodes, edges, issues = [], advisories = [], scan = {}) {
    const kinds = {},
      keys = new Set(),
      groups = new Map(),
      missingXml = {};
    for (const n of nodes) {
      keys.add(n.key);
      kinds[n.kind] = (kinds[n.kind] || 0) + 1;
      for (const [part, result] of Object.entries(n.definitionCoverage || {}))
        if (result !== 'Collected') missingXml[part] = (missingXml[part] || 0) + 1;
    }
    for (const issue of issues) {
      const title = issueCategory(issue);
      if (!groups.has(title)) groups.set(title, { title, count: 0, samples: [] });
      const g = groups.get(title);
      g.count++;
      if (g.samples.length < 20) g.samples.push(typeof issue === 'string' ? issue : issue.message);
    }
    let unresolvedRelationships = 0;
    const targets = new Map();
    for (const e of edges) {
      let unresolved = false;
      for (const end of ['from', 'to'])
        if (!keys.has(e[end])) {
          unresolved = true;
          const prefix = /^webresource:\/_/.test(e[end])
            ? 'Platform script path'
            : e[end].split(':')[0];
          if (!targets.has(prefix))
            targets.set(prefix, { kind: prefix, occurrences: 0, keys: new Set() });
          const t = targets.get(prefix);
          t.occurrences++;
          t.keys.add(e[end]);
        }
      if (unresolved) unresolvedRelationships++;
    }
    const resourceNames = new Map();
    for (const n of nodes)
      if (n.kind === 'webresource') {
        const name = key('webresource', n.name);
        if (!resourceNames.has(name)) resourceNames.set(name, new Set());
        resourceNames.get(name).add(n.key);
      }
    const ambiguousResourceNames = [...resourceNames]
      .filter(([, ids]) => ids.size > 1)
      .map(([name, ids]) => ({ name, resourceIds: [...ids] }));
    const runtimeParameters = {};
    for (const a of advisories)
      runtimeParameters[a.parameter || a.code || 'Other'] =
        (runtimeParameters[a.parameter || a.code || 'Other'] || 0) + 1;
    return {
      scan: { ...scan },
      nodeKinds: kinds,
      totalNodes: nodes.length,
      placementContextNodes: kinds.commandbar || 0,
      componentNodes: nodes.length - (kinds.commandbar || 0),
      relationships: edges.length,
      unresolvedRelationships,
      unresolvedTargets: [...targets.values()].map((t) => ({
        kind: t.kind,
        occurrences: t.occurrences,
        uniqueTargets: t.keys.size,
        examples: [...t.keys].slice(0, 20),
      })),
      coverageIssueCount: issues.length,
      runtimeAdvisoryCount: advisories.length,
      runtimeParameters,
      ambiguousResourceNames,
      issueGroups: [...groups.values()],
      missingXml,
    };
  }
  function compareNodes(a, b, column = 'table', direction = 1) {
    const value = (n, c) =>
      c === 'display'
        ? n.display || n.name || ''
        : c === 'type'
          ? [n.viewType, n.commandType, n.kind].filter(Boolean).join(' / ')
          : c === 'origin'
            ? n.originCategory || 'Unknown'
            : String(n[c] || '');
    return (
      direction *
        value(a, column).localeCompare(value(b, column), undefined, {
          numeric: true,
          sensitivity: 'base',
        }) ||
      value(a, 'table').localeCompare(value(b, 'table')) ||
      value(a, 'name').localeCompare(value(b, 'name')) ||
      a.key.localeCompare(b.key)
    );
  }
  const api = {
    key,
    label,
    csv,
    relations,
    origins,
    matchesOrigin,
    classify,
    dedupeEdges,
    relationshipExport,
    issueCategory,
    resolveReferences,
    coverageSummary,
    compareNodes,
  };
  if (typeof module !== 'undefined') module.exports = api;
  else root.DE = api;
})(globalThis);
