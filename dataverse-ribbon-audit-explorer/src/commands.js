(function (root) {
  'use strict';
  const C = typeof module !== 'undefined' ? require('./core.js') : root.DE;
  function xml(text) {
    if (!text) throw Error('Missing definition');
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw Error('DTD/entity declarations are unsupported');
    const d = new DOMParser().parseFromString(text, 'application/xml');
    if (d.querySelector('parsererror')) throw Error('Malformed XML');
    return d;
  }
  const attrs = (e) => Object.fromEntries([...e.attributes].map((a) => [a.name, a.value]));
  function classic(text, table, source = 'Effective ribbon') {
    const d = xml(text),
      nodes = [],
      edges = [],
      placements = [],
      warnings = [],
      advisories = [];
    const ruleDefs = new Map(
      [
        ...d.querySelectorAll(
          'RuleDefinitions > DisplayRules > DisplayRule, RuleDefinitions > EnableRules > EnableRule',
        ),
      ].map((r) => [r.getAttribute('Id'), r]),
    );
    const defs = new Map(
      [...d.querySelectorAll('CommandDefinition')].map((r) => [r.getAttribute('Id'), r]),
    );
    const controls = [...d.querySelectorAll('[Command]')];
    const labels = new Map(
      [...d.querySelectorAll('LocLabel')].map((l) => [
        l.getAttribute('Id'),
        l.querySelector('Title')?.getAttribute('description'),
      ]),
    );
    const readableLabel = (value) =>
      value?.startsWith('$LocLabels:') ? labels.get(value.slice(11)) || value : value;
    const ids = new Set([...defs.keys(), ...controls.map((e) => e.getAttribute('Command'))]);
    const commandKey = (id) => C.key('command', 'classic:' + table + ':' + id);
    for (const id of ids) {
      const definition = defs.get(id),
        key = commandKey(id),
        actions = [],
        rules = [],
        runtimeParameters = new Set();
      const refs = (element, reason) => {
        for (const a of [element, ...element.querySelectorAll('*')]) {
          if (a.tagName === 'ValueRule' && a.getAttribute('Field'))
            edges.push({
              from: key,
              to:
                table === '(global)'
                  ? C.key('unresolved', a.getAttribute('Field'))
                  : C.key('field', table + '.' + a.getAttribute('Field')),
              reason: 'ValueRule field in ribbon table context',
              evidence:
                table === '(global)' ? 'Unresolved reference' : 'Explicit definition reference',
              source,
            });
          const lib = a.getAttribute('Library');
          if (lib)
            edges.push({
              from: key,
              to: C.key('webresource', lib.replace(/^\$webresource:/i, '')),
              reason,
              evidence: 'Explicit definition reference',
              source,
            });
          if (a.tagName === 'CrmParameter' && a.getAttribute('Value') === 'PrimaryEntityTypeCode')
            continue;
          if (
            a.tagName === 'CrmParameter' &&
            a.getAttribute('Value')?.startsWith('SelectedControl')
          )
            runtimeParameters.add(a.getAttribute('Value'));
        }
      };
      if (definition) {
        for (const a of definition.querySelectorAll('Actions > *')) {
          actions.push({
            type: a.tagName,
            ...attrs(a),
            parameters: [...a.children].map((p) => ({ type: p.tagName, ...attrs(p) })),
          });
          refs(a, 'Command action');
        }
        for (const r of definition.querySelectorAll(
          'DisplayRules > DisplayRule, EnableRules > EnableRule',
        )) {
          const ruleId = r.getAttribute('Id'),
            full = ruleDefs.get(ruleId);
          rules.push({
            id: ruleId,
            type: r.tagName,
            resolved: !!full,
            definition: full ? new XMLSerializer().serializeToString(full) : null,
          });
          if (full) refs(full, 'Command rule');
          else warnings.push(id + ': unresolved rule ' + ruleId);
        }
      } else warnings.push('Unresolved classic command: ' + id);
      for (const parameter of runtimeParameters)
        advisories.push({
          commandId: id,
          code: 'RuntimeParameter',
          parameter,
          description: 'Resolved at runtime; no static component target asserted',
        });
      nodes.push({
        key,
        id,
        name: id,
        display: readableLabel(
          controls.find((c) => c.getAttribute('Command') === id)?.getAttribute('LabelText'),
        ),
        table,
        kind: 'command',
        commandType: 'Classic',
        actions,
        rules,
        runtimeParameters: [...runtimeParameters],
        controlTypes: [
          ...new Set(
            controls.filter((c) => c.getAttribute('Command') === id).map((c) => c.tagName),
          ),
        ],
        source,
        coverage: definition
          ? rules.some((r) => !r.resolved)
            ? source + '; some rule definitions unavailable'
            : source
          : 'Unresolved command definition',
        unresolved: !definition,
        originCategory: 'Unknown',
      });
    }
    const locationOf = (e) => {
      for (let p = e; p; p = p.parentElement) {
        if (p.tagName === 'CustomAction') {
          const loc = p.getAttribute('Location');
          if (loc) return loc;
        }
        const id = p.getAttribute?.('Id') || '';
        if (id.includes('HomepageGrid')) return 'Main grid';
        if (id.includes('SubGrid')) return 'Subgrid';
        if (id.includes('Form')) return 'Main form';
      }
      return table === '(global)' ? 'Global' : 'Unresolved location';
    };
    for (const control of controls) {
      const command = control.getAttribute('Command'),
        button = control.getAttribute('Id') || '(missing button ID)',
        placement = {
          id: table + ':' + button + ':' + locationOf(control),
          commandKey: commandKey(command),
          buttonId: button,
          label: readableLabel(control.getAttribute('LabelText')) || button,
          table,
          location: locationOf(control),
          source,
          attributes: attrs(control),
        };
      placements.push(placement);
      edges.push({
        from: C.key('commandbar', placement.id),
        to: placement.commandKey,
        evidence: 'Command placement',
        reason: placement.location,
        source,
        placementId: placement.id,
      });
    }
    for (const hide of d.querySelectorAll('HideCustomAction')) {
      placements.push({
        id: hide.getAttribute('HideActionId') || hide.getAttribute('Location'),
        table,
        hidden: true,
        location: hide.getAttribute('Location'),
        source,
        coverage: 'Hide action; target command may be outside this diff',
      });
    }
    return { nodes, edges, placements, warnings, advisories };
  }
  function modern(r, tables) {
    const id = r.appactionid,
      key = C.key('command', 'modern:' + id),
      table =
        tables.find(
          (t) =>
            t.MetadataId?.replace(/[{}]/g, '').toLowerCase() ===
            String(r._contextentity_value).toLowerCase(),
        )?.LogicalName || (r.context === 0 ? '(global)' : '(unresolved)'),
      source = 'appaction',
      edges = [];
    const node = {
      key,
      id,
      kind: 'command',
      name: r.name || r.uniquename || id,
      display: r.buttonlabeltext,
      table,
      commandType: 'Modern',
      context: r.context,
      contextValue: r.contextvalue,
      contextEntityId: r._contextentity_value,
      appId: r._appmoduleid_value,
      location:
        r['location@OData.Community.Display.V1.FormattedValue'] ||
        {
          0: 'Main form',
          1: 'Main grid',
          2: 'Subgrid',
          3: 'Associated grid',
          4: 'Quick form',
          5: 'Global header',
          6: 'Dashboard',
        }[r.location] ||
        'Unresolved location',
      hidden: r.hidden,
      disabled: r.isdisabled,
      state: r.statecode,
      appactionOrigin: r.origin,
      actions: [],
      visibility: {
        type: r.visibilitytype,
        libraryId: r._visibilityformulacomponentlibraryid_value,
        library: r.visibilityformulacomponentlibrary,
        component: r.visibilityformulacomponentname,
        function: r.visibilityformulafunctionname,
        body: 'Unresolved: not collected',
      },
      source,
      originCategory: 'Unknown',
    };
    if (r.onclickeventtype === 2) {
      node.actions.push({
        type: 'JavaScript',
        libraryId: r._onclickeventjavascriptwebresourceid_value,
        function: r.onclickeventjavascriptfunctionname,
        parameters: r.onclickeventjavascriptparameters,
      });
      if (r._onclickeventjavascriptwebresourceid_value)
        edges.push({
          from: key,
          to: C.key('webresourceId', r._onclickeventjavascriptwebresourceid_value),
          evidence: 'Explicit definition reference',
          reason: 'JavaScript library',
          source,
        });
    } else if (r.onclickeventtype === 1) {
      node.actions.push({
        type: 'Power Fx',
        libraryId: r._onclickeventformulacomponentlibraryid_value,
        library: r.onclickeventformulacomponentlibrary,
        component: r.onclickeventformulacomponentname,
        function: r.onclickeventformulafunctionname,
        body: 'Unresolved: formula body not exposed by this reference',
      });
      if (r._onclickeventformulacomponentlibraryid_value)
        edges.push({
          from: key,
          to: C.key('canvasapp', r._onclickeventformulacomponentlibraryid_value),
          evidence: 'Explicit definition reference',
          reason: 'Formula library; body unresolved',
          source,
        });
    } else
      node.actions.push({
        type: r.onclickeventtype === 0 ? 'None' : 'Unresolved',
        value: r.onclickeventtype,
      });
    if (r._visibilityformulacomponentlibraryid_value)
      edges.push({
        from: key,
        to: C.key('canvasapp', r._visibilityformulacomponentlibraryid_value),
        evidence: 'Explicit definition reference',
        reason: 'Visibility formula library; body unresolved',
        source,
      });
    node.coverage =
      r.onclickeventtype === 1
        ? 'Formula references collected; body unavailable'
        : 'Action references collected; runtime execution not verified';
    const placement = {
      id: id + ':' + (node.appId || 'unknown') + ':' + node.location,
      commandKey: key,
      table,
      appId: node.appId,
      location: node.location,
      hidden: node.hidden,
      disabled: node.disabled,
      source,
    };
    edges.push({
      from: C.key('commandbar', placement.id),
      to: key,
      evidence: 'Command placement',
      reason: node.location,
      source,
      placementId: placement.id,
    });
    return { node, edges, placement };
  }
  async function unzipXml(base64) {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
      v = new DataView(bytes.buffer);
    let end = bytes.length - 22;
    while (end >= Math.max(0, bytes.length - 65557) && v.getUint32(end, true) !== 0x06054b50) end--;
    if (end < 0 || v.getUint32(end, true) !== 0x06054b50)
      throw Error('Unsupported ribbon compression: ZIP expected');
    const count = v.getUint16(end + 10, true);
    let pos = v.getUint32(end + 16, true);
    const results = [];
    for (let i = 0; i < count; i++) {
      if (v.getUint32(pos, true) !== 0x02014b50) throw Error('Invalid ribbon ZIP directory');
      const flags = v.getUint16(pos + 8, true),
        method = v.getUint16(pos + 10, true),
        size = v.getUint32(pos + 20, true),
        unpacked = v.getUint32(pos + 24, true),
        nameLen = v.getUint16(pos + 28, true),
        extra = v.getUint16(pos + 30, true),
        comment = v.getUint16(pos + 32, true),
        offset = v.getUint32(pos + 42, true),
        name = new TextDecoder().decode(bytes.slice(pos + 46, pos + 46 + nameLen));
      pos += 46 + nameLen + extra + comment;
      if (!name.toLowerCase().endsWith('.xml')) continue;
      if (flags & 1 || unpacked > 32 * 1024 * 1024)
        throw Error('Unsupported encrypted/oversized ribbon ZIP');
      if (v.getUint32(offset, true) !== 0x04034b50) throw Error('Invalid ribbon ZIP entry');
      const start = offset + 30 + v.getUint16(offset + 26, true) + v.getUint16(offset + 28, true);
      let data = bytes.slice(start, start + size);
      if (method === 8)
        data = new Uint8Array(
          await new Response(
            new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')),
          ).arrayBuffer(),
        );
      else if (method !== 0) throw Error('Unsupported ribbon ZIP method');
      if (data.length !== unpacked) throw Error('Ribbon ZIP length mismatch');
      results.push(new TextDecoder().decode(data));
    }
    if (!results.length) throw Error('Ribbon ZIP has no XML definition');
    return results;
  }
  function focusedClassic(records) {
    const commands = new Map(),
      rules = new Map(),
      labels = new Map(),
      buttons = new Map(),
      notes = [];
    const k = (t, id) => (t || '(global)') + ':' + id;
    const docs = [];
    for (const r of records) {
      try {
        const d = xml('<root>' + r.rdx + '</root>');
        docs.push([r, d]);
        for (const e of d.querySelectorAll('CommandDefinition')) {
          const id = k(r.entity, e.getAttribute('Id'));
          if (!commands.has(id)) commands.set(id, []);
          commands.get(id).push(e);
        }
        for (const e of d.querySelectorAll('DisplayRule[Id],EnableRule[Id]'))
          if (e.children.length) {
            const id = k(r.entity, e.getAttribute('Id'));
            if (!rules.has(id)) rules.set(id, []);
            rules.get(id).push(e);
          }
        for (const e of d.querySelectorAll('LocLabel[Id]'))
          labels.set(
            k(r.entity, e.getAttribute('Id')),
            e.querySelector('Title')?.getAttribute('description'),
          );
      } catch (e) {
        notes.push('Ribbon definition ' + r.ribbondiffid + ': ' + e.message);
      }
    }
    for (const [r, d] of docs)
      for (const e of d.querySelectorAll(
        'Button[Command],SplitButton[Command],FlyoutAnchor[Command]',
      )) {
        const table = r.entity || '(global)',
          command = e.getAttribute('Command'),
          id = e.getAttribute('Id');
        if (!id) continue;
        const key = k(table, id + ':' + command);
        if (!buttons.has(key))
          buttons.set(key, {
            key,
            type: 'Classic / legacy button',
            name: e.getAttribute('LabelText') || id,
            logicalName: id,
            table,
            command,
            sourceIds: [],
            solutionIds: [],
            layerEvidence: [],
            dependencies: [],
            dependencyNotes: [],
            componentType: 55,
          });
        const b = buttons.get(key);
        b.layerEvidence.push({ solutionId: r.solutionid, isManaged: r.ismanaged });
        if (r.ribbondiffid) b.sourceIds.push(r.ribbondiffid);
        if (r.solutionid) b.solutionIds.push(r.solutionid);
      }
    for (const b of buttons.values()) {
      if (b.name.startsWith('$LocLabels:'))
        b.name = labels.get(k(b.table, b.name.slice(11))) || b.logicalName;
      const deps = new Set(['Command: ' + b.command]),
        visited = new Set();
      const walk = (e) => {
        for (const a of [e, ...e.querySelectorAll('*')]) {
          if (a.getAttribute('Library')) {
            const library = a.getAttribute('Library').replace(/^\$webresource:/i, '');
            deps.add(
              (/^\/_(?:static|common)\//i.test(library) ? 'Platform script: ' : 'Script: ') +
                library +
                (a.getAttribute('FunctionName')
                  ? ' → ' + a.getAttribute('FunctionName')
                  : ' / rule'),
            );
          }
          if (a.tagName === 'ValueRule' && a.getAttribute('Field'))
            deps.add('Field: ' + b.table + '.' + a.getAttribute('Field'));
          if (['DisplayRule', 'EnableRule'].includes(a.tagName) && a.getAttribute('Id')) {
            const id = a.getAttribute('Id');
            deps.add(a.tagName + ': ' + id);
            if (!visited.has(id)) {
              visited.add(id);
              for (const def of rules.get(k(b.table, id)) || rules.get(k('(global)', id)) || [])
                walk(def);
            }
          }
        }
      };
      const defs =
        commands.get(k(b.table, b.command)) || commands.get(k('(global)', b.command)) || [];
      for (const d of defs) walk(d);
      if (!defs.length) b.dependencyNotes.push('Command body not returned in ribbon definitions.');
      b.dependencies = [...deps];
      b.sourceIds = [...new Set(b.sourceIds)];
      b.solutionIds = [...new Set(b.solutionIds)];
    }
    return { rows: [...buttons.values()], notes };
  }
  function definitionOrigin(evidence, solutions) {
    const microsoft = new Set([
      'd21aab70-79e7-11dd-8874-00188b01e34f',
      'd21aab72-79e7-11dd-8874-00188b01e34f',
    ]);
    if (evidence.some((e) => e.isManaged === false))
      return {
        origin: 'Custom',
        originReason:
          'Includes an unmanaged definition or customization; exclusive introducing ownership is not asserted.',
      };
    if (
      evidence.length &&
      evidence.every(
        (e) =>
          e.isManaged === true &&
          microsoft.has(
            solutions.get(String(e.solutionId).toLowerCase())?._publisherid_value?.toLowerCase(),
          ),
      )
    )
      return {
        origin: 'Out of the box',
        originReason:
          'Returned managed definitions use a recognized Microsoft publisher ID; historical layer completeness is not asserted.',
      };
    return {
      origin: 'Not verified',
      originReason:
        'Returned definition evidence does not establish Custom or Microsoft out-of-the-box origin. Managed status and membership alone are insufficient.',
    };
  }
  function solutionLayers(records, componentId, solutions) {
    return records
      .map((x) => {
        let attrs = [];
        try {
          attrs = JSON.parse(x.msdyn_componentjson || '{}').Attributes || [];
        } catch {}
        const value = (k) => attrs.find((a) => a.Key === k)?.Value;
        const sid = value('solutionid');
        const solution =
          solutions.get(String(sid).toLowerCase()) ||
          [...solutions.values()].find(
            (s) => s.uniquename?.toLowerCase() === x.msdyn_solutionname?.toLowerCase(),
          );
        return {
          componentId,
          order: Number.isFinite(x.msdyn_order) ? x.msdyn_order : null,
          solutionId: solution?.solutionid || sid || null,
          solutionName: solution?.friendlyname || x.msdyn_solutionname || 'Not returned',
          uniqueName: x.msdyn_solutionname || '',
          version: solution?.version || null,
          managed:
            typeof solution?.ismanaged === 'boolean'
              ? solution.ismanaged
              : typeof value('ismanaged') === 'boolean'
                ? value('ismanaged')
                : null,
          managementEvidence:
            typeof solution?.ismanaged === 'boolean'
              ? 'Solution metadata'
              : 'Component-layer metadata',
          publisher: x.msdyn_publishername || '',
          evidence: 'Platform component-layer service',
        };
      })
      .sort(
        (a, b) =>
          a.componentId.localeCompare(b.componentId) ||
          (a.order ?? Infinity) - (b.order ?? Infinity),
      );
  }

  // Each ribbon item is audited independently: a managed button may reference an unmanaged command/rule.
  function ribbonAudit(records, parents = []) {
    const items = new Map(),
      notes = [],
      contexts = new Set(),
      normal = (e) =>
        JSON.stringify([
          e.tagName,
          [...e.attributes].map((a) => [a.name, a.value]).sort((a, b) => a[0].localeCompare(b[0])),
          [...e.childNodes]
            .filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim()))
            .map((n) => (n.nodeType === 1 ? JSON.parse(normal(n)) : n.textContent.trim())),
        ]);
    for (const r of records) {
      const table = r.entity || '(global)';
      contexts.add(table);
      try {
        const d = xml('<root>' + r.rdx + '</root>');
        for (const e of d.querySelectorAll(
          'Button[Id],SplitButton[Id],FlyoutAnchor[Id],CommandDefinition[Id],RuleDefinitions > DisplayRules > DisplayRule[Id],RuleDefinitions > EnableRules > EnableRule[Id],root > DisplayRule[Id],root > EnableRule[Id],HideCustomAction',
        )) {
          const tag = e.tagName,
            id =
              e.getAttribute('Id') || e.getAttribute('HideActionId') || e.getAttribute('Location');
          if (!id) continue;
          const key = table + ':' + tag + ':' + id;
          if (!items.has(key)) items.set(key, { key, table, tag, id, definitions: [] });
          items.get(key).definitions.push({
            sourceId: r.ribbondiffid,
            sourceLogicalName: r.sourceLogicalName || 'ribbondiff',
            solutionId: r.solutionid,
            isManaged: r.ismanaged,
            xml: new XMLSerializer().serializeToString(e),
            canonical: normal(e),
            command: e.getAttribute('Command'),
            rules: [...e.querySelectorAll('DisplayRule[Id],EnableRule[Id]')].map((x) =>
              x.getAttribute('Id'),
            ),
            dependencies: [...e.querySelectorAll('[Library]')]
              .map(
                (x) =>
                  (/^\/_(?:static|common)\//i.test(x.getAttribute('Library'))
                    ? 'Platform script: '
                    : 'Script: ') +
                  x.getAttribute('Library').replace(/^\$webresource:/i, '') +
                  (x.getAttribute('FunctionName') ? ' → ' + x.getAttribute('FunctionName') : ''),
              )
              .concat(
                [...e.querySelectorAll('ValueRule[Field]')].map(
                  (x) => 'Field: ' + table + '.' + x.getAttribute('Field'),
                ),
                tag === 'HideCustomAction'
                  ? ['Target control: ' + (e.getAttribute('Location') || 'Not returned')]
                  : [],
              ),
          });
        }
      } catch (e) {
        notes.push('Audit definition ' + r.ribbondiffid + ': ' + e.message);
      }
    }
    const findings = [];
    for (const item of items.values()) {
      const unmanaged = item.definitions.filter((d) => d.isManaged === false),
        managed = item.definitions.filter((d) => d.isManaged === true),
        unknown = item.definitions.some((d) => typeof d.isManaged !== 'boolean');
      let finding = 'No unmanaged definition observed',
        reason =
          'Returned item definitions are managed; lower/hidden layer completeness is not established.';
      if (unmanaged.length && managed.length) {
        const differs = unmanaged.some((u) => managed.every((m) => u.canonical !== m.canonical));
        finding = differs ? 'Unmanaged override' : 'Unmanaged duplicate';
        reason = differs
          ? 'Unmanaged and managed definitions of the same table, item kind and ID differ.'
          : 'An unmanaged definition matches an observed managed definition; it still occupies the unmanaged layer.';
      } else if (unmanaged.length) {
        finding =
          item.tag === 'HideCustomAction'
            ? 'Unmanaged hide action'
            : 'Unmanaged creation candidate';
        reason =
          'An unmanaged item definition was returned. No managed definition of this same item was returned; creation versus an override of an unavailable baseline is not verified.';
      } else if (unknown) {
        finding = 'Not verified';
        reason = 'One or more returned item definitions lack a management flag.';
      }
      Object.assign(item, {
        finding,
        reason,
        unmanaged: unmanaged.length > 0,
        managed: managed.length > 0,
      });
      if (
        !['Button', 'SplitButton', 'FlyoutAnchor'].includes(item.tag) &&
        (unmanaged.length || unknown || item.tag === 'HideCustomAction')
      )
        findings.push({
          key: 'audit:' + item.key,
          type:
            item.tag === 'CommandDefinition'
              ? 'Classic command'
              : item.tag === 'HideCustomAction'
                ? 'Classic hide action'
                : 'Classic rule',
          name: item.id,
          logicalName: item.id,
          table: item.table,
          sourceIds: [...new Set(item.definitions.map((d) => d.sourceId).filter(Boolean))],
          solutionIds: [...new Set(item.definitions.map((d) => d.solutionId).filter(Boolean))],
          layerEvidence: item.definitions.map((d) => ({
            solutionId: d.solutionId,
            isManaged: d.isManaged,
          })),
          auditItem: item,
          auditFinding: finding,
          auditReason: reason,
          unmanagedObserved: item.unmanaged,
          sourceLogicalName: item.definitions[0].sourceLogicalName,
          dependencies: [
            ...new Set(
              item.definitions.flatMap((d) => [
                ...d.dependencies,
                ...d.rules.map((id) => 'Rule: ' + id),
              ]),
            ),
          ],
          dependencyNotes: [],
        });
    }
    for (const p of parents.filter((p) => p.ismanaged === false))
      findings.push({
        key: 'ribbonparent:' + p.ribboncustomizationid,
        type: 'Ribbon audit gap',
        name: 'Unmanaged ribbon parent',
        logicalName: p.ribboncustomizationid,
        table: p.entity || '(global)',
        sourceIds: [p.ribboncustomizationid],
        solutionIds: [p.solutionid].filter(Boolean),
        layerEvidence: [{ solutionId: p.solutionid, isManaged: false }],
        sourceLogicalName: 'ribboncustomization',
        auditFinding: 'Unmanaged ribbon parent — review required',
        auditReason:
          'The parent ribbon is unmanaged. This alone does not prove a button change. Child definitions and exported RibbonDiffXml must be reviewed before declaring it clean.',
        unmanagedObserved: true,
        dependencies: [],
        dependencyNotes: [],
      });
    return { items, rows: findings, notes, contexts: [...contexts] };
  }
  function applyRibbonAudit(rows, audit) {
    for (const r of rows.filter((r) => r.type === 'Classic / legacy button')) {
      const control = [...audit.items.values()].find(
        (i) =>
          i.table === r.table &&
          i.id === r.logicalName &&
          ['Button', 'SplitButton', 'FlyoutAnchor'].includes(i.tag),
      );
      const command =
        [...audit.items.values()].find(
          (i) => i.table === r.table && i.id === r.command && i.tag === 'CommandDefinition',
        ) ||
        [...audit.items.values()].find(
          (i) => i.table === '(global)' && i.id === r.command && i.tag === 'CommandDefinition',
        );
      const ruleIds = new Set([
          ...(command?.definitions.flatMap((d) => d.rules) || []),
          ...(r.dependencies || [])
            .filter((d) => /^(DisplayRule|EnableRule): /.test(d))
            .map((d) => d.split(': ').slice(1).join(': ')),
        ]),
        affected = [
          command,
          ...[...audit.items.values()].filter(
            (i) => (i.table === r.table || i.table === '(global)') && ruleIds.has(i.id),
          ),
        ].filter((i) => i?.unmanaged);
      r.auditItem = control;
      r.auditFinding = control?.finding || 'Not verified';
      r.auditReason = control?.reason || 'No item definition returned.';
      r.unmanagedObserved = !!control?.unmanaged || !!affected.length;
      if (affected.length) {
        if (!control?.unmanaged) r.auditFinding = 'Affected by unmanaged command/rule';
        r.auditReason +=
          ' Referenced unmanaged items: ' +
          affected.map((i) => i.tag + ' ' + i.id + ' (' + i.finding + ')').join('; ');
      }
    }
  }
  function mergeLayerDefinitions(row, records, componentId, solutions) {
    if (!row.auditItem) return;
    const fragments = row.auditItem.definitions.map((d) => ({
      ribbondiffid: d.sourceId,
      entity: row.table === '(global)' ? null : row.table,
      rdx: d.xml,
      solutionid: d.solutionId,
      ismanaged: d.isManaged,
      sourceLogicalName: d.sourceLogicalName,
    }));
    let added = false;
    for (const record of records) {
      let attrs;
      try {
        attrs = JSON.parse(record.msdyn_componentjson || '{}').Attributes;
      } catch {
        continue;
      }
      if (!Array.isArray(attrs)) continue;
      const summary = solutionLayers([record], componentId, solutions)[0];
      for (const a of attrs) {
        if (
          !['commanddefinition', 'ruledefinition', 'rdx', 'ribbondiffxml'].includes(
            String(a.Key).toLowerCase(),
          ) ||
          typeof a.Value !== 'string'
        )
          continue;
        fragments.push({
          ribbondiffid: componentId,
          entity: row.table === '(global)' ? null : row.table,
          rdx: a.Value.replace(/<\?xml[^?]*\?>/g, ''),
          solutionid: summary.solutionId,
          ismanaged: summary.managed,
          sourceLogicalName: row.sourceLogicalName || 'ribbondiff',
        });
        added = true;
      }
    }
    if (!added) return;
    const result = ribbonAudit(fragments),
      item = result.items.get(row.auditItem.key);
    if (!item) return;
    const seen = new Set();
    item.definitions = item.definitions.filter((d) => {
      const key = d.solutionId + ':' + d.isManaged + ':' + d.canonical;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    row.auditItem = item;
    row.auditFinding = item.finding;
    row.auditReason = item.reason;
    row.unmanagedObserved = item.unmanaged;
  }
  function layerAudit(row) {
    if (row.auditItem || row.sourceLogicalName === 'ribboncustomization') return;
    const evidence = [
        ...(row.layerEvidence || []),
        ...(row.layers || []).map((l) => ({ isManaged: l.managed })),
      ],
      u = evidence.some((e) => e.isManaged === false),
      m = evidence.some((e) => e.isManaged === true);
    row.unmanagedObserved = u;
    row.auditFinding = u
      ? m
        ? 'Unmanaged layer over managed component'
        : 'Unmanaged creation candidate'
      : 'Not verified';
    row.auditReason = u
      ? m
        ? 'Both unmanaged and managed layers are observed for this component. Definition differences require review.'
        : 'Unmanaged definition observed; absence of a managed baseline does not prove this was newly created.'
      : 'No unmanaged definition observed in available evidence; a complete absence audit is not established.';
    if (row.layerStatus?.startsWith('Layer lookup incomplete'))
      row.auditReason += ' ' + row.layerStatus;
  }

  const api = {
    xml,
    classic,
    modern,
    unzipXml,
    focusedClassic,
    definitionOrigin,
    solutionLayers,
    ribbonAudit,
    applyRibbonAudit,
    mergeLayerDefinitions,
    layerAudit,
  };
  if (typeof module !== 'undefined') module.exports = api;
  else root.DECommands = api;
})(globalThis);
