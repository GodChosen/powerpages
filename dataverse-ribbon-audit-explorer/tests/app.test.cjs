const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { JSDOM } = require('jsdom');
const dom = new JSDOM(fs.readFileSync('src/index.html', 'utf8'), {
    runScripts: 'outside-only',
    url: 'https://example.test/WebResources/dexp_/dependency/index.html',
  }),
  w = dom.window,
  requests = [];
const ids = {
  solution: '11111111-1111-1111-1111-111111111111',
  second: '77777777-7777-7777-7777-777777777777',
  button: '22222222-2222-2222-2222-222222222222',
  modern: '33333333-3333-3333-3333-333333333333',
  page: '44444444-4444-4444-4444-444444444444',
  table: '55555555-5555-5555-5555-555555555555',
  script: '66666666-6666-6666-6666-666666666666',
};
w.GetGlobalContext = () => ({ getClientUrl: () => 'https://example.test' });
w.AbortController = AbortController;
const appSchema = [
  'appactionid',
  'ismanaged',
  'name',
  'uniquename',
  'buttonlabeltext',
  'context',
  'contextentity',
  'solutionid',
  'onclickeventtype',
  'onclickeventjavascriptwebresourceid',
  'onclickeventjavascriptfunctionname',
];
let deniedLayers = false;
w.fetch = async (url) => {
  requests.push(url);
  let value = [];
  if (url.includes('solutions?'))
    value = [
      {
        solutionid: ids.solution,
        friendlyname: 'Example solution',
        ismanaged: true,
        version: '1.0.0.0',
        _publisherid_value: 'd21aab70-79e7-11dd-8874-00188b01e34f',
      },
      {
        solutionid: ids.second,
        friendlyname: 'Local solution',
        ismanaged: false,
        version: '2.0.0.0',
      },
    ];
  else if (url.includes('ribbondiffs?'))
    value = [
      {
        ribbondiffid: ids.button,
        entity: 'account',
        ismanaged: true,
        solutionid: ids.solution,
        rdx: '<CustomAction><CommandUIDefinition><Button Id="custom.button" Command="custom.run" LabelText="Classic button"/></CommandUIDefinition></CustomAction><CommandDefinition Id="custom.run"><Actions><JavaScriptFunction Library="$Webresource:custom.js" FunctionName="run"/></Actions></CommandDefinition>',
      },
    ];
  else if (url.includes('ribboncommands?') || url.includes('ribbonrules?')) value = [];
  else if (url.includes('EntityDefinitions?'))
    value = [{ LogicalName: 'account', MetadataId: ids.table }];
  else if (url.includes("LogicalName='appaction'"))
    value = appSchema.map((LogicalName) => ({
      LogicalName,
      IsValidForRead: true,
      AttributeType: ['contextentity', 'onclickeventjavascriptwebresourceid'].includes(LogicalName)
        ? 'Lookup'
        : 'String',
    }));
  else if (url.includes("LogicalName='canvasapp'"))
    value = ['canvasappid', 'name', 'displayname', 'canvasapptype', 'solutionid'].map(
      (LogicalName) => ({ LogicalName, IsValidForRead: true, AttributeType: 'String' }),
    );
  else if (url.includes('appactions?'))
    value = [
      {
        appactionid: ids.modern,
        name: 'Modern button',
        ismanaged: false,
        solutionid: ids.solution,
        context: 1,
        _contextentity_value: ids.table,
        onclickeventtype: 2,
        _onclickeventjavascriptwebresourceid_value: ids.script,
        onclickeventjavascriptfunctionname: 'run',
      },
    ];
  else if (url.includes('canvasapps?')) {
    assert(decodeURIComponent(url).includes('canvasapptype eq 2'));
    value = [
      {
        canvasappid: ids.page,
        name: 'custom_page',
        displayname: 'Custom page',
        canvasapptype: 2,
        solutionid: ids.solution,
      },
    ];
  } else if (url.includes('solutioncomponents?'))
    value = [
      { objectid: ids.modern, componenttype: 777, _solutionid_value: ids.solution },
      { objectid: ids.modern, componenttype: 777, _solutionid_value: ids.second },
      { objectid: ids.page, componenttype: 300, _solutionid_value: ids.solution },
    ];
  else if (url.includes('webresourceset?'))
    value = [{ webresourceid: ids.script, name: 'modern.js' }];
  else if (url.includes('msdyn_componentlayers?')) {
    if (deniedLayers) return { ok: false, status: 403, text: async () => 'Layer access denied' };
    if (decodeURIComponent(url).includes(ids.modern))
      value = [
        {
          msdyn_order: 2,
          msdyn_solutionname: 'Local solution',
          msdyn_componentjson: JSON.stringify({
            Attributes: [{ Key: 'solutionid', Value: ids.second }],
          }),
        },
        {
          msdyn_order: 1,
          msdyn_solutionname: 'Example solution',
          msdyn_componentjson: JSON.stringify({
            Attributes: [{ Key: 'solutionid', Value: ids.solution }],
          }),
        },
      ];
  } else if (url.includes('RetrieveRequiredComponents'))
    value = [{ requiredcomponenttype: 1, requiredcomponentobjectid: ids.table, dependencytype: 2 }];
  return { ok: true, json: async () => ({ value }) };
};
for (const file of ['core', 'transport', 'commands', 'app'])
  w.eval(
    fs.readFileSync('src/' + file + '.js', 'utf8') +
      (file === 'app' ? '\nglobalThis.testRows=()=>rows;' : ''),
  );
(async () => {
  const el = (id) => w.document.getElementById(id);
  await el('scan').onclick();
  assert.match(el('status').textContent, /Collected 3/, el('notelist').textContent);
  assert.equal(el('list').querySelectorAll('tbody tr').length, 3);
  assert.equal(el('list').querySelectorAll('th').length, 8);
  assert.match(el('list').textContent, /Not table-bound/);
  assert.match(el('list').textContent, /Example solution: Managed/);
  assert.match(el('list').textContent, /Local solution: Unmanaged/);
  assert.match(el('list').textContent, /Example solution/);
  assert.match(el('list').textContent, /custom.js/);
  assert.match(el('list').textContent, /modern.js/);
  assert.match(el('list').textContent, /Uses: account/);
  assert.equal(w.testRows().find((r) => r.type === 'Modern command').componentType, 777);
  assert(
    !requests.some(
      (u) =>
        /systemforms|savedqueries|userqueries|\/Attributes\?/.test(u) &&
        !u.includes("LogicalName='appaction'") &&
        !u.includes("LogicalName='canvasapp'"),
    ),
  );
  assert(!w.document.getElementById('coveragepanel'));
  el('kind').value = 'Modern command';
  el('kind').oninput();
  await [...el('list').querySelectorAll('button')]
    .find((b) => b.textContent === 'Refresh layers')
    .onclick();
  const modern = w.testRows().find((r) => r.type === 'Modern command');
  assert.equal(modern.layers.length, 2);
  assert.equal(modern.layers[0].order, 1);
  assert.equal(modern.layers[0].managed, true);
  assert.equal(modern.layers[1].managed, false);
  assert.match(el('list').textContent, /2 platform layer/);
  el('kind').value = 'Classic / legacy button';
  el('kind').oninput();
  await [...el('list').querySelectorAll('button')]
    .find((b) => b.textContent === 'Load layers')
    .onclick();
  assert.match(el('list').textContent, /No full stack returned/);
  assert.match(el('list').textContent, /\(definition\)/);
  el('kind').value = 'Modern command';
  el('kind').oninput();
  deniedLayers = true;
  await [...el('list').querySelectorAll('button')]
    .find((b) => b.textContent === 'Refresh layers')
    .onclick();
  assert.match(el('list').textContent, /Layer lookup incomplete/);
  assert.match(el('list').textContent, /403/);
  deniedLayers = false;
  el('kind').value = '';
  el('kind').oninput();
  el('origin').value = 'Custom';
  el('origin').oninput();
  assert.equal(el('list').querySelectorAll('tbody tr').length, 1);
  assert.match(el('list').textContent, /Modern button/);
  el('origin').value = 'Out of the box';
  el('origin').oninput();
  assert.equal(el('list').querySelectorAll('tbody tr').length, 1);
  el('origin').value = '';
  el('origin').oninput();
  el('kind').value = 'Custom page';
  el('kind').oninput();
  assert.equal(el('list').querySelectorAll('tbody tr').length, 1);
  el('search').value = 'notpresent';
  el('search').oninput();
  assert.equal(el('list').querySelectorAll('tbody tr').length, 0);
  el('search').value = '';
  el('kind').value = '';
  const base = w.testRows()[0];
  for (let i = 0; i < 110; i++)
    w.testRows().push({ ...base, key: 'fixture' + i, name: 'Extra ' + i });
  el('kind').oninput();
  assert.equal(el('list').querySelectorAll('tbody tr').length, 50);
  el('pages').querySelector('button:last-child').click();
  assert.equal(el('list').querySelectorAll('tbody tr').length, 50);
  el('pages').querySelector('button:last-child').click();
  assert.equal(el('list').querySelectorAll('tbody tr').length, 13);
  assert(el('pages').querySelector('button:last-child').disabled);
  el('list').querySelector('th button').click();
  assert.match(el('pages').textContent, /Page 1/);
  console.log(
    'Focused app regression passed: buttons/pages only, exact solution membership, custom-page type2, dependency names, lazy modern platform type, filtering, no field/form/view inventory.',
  );
  dom.window.close();
})().catch((e) => {
  console.error(e);
  dom.window.close();
  process.exitCode = 1;
});
