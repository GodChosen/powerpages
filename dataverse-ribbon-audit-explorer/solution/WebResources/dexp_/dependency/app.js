'use strict';
const $ = (id) => document.getElementById(id),
  C = DE;
let solutionIndex = new Map(),
  componentNames = new Map(),
  tables = [],
  rows = [],
  notes = [],
  controller,
  client,
  page = 0,
  sort = 'name',
  direction = 1,
  scanVersion = 0,
  scanning = false,
  coverage = {},
  auditItems = new Map();
const guid = (x) => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(x || '');
const status = (t) => ($('status').textContent = t);
async function bounded(items, work) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, items.length) }, async () => {
      while (i < items.length) await work(items[i++]);
    }),
  );
}
async function records(entity, wanted, filter) {
  const m = await client.all(
      `EntityDefinitions(LogicalName='${entity}')/Attributes?$select=LogicalName,AttributeType,IsValidForRead`,
    ),
    read = m.filter((a) => a.IsValidForRead && wanted.includes(a.LogicalName)),
    columns = read.map((a) =>
      a.AttributeType === 'Lookup' ? '_' + a.LogicalName + '_value' : a.LogicalName,
    );
  if (!columns.length) throw Error(entity + ' readable schema unavailable');
  return client.all(
    entity === 'appaction'
      ? 'appactions?$select=' + columns.join(',')
      : 'canvasapps?$select=' + columns.join(',') + (filter ? '&$filter=' + filter : ''),
  );
}
const managedText = (x) => (x === true ? 'Managed' : x === false ? 'Unmanaged' : 'Not verified');
const tableLabel = (r) =>
  r.table === '(global)'
    ? 'Global / all tables'
    : r.table === '(unresolved)'
      ? 'Not verified'
      : r.table || (r.type === 'Custom page' ? 'Not table-bound' : 'Not verified');
const auditText = (r) => r.auditFinding || 'Not verified';
const solutionTypes = (r) =>
  (r.solutions || []).map((s) => s.name + ': ' + managedText(s.managed)).join('; ');
const layerLabels = (r) =>
  (r.layers?.length ? r.layers : r.definitionLayers || []).map(
    (l) =>
      (l.order !== undefined && l.order !== null ? '#' + l.order + ' ' : '') +
      l.solutionName +
      (l.version ? ' v' + l.version : '') +
      ' — ' +
      managedText(l.managed) +
      (r.layers?.length ? '' : ' (definition)'),
  );
function sortValue(r, column) {
  return column === 'audit'
    ? auditText(r)
    : column === 'table'
      ? tableLabel(r)
      : column === 'solutions'
        ? (r.solutions || []).map((s) => s.name).join(' ')
        : column === 'solutionType'
          ? solutionTypes(r)
          : column === 'layers'
            ? layerLabels(r).join(' ')
            : column === 'dependencies'
              ? r.dependencies.join(' ')
              : r[column] || '';
}
function filtered() {
  const q = $('search').value.toLowerCase(),
    kind = $('kind').value,
    solution = $('solution').value,
    origin = $('origin').value,
    audit = $('audit').value;
  return rows
    .filter(
      (r) =>
        (!audit || (audit === 'unmanaged' ? r.unmanagedObserved : auditText(r) === audit)) &&
        (!origin || r.origin === origin) &&
        (!kind || r.type === kind) &&
        (!solution || r.solutions.some((s) => s.id === solution)) &&
        (!q ||
          [
            r.name,
            r.logicalName,
            auditText(r),
            r.auditReason,
            tableLabel(r),
            sortValue(r, 'solutions'),
            solutionTypes(r),
            layerLabels(r).join(' '),
            r.dependencies.join(' '),
          ]
            .join(' ')
            .toLowerCase()
            .includes(q)),
    )
    .sort(
      (a, b) =>
        direction *
          sortValue(a, sort).localeCompare(sortValue(b, sort), undefined, {
            numeric: true,
            sensitivity: 'base',
          }) || a.key.localeCompare(b.key),
    );
}
function button(text, fn) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.onclick = fn;
  return b;
}
function td(tr, text) {
  const e = tr.insertCell();
  if (text !== undefined) e.textContent = text;
  return e;
}
function render() {
  const list = $('list');
  list.replaceChildren();
  $('pages').replaceChildren();
  const matching = filtered();
  page = Math.min(page, Math.max(0, Math.ceil(matching.length / 50) - 1));
  $('counts').textContent = rows.length
    ? `${matching.length.toLocaleString()} matching; ${rows.length.toLocaleString()} ribbon items, commands and custom pages collected.`
    : scanning
      ? 'Scanning configured ribbon items, commands and custom pages…'
      : 'No results collected.';
  if (!matching.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'table-scroll';
  const table = document.createElement('table'),
    head = table.createTHead().insertRow();
  for (const [id, label] of [
    ['name', 'Name'],
    ['type', 'Type'],
    ['table', 'Table'],
    ['solutions', 'Solution name(s)'],
    ['solutionType', 'Solution type'],
    ['layers', 'Solution layers'],
    ['audit', 'Unmanaged audit'],
    ['dependencies', 'Dependencies list'],
  ]) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.setAttribute(
      'aria-sort',
      sort === id ? (direction === 1 ? 'ascending' : 'descending') : 'none',
    );
    const b = button(label + (sort === id ? (direction === 1 ? ' ▲' : ' ▼') : ''), () => {
      direction = sort === id ? -direction : 1;
      sort = id;
      page = 0;
      render();
    });
    b.setAttribute('aria-label', 'Sort by ' + label);
    th.append(b);
    head.append(th);
  }
  const body = table.createTBody();
  for (const r of matching.slice(page * 50, page * 50 + 50)) {
    const tr = body.insertRow();
    td(tr, r.name);
    const small = document.createElement('small');
    small.textContent = r.logicalName;
    tr.cells[0].append(small);
    td(tr, r.type);
    const origin = document.createElement('small');
    origin.textContent = r.origin || 'Not verified';
    origin.title = r.originReason || '';
    tr.cells[1].append(origin);
    td(tr, tableLabel(r));
    const sol = td(tr, r.solutions.map((s) => s.name).join('; ') || 'Not verified');
    if (r.solutionBasis) {
      const n = document.createElement('small');
      n.textContent = r.solutionBasis;
      sol.append(n);
    }
    td(tr, solutionTypes(r) || 'Not verified');
    const layersCell = td(tr),
      layerList = document.createElement('ul');
    for (const text of layerLabels(r)) {
      const li = document.createElement('li');
      li.textContent = text;
      layerList.append(li);
    }
    layersCell.append(layerList);
    const layerNote = document.createElement('small');
    layerNote.textContent = r.layerStatus || 'Definition evidence only; full stack not loaded.';
    layersCell.append(layerNote);
    if (r.sourceIds.some(guid)) {
      const b = button(
        r.layerLoading ? 'Loading layers…' : r.layerStatus ? 'Refresh layers' : 'Load layers',
        async () => {
          r.layerLoading = true;
          render();
          await loadLayers(r);
          r.layerLoading = false;
          render();
        },
      );
      b.disabled = scanning || r.layerLoading;
      layersCell.append(b);
    }
    const auditCell = td(tr, auditText(r)),
      auditNote = document.createElement('small');
    auditNote.textContent = r.auditReason || 'Not inspected.';
    auditCell.append(auditNote);
    if (r.auditItem) {
      const detail = document.createElement('details'),
        summary = document.createElement('summary');
      summary.textContent = 'View item definitions';
      detail.append(summary);
      for (const d of r.auditItem.definitions) {
        const label = document.createElement('p');
        label.textContent =
          managedText(d.isManaged) +
          ' · ' +
          (solutionIndex.get(String(d.solutionId).toLowerCase())?.friendlyname ||
            d.solutionId ||
            'Solution not verified');
        const pre = document.createElement('pre');
        pre.textContent = d.xml;
        detail.append(label, pre);
      }
      auditCell.append(detail);
    }
    const cell = td(tr),
      ul = document.createElement('ul');
    for (const d of r.dependencies) {
      const li = document.createElement('li');
      li.textContent = d;
      ul.append(li);
    }
    cell.append(ul);
    const note = document.createElement('small');
    note.textContent = [
      ...r.dependencyNotes,
      r.platformState || 'Additional platform dependencies not requested.',
    ].join(' ');
    cell.append(note);
    if (r.componentType && r.sourceIds.some(guid)) {
      const b = button(
        r.platformState === 'Loading…'
          ? 'Loading…'
          : r.platformState?.startsWith('Loaded')
            ? 'Refresh platform dependencies'
            : 'Load platform dependencies',
        async () => {
          b.disabled = true;
          await platform(r);
          render();
        },
      );
      b.disabled = scanning || r.platformState === 'Loading…';
      cell.append(b);
    }
  }
  wrap.append(table);
  list.append(wrap);
  const prev = button('Previous page', () => {
      page--;
      render();
    }),
    next = button('Next page', () => {
      page++;
      render();
    });
  prev.disabled = page === 0;
  next.disabled = (page + 1) * 50 >= matching.length;
  const label = document.createElement('span');
  label.textContent = `Page ${page + 1} of ${Math.ceil(matching.length / 50)}`;
  $('pages').append(prev, label, next);
}
function notesView() {
  $('notes').hidden = !notes.length;
  $('notestitle').textContent = `Scan notes (${notes.length.toLocaleString()})`;
  $('notelist').replaceChildren();
  for (const text of notes.slice(0, 30)) {
    const li = document.createElement('li');
    li.textContent = text;
    $('notelist').append(li);
  }
  if (notes.length > 30) {
    const li = document.createElement('li');
    li.textContent = 'Showing 30 examples; full notes are included in the CSV export.';
    $('notelist').append(li);
  }
}
async function platform(r) {
  const run = scanVersion,
    signal = controller?.signal;
  r.platformState = 'Loading…';
  const found = [],
    errors = [];
  for (const id of r.sourceIds.filter(guid))
    for (const [fn, dir] of [
      ['RetrieveRequiredComponents', 'Uses'],
      ['RetrieveDependentComponents', 'Used by'],
    ]) {
      try {
        const result = await client.all(`${fn}(ObjectId=${id},ComponentType=${r.componentType})`);
        if (run !== scanVersion || signal?.aborted) return;
        for (const x of result) {
          const prefix = dir === 'Uses' ? 'required' : 'dependent',
            type = x[prefix + 'componenttype'],
            object = x[prefix + 'componentobjectid'];
          if (!object || type === undefined) throw Error('Unexpected dependency response');
          const known = rows.find(
            (n) =>
              n.sourceIds.some((i) => i.toLowerCase() === object.toLowerCase()) &&
              n.componentType === type,
          );
          found.push(
            `${dir}: ${known?.name || componentNames.get(type + ':' + object.toLowerCase()) || 'Component type ' + type + ' / ' + object}`,
          );
        }
      } catch (e) {
        if (e.name === 'AbortError') return;
        errors.push(e.message);
      }
    }
  if (run !== scanVersion || signal?.aborted) return;
  r.dependencies = [...new Set([...r.definitionDependencies, ...found])];
  r.platformState = errors.length
    ? 'Platform lookup incomplete: ' + errors.join(' | ')
    : 'Loaded direct platform dependencies.';
  if (!found.length && !errors.length)
    r.platformState += ' No direct dependencies returned; this is not proof of no dependencies.';
}
async function loadLayers(r) {
  const run = scanVersion,
    signal = controller?.signal,
    found = [],
    errors = [],
    logicalName =
      r.type === 'Modern command'
        ? 'appaction'
        : r.type === 'Custom page'
          ? 'canvasapp'
          : r.sourceLogicalName || 'ribbondiff';
  const ids = r.sourceIds
    .filter(guid)
    .slice(
      0,
      r.type.startsWith('Classic') || r.sourceLogicalName === 'ribboncustomization' ? undefined : 1,
    );
  for (const id of ids) {
    try {
      const filter =
        "msdyn_componentid eq '" +
        id +
        "' and msdyn_solutioncomponentname eq '" +
        logicalName +
        "'";
      const records = await client.all(
        'msdyn_componentlayers?$filter=' + encodeURIComponent(filter),
      );
      if (run !== scanVersion || signal?.aborted) return;
      found.push(...DECommands.solutionLayers(records, id, solutionIndex));
      DECommands.mergeLayerDefinitions(r, records, id, solutionIndex);
      if (r.auditItem) auditItems.set(r.auditItem.key, r.auditItem);
    } catch (e) {
      if (e.name === 'AbortError') return;
      errors.push(e.message);
    }
  }
  if (run !== scanVersion || signal?.aborted) return;
  r.layers = found;
  r.layerStatus = errors.length
    ? 'Layer lookup incomplete: ' + errors.join(' | ')
    : found.length
      ? found.length + ' platform layer(s) returned. Provider order shown within each component.'
      : 'No full stack returned; showing available definition evidence only.';
  DECommands.layerAudit(r);
  if (auditItems.size) DECommands.applyRibbonAudit(rows, { items: auditItems });
}
$('scan').onclick = async () => {
  controller?.abort();
  controller = new AbortController();
  const run = ++scanVersion;
  rows = [];
  notes = [];
  coverage = {};
  auditItems = new Map();
  page = 0;
  solutionIndex = new Map();
  componentNames = new Map();
  scanning = true;
  for (const id of ['search', 'kind', 'solution', 'origin', 'audit']) $(id).disabled = true;
  $('scan').disabled = true;
  $('cancel').disabled = false;
  $('export').disabled = true;
  $('exportcoverage').disabled = true;
  $('coverage').textContent = 'Scan in progress; coverage is incomplete.';
  try {
    client = DETransport.client(GetGlobalContext().getClientUrl(), controller.signal);
    render();
    status('Reading solution names…');
    const solutions = await client.all(
        'solutions?$select=solutionid,friendlyname,uniquename,ismanaged,version,_publisherid_value',
      ),
      names = new Map(
        solutions.map((s) => [s.solutionid.toLowerCase(), s.friendlyname || s.uniquename]),
      );
    status('Reading ribbon definitions across all tables and the Application Ribbon…');
    const fragments = [];
    for (const [set, id, field, logical] of [
      ['ribbondiffs', 'ribbondiffid', 'rdx', 'ribbondiff'],
      ['ribboncommands', 'ribboncommandid', 'commanddefinition', 'ribboncommand'],
      ['ribbonrules', 'ribbonruleid', 'ruledefinition', 'ribbonrule'],
    ]) {
      try {
        const source = await client.all(
          set + '?$select=' + [id, 'entity', field, 'solutionid', 'ismanaged'].join(','),
        );
        coverage[set] = { status: 'Read completed', records: source.length };
        for (const r of source)
          fragments.push({
            ribbondiffid: r[id],
            entity: r.entity,
            rdx: r[field],
            solutionid: r.solutionid,
            ismanaged: r.ismanaged,
            sourceLogicalName: logical,
          });
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        coverage[set] = { status: 'Failed', error: e.message };
        notes.push(set + ': ' + e.message);
      }
    }
    let parents = [];
    try {
      parents = await client.all(
        'ribboncustomizations?$select=ribboncustomizationid,entity,ismanaged,solutionid',
      );
      coverage.ribbonParents = parents.length;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      notes.push('Ribbon parent coverage: ' + e.message);
    }
    const parsed = DECommands.focusedClassic(fragments),
      audit = DECommands.ribbonAudit(fragments, parents);
    auditItems = audit.items;
    DECommands.applyRibbonAudit(parsed.rows, audit);
    rows.push(...parsed.rows, ...audit.rows);
    notes.push(...parsed.notes, ...audit.notes);
    coverage.definitionContexts = audit.contexts;
    coverage.unmanagedParents = parents.filter((p) => p.ismanaged === false).length;
    status('Reading table names for command context…');
    try {
      tables = await client.all('EntityDefinitions?$select=LogicalName,MetadataId');
      for (const t of tables) componentNames.set('1:' + t.MetadataId.toLowerCase(), t.LogicalName);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      tables = [];
      notes.push('Table context names: ' + e.message);
    }
    coverage.tableCount = tables.length;
    status('Reading modern commands…');
    try {
      const wanted = [
        'appactionid',
        'name',
        'uniquename',
        'buttonlabeltext',
        'context',
        'contextvalue',
        'contextentity',
        'appmoduleid',
        'location',
        'onclickEventType'.toLowerCase(),
        'onclickeventjavascriptwebresourceid',
        'onclickeventjavascriptfunctionname',
        'onclickeventjavascriptparameters',
        'onclickeventformulacomponentlibraryid',
        'visibilityformulacomponentlibraryid',
        'solutionid',
        'componentidunique',
        'ismanaged',
      ];
      const modernRecords = await records('appaction', wanted);
      coverage.modernCommands = modernRecords.length;
      for (const r of modernRecords) {
        const c = DECommands.modern(r, tables),
          deps = c.edges.filter((e) => e.from === c.node.key).map((e) => e.reason + ': ' + e.to);
        if (c.node.actions[0]?.function) deps.push('Function: ' + c.node.actions[0].function);
        rows.push({
          key: c.node.key,
          type: 'Modern command',
          name: r.buttonlabeltext || r.name || r.uniquename || r.appactionid,
          logicalName: r.uniquename || r.name || r.appactionid,
          table: c.node.table,
          sourceIds: [r.appactionid, r.componentidunique].filter(Boolean),
          solutionIds: [r.solutionid].filter(Boolean),
          layerEvidence: [{ solutionId: r.solutionid, isManaged: r.ismanaged }],
          dependencies: deps,
          dependencyNotes:
            c.node.actions[0]?.type === 'Power Fx'
              ? ['Formula library reference; formula body not inspected.']
              : [],
        });
      }
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      notes.push('Modern commands: ' + e.message);
    }
    status('Reading custom pages…');
    try {
      for (const r of await records(
        'canvasapp',
        [
          'canvasappid',
          'canvasappuniqueid',
          'name',
          'displayname',
          'canvasapptype',
          'solutionid',
          'ismanaged',
        ],
        'canvasapptype eq 2',
      ))
        rows.push({
          key: C.key('page', r.canvasappid),
          type: 'Custom page',
          name: r.displayname || r.name || r.canvasappid,
          logicalName: r.name || r.canvasappid,
          sourceIds: [r.canvasappid, r.canvasappuniqueid].filter(Boolean),
          solutionIds: [r.solutionid].filter(Boolean),
          layerEvidence: [{ solutionId: r.solutionid, isManaged: r.ismanaged }],
          componentType: 300,
          dependencies: [],
          dependencyNotes: [],
        });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      notes.push('Custom pages: ' + e.message);
    }
    status('Matching solution membership…');
    const byId = new Map();
    for (const r of rows)
      for (const id of r.sourceIds.filter(guid)) {
        const k = id.toLowerCase();
        if (!byId.has(k)) byId.set(k, []);
        byId.get(k).push(r);
      }
    const ids = [...byId.keys()],
      chunks = [];
    for (let i = 0; i < ids.length; i += 25) chunks.push(ids.slice(i, i + 25));
    await bounded(chunks, async (group) => {
      try {
        for (const m of await client.all(
          'solutioncomponents?$select=objectid,componenttype,_solutionid_value&$filter=' +
            encodeURIComponent(group.map((id) => 'objectid eq ' + id).join(' or ')),
        ))
          for (const r of byId.get(m.objectid?.toLowerCase()) || []) {
            r.memberSolutions = r.memberSolutions || [];
            if (m._solutionid_value) r.memberSolutions.push(m._solutionid_value);
            if (r.type === 'Modern command') r.componentType = m.componenttype;
          }
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        notes.push('Solution membership batch: ' + e.message);
      }
    });
    solutionIndex = new Map(solutions.map((s) => [s.solutionid.toLowerCase(), s]));
    for (const r of rows) {
      Object.assign(r, DECommands.definitionOrigin(r.layerEvidence || [], solutionIndex));
      const members = r.memberSolutions?.length ? r.memberSolutions : r.solutionIds;
      r.solutionBasis = r.memberSolutions?.length
        ? 'Recorded solution membership'
        : members.length
          ? 'Returned definition layer'
          : 'Solution not verified';
      r.solutions = [...new Set(members.map((x) => x.toLowerCase()))].map((id) => ({
        id,
        name: names.get(id) || 'Unmapped solution ' + id,
        managed: solutionIndex.get(id)?.ismanaged ?? null,
        version: solutionIndex.get(id)?.version || null,
      }));
      r.definitionLayers = [
        ...new Map(
          (r.layerEvidence || []).map((e) => [
            e.solutionId + ':' + e.isManaged,
            {
              solutionId: e.solutionId,
              solutionName:
                names.get(String(e.solutionId).toLowerCase()) || e.solutionId || 'Not verified',
              managed: e.isManaged ?? null,
              version: solutionIndex.get(String(e.solutionId).toLowerCase())?.version || null,
              evidence: 'Returned definition; full stack not verified',
            },
          ]),
        ).values(),
      ];
      r.definitionDependencies = [...r.dependencies];
      DECommands.layerAudit(r);
    }
    const scriptIds = [
      ...new Set(
        rows.flatMap((r) =>
          r.dependencies.flatMap((d) =>
            [...d.matchAll(/webresourceId:([0-9a-f-]{36})/gi)].map((m) => m[1]),
          ),
        ),
      ),
    ];
    const scriptChunks = [];
    for (let i = 0; i < scriptIds.length; i += 25) scriptChunks.push(scriptIds.slice(i, i + 25));
    await bounded(scriptChunks, async (group) => {
      try {
        for (const resource of await client.all(
          'webresourceset?$select=webresourceid,name&$filter=' +
            encodeURIComponent(group.map((id) => 'webresourceid eq ' + id).join(' or ')),
        ))
          componentNames.set('61:' + resource.webresourceid.toLowerCase(), resource.name);
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        notes.push('Script names: ' + e.message);
      }
    });
    for (const r of rows) {
      r.dependencies = r.dependencies.map((d) =>
        d.replace(
          /webresourceId:([0-9a-f-]{36})/gi,
          (all, id) => componentNames.get('61:' + id.toLowerCase()) || all,
        ),
      );
      r.definitionDependencies = [...r.dependencies];
    }
    $('solution').replaceChildren(new Option('All solutions', ''));
    for (const [id, name] of [
      ...new Map(rows.flatMap((r) => r.solutions.map((s) => [s.id, s.name]))),
    ].sort((a, b) => a[1].localeCompare(b[1])))
      $('solution').append(new Option(name, id));
    status('Checking layers for unmanaged findings…');
    await bounded(
      rows.filter((r) => r.unmanagedObserved),
      loadLayers,
    );
    coverage.unmanagedFindings = rows.filter((r) => r.unmanagedObserved).length;
    coverage.notVerified = rows.filter(
      (r) => auditText(r) === 'Not verified' || auditText(r).includes('candidate'),
    ).length;
    $('coverage').textContent =
      `Discovery: ${coverage.tableCount || 0} table names; ${coverage.definitionContexts?.filter((t) => t !== '(global)').length || 0} table contexts with returned classic definitions; Application Ribbon definitions ${coverage.definitionContexts?.includes('(global)') ? 'returned' : 'not returned'}. Unmanaged findings: ${coverage.unmanagedFindings}; unmanaged ribbon parents: ${coverage.unmanagedParents || 0}. All pages of environment-wide ribbon sources were requested without a table filter. Missing definitions, empty stacks and tables with no returned records are not proof of no unmanaged customizations. ${notes.length ? 'Coverage incomplete: see scan notes.' : 'Published source reads completed; historical and unpublished coverage is not established.'}`;
    status('Loading custom-page dependencies…');
    await bounded(
      rows.filter((r) => r.type === 'Custom page'),
      platform,
    );
    if (run !== scanVersion) return;
    status(
      `Collected ${rows.length.toLocaleString()} ribbon items, commands and custom pages${notes.length ? '; ' + notes.length.toLocaleString() + ' scan notes' : ''}. Source 1.5.1.`,
    );
  } catch (e) {
    if (run === scanVersion) {
      $('coverage').textContent =
        'Scan interrupted — table and Application Ribbon coverage is incomplete.';
      coverage.interrupted = true;
    }
    if (run === scanVersion)
      status(
        e.name === 'AbortError'
          ? 'Cancelled — results are incomplete.'
          : 'Scan failed: ' + e.message,
      );
  } finally {
    if (run === scanVersion) {
      scanning = false;
      for (const id of ['search', 'kind', 'solution', 'origin', 'audit']) $(id).disabled = false;
      for (const r of rows) {
        r.solutions = r.solutions || [];
        r.definitionDependencies = r.definitionDependencies || r.dependencies;
      }
      render();
      notesView();
      $('scan').disabled = false;
      $('cancel').disabled = true;
      $('export').disabled = !rows.length;
      $('exportcoverage').disabled = !tables.length;
    }
  }
};
$('cancel').onclick = () => controller?.abort();
for (const id of ['search', 'kind', 'solution', 'origin', 'audit'])
  $(id).oninput = () => {
    page = 0;
    render();
  };
$('export').onclick = () => {
  const output = filtered().map((r) => ({
      name: r.name,
      type: r.type,
      origin: r.origin,
      originReason: r.originReason,
      logicalName: r.logicalName,
      table: tableLabel(r),
      tableContext: r.table,
      sourceIds: r.sourceIds,
      solutions: r.solutions,
      solutionType: solutionTypes(r),
      definitionLayers: r.definitionLayers,
      solutionLayers: r.layers || [],
      layerStatus: r.layerStatus || 'Not requested',
      auditFinding: auditText(r),
      auditReason: r.auditReason,
      unmanagedObserved: !!r.unmanagedObserved,
      itemDefinitions: r.auditItem?.definitions.map((d) => ({
        managed: d.isManaged,
        solutionId: d.solutionId,
        sourceId: d.sourceId,
        xml: d.xml,
      })),
      scanCoverage: coverage,
      solutionBasis: r.solutionBasis,
      dependencies: r.dependencies,
      dependencyNotes: r.dependencyNotes,
      platformState: r.platformState || 'Not requested',
      scanNotes: notes,
    })),
    blob = new Blob(
      [
        C.csv(output, [
          'name',
          'type',
          'origin',
          'originReason',
          'logicalName',
          'table',
          'tableContext',
          'sourceIds',
          'solutions',
          'solutionType',
          'definitionLayers',
          'solutionLayers',
          'layerStatus',
          'auditFinding',
          'auditReason',
          'unmanagedObserved',
          'itemDefinitions',
          'scanCoverage',
          'solutionBasis',
          'dependencies',
          'dependencyNotes',
          'platformState',
          'scanNotes',
        ]),
      ],
      { type: 'text/csv;charset=utf-8' },
    ),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = 'commands-custom-pages.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
status(
  'Ready — source 1.5.1. Scan all table and Application Ribbon definitions, modern commands and custom pages.',
);

$('exportcoverage').onclick = () => {
  const contexts = [
    ...new Set([
      ...tables.map((t) => t.LogicalName),
      '(global)',
      ...(coverage.definitionContexts || []),
    ]),
  ].sort();
  const output = contexts.map((table) => ({
    table: table === '(global)' ? 'Application Ribbon' : table,
    classicDefinitionsReturned: coverage.definitionContexts?.includes(table) || false,
    unmanagedFindings: rows.filter((r) => r.table === table && r.unmanagedObserved).length,
    status: coverage.interrupted
      ? 'Scan interrupted'
      : coverage.definitionContexts?.includes(table)
        ? 'Definitions returned; unmanaged absence and historical completeness not proven'
        : 'No classic definition returned; not a clean bill of health',
    scanNotes: notes,
  }));
  const blob = new Blob(
      [
        C.csv(output, [
          'table',
          'classicDefinitionsReturned',
          'unmanagedFindings',
          'status',
          'scanNotes',
        ]),
      ],
      { type: 'text/csv;charset=utf-8' },
    ),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = 'ribbon-table-coverage.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
