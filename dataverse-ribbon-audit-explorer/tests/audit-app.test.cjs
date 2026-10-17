const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { JSDOM } = require('jsdom');
async function run(denyDiffs) {
  const dom = new JSDOM(fs.readFileSync('src/index.html', 'utf8'), {
      runScripts: 'outside-only',
      url: 'https://example.test',
    }),
    w = dom.window,
    urls = [];
  w.GetGlobalContext = () => ({ getClientUrl: () => 'https://example.test' });
  w.AbortController = AbortController;
  const id = '11111111-1111-1111-1111-111111111111',
    sid = '22222222-2222-2222-2222-222222222222';
  let csv = '';
  w.Blob = class {
    constructor(parts) {
      csv = parts.join('');
    }
  };
  w.URL.createObjectURL = () => 'blob:test';
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = () => {};
  w.fetch = async (url) => {
    urls.push(url);
    let value = [];
    if (url.includes('solutions?'))
      value = [{ solutionid: sid, friendlyname: 'Active', ismanaged: false }];
    else if (url.includes('ribbondiffs?')) {
      if (denyDiffs) return { ok: false, status: 403, text: async () => 'Denied' };
      value = [
        {
          ribbondiffid: id,
          entity: null,
          solutionid: sid,
          ismanaged: false,
          rdx: '<HideCustomAction HideActionId="hide" Location="global.button"/>',
        },
      ];
    } else if (url.includes('ribboncommands?'))
      value = [
        {
          ribboncommandid: id,
          entity: 'vendor_hidden',
          solutionid: sid,
          ismanaged: false,
          commanddefinition:
            '<CommandDefinition Id="new.command"><Actions><JavaScriptFunction Library="$webresource:vendor.js" FunctionName="Run"/></Actions></CommandDefinition>',
        },
      ];
    else if (url.includes('ribbonrules?'))
      value = [
        {
          ribbonruleid: id,
          entity: 'vendor_hidden',
          solutionid: sid,
          ismanaged: false,
          ruledefinition: '<EnableRule Id="new.rule"><BoolRule Default="true"/></EnableRule>',
        },
      ];
    else if (url.includes('ribboncustomizations?'))
      value = [{ ribboncustomizationid: id, entity: null, solutionid: sid, ismanaged: false }];
    else if (url.includes('EntityDefinitions?'))
      value = [
        { LogicalName: 'vendor_hidden', MetadataId: id },
        { LogicalName: 'without_definitions', MetadataId: sid },
      ];
    else if (url.includes('/Attributes?'))
      value = [
        {
          LogicalName: url.includes("'appaction'") ? 'appactionid' : 'canvasappid',
          IsValidForRead: true,
          AttributeType: 'String',
        },
      ];
    return { ok: true, json: async () => ({ value }) };
  };
  for (const f of ['core', 'transport', 'commands', 'app'])
    w.eval(fs.readFileSync('src/' + f + '.js', 'utf8'));
  await w.document.getElementById('scan').onclick();
  const text = w.document.getElementById('list').textContent;
  assert.match(text, /new.command/);
  assert.match(text, /new.rule/);
  assert.match(text, /Unmanaged creation candidate/);
  assert.match(text, /Unmanaged ribbon parent/);
  assert.match(text, /No full stack returned/);
  assert.match(w.document.getElementById('coverage').textContent, /2 table names/);
  assert(
    !urls
      .filter((u) => /\/(ribbondiffs|ribboncommands|ribbonrules|ribboncustomizations)\?/.test(u))
      .some((u) => u.includes('$filter')),
  );
  if (denyDiffs) {
    assert.match(w.document.getElementById('notelist').textContent, /ribbondiffs: 403/);
    assert.match(w.document.getElementById('coverage').textContent, /Coverage incomplete/);
  } else assert.match(text, /Unmanaged hide action/);
  w.document.getElementById('audit').value = 'unmanaged';
  w.document.getElementById('audit').oninput();
  assert(w.document.querySelectorAll('tbody tr').length >= 3);
  w.document.getElementById('export').onclick();
  assert.match(csv, /auditFinding/);
  assert.match(csv, /itemDefinitions/);
  assert.match(csv, /vendor.js/);
  w.document.getElementById('exportcoverage').onclick();
  assert.match(csv, /Application Ribbon/);
  assert.match(csv, /without_definitions/);
  assert.match(csv, /not a clean bill of health/);
  dom.window.close();
}
(async () => {
  await run(false);
  await run(true);
  console.log(
    'Audit app integration passed: unfiltered all-table discovery, standalone items without button rows, Application Ribbon hide/parent, automatic layer gaps, independent sources after denial, audit filter, item evidence CSV and complete table roster coverage CSV.',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
