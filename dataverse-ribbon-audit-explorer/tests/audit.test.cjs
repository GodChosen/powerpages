const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { JSDOM } = require('jsdom');
const dom = new JSDOM('', { runScripts: 'outside-only' }),
  w = dom.window;
for (const f of ['core', 'commands']) w.eval(fs.readFileSync('src/' + f + '.js', 'utf8'));
const cmd = w.DECommands,
  rec = (id, entity, managed, rdx, sourceLogicalName = 'ribbondiff') => ({
    ribbondiffid: id,
    entity,
    ismanaged: managed,
    solutionid: managed ? 'managed' : 'active',
    rdx,
    sourceLogicalName,
  });
const records = [
  rec(
    'base',
    'account',
    true,
    '<Button Id="existing" Command="run"/><CommandDefinition Id="run"><EnableRules><EnableRule Id="canRun"/></EnableRules><Actions><JavaScriptFunction Library="$webresource:base.js" FunctionName="Run"/></Actions></CommandDefinition><EnableRule Id="canRun"><BoolRule Default="true"/></EnableRule>',
  ),
  rec(
    'override',
    'account',
    false,
    '<CommandDefinition Id="run"><EnableRules><EnableRule Id="canRun"/></EnableRules><Actions><JavaScriptFunction Library="$webresource:custom.js" FunctionName="Run"/></Actions></CommandDefinition>',
    'ribboncommand',
  ),
  rec(
    'new',
    'vendor_table',
    false,
    '<Button Id="vendor.new" Command="vendor.run"/><CommandDefinition Id="vendor.run"><Actions/></CommandDefinition><EnableRule Id="new.rule"><BoolRule Default="true"/></EnableRule>',
  ),
  rec(
    'global',
    null,
    false,
    '<HideCustomAction HideActionId="hide.global" Location="Mscrm.Global.Existing"/>',
  ),
  rec(
    'differentTable',
    'contact',
    true,
    '<CommandDefinition Id="vendor.run"><Actions/></CommandDefinition>',
  ),
  rec(
    'duplicateBase',
    'account',
    true,
    '<CommandDefinition Id="same" Other="x"><Actions /></CommandDefinition>',
  ),
  rec(
    'duplicateActive',
    'account',
    false,
    '<CommandDefinition Other="x" Id="same">\n<Actions/>\n</CommandDefinition>',
  ),
  rec(
    'unknown',
    'account',
    undefined,
    '<CommandDefinition Id="unknown"><Actions/></CommandDefinition>',
  ),
  rec('bad', 'account', false, '<!DOCTYPE x><Button/>'),
];
const audit = cmd.ribbonAudit(records, [
  { ribboncustomizationid: 'parent', entity: null, ismanaged: false, solutionid: 'active' },
]);
const get = (table, id) => [...audit.items.values()].find((i) => i.table === table && i.id === id);
assert.equal(get('account', 'run').finding, 'Unmanaged override');
assert.equal(get('account', 'same').finding, 'Unmanaged duplicate');
assert.equal(get('vendor_table', 'vendor.run').finding, 'Unmanaged creation candidate');
assert.equal(get('(global)', 'hide.global').finding, 'Unmanaged hide action');
assert.equal(get('account', 'unknown').finding, 'Not verified');
assert.equal(audit.notes.length, 1);
assert(audit.contexts.includes('(global)'));
assert(audit.rows.some((r) => r.type === 'Classic rule' && r.logicalName === 'new.rule'));
assert(audit.rows.some((r) => r.type === 'Ribbon audit gap' && r.unmanagedObserved));
const buttons = cmd.focusedClassic(records).rows;
cmd.applyRibbonAudit(buttons, audit);
const existing = buttons.find((r) => r.logicalName === 'existing');
assert.equal(existing.auditFinding, 'Affected by unmanaged command/rule');
assert(existing.unmanagedObserved);
assert.equal(existing.auditItem.unmanaged, false);
assert.equal(
  buttons.find((r) => r.logicalName === 'vendor.new').auditFinding,
  'Unmanaged creation candidate',
);
const modern = {
  type: 'Modern command',
  layerEvidence: [{ isManaged: false }],
  layers: [{ managed: true }],
};
cmd.layerAudit(modern);
assert.equal(modern.auditFinding, 'Unmanaged layer over managed component');
modern.layers = [];
modern.layerStatus = 'Layer lookup incomplete: 403';
cmd.layerAudit(modern);
assert.equal(modern.auditFinding, 'Unmanaged creation candidate');
assert.match(modern.auditReason, /403/);
const noEvidence = { layerEvidence: [], layers: [] };
cmd.layerAudit(noEvidence);
assert.equal(noEvidence.auditFinding, 'Not verified');
const candidate = cmd.ribbonAudit([
  rec(
    'active',
    'account',
    false,
    '<CommandDefinition Id="layer.run"><Actions><JavaScriptFunction Library="$webresource:custom.js"/></Actions></CommandDefinition>',
    'ribboncommand',
  ),
]).rows[0];
cmd.mergeLayerDefinitions(
  candidate,
  [
    {
      msdyn_order: 1,
      msdyn_solutionname: 'base',
      msdyn_componentjson: JSON.stringify({
        Attributes: [
          { Key: 'ismanaged', Value: true },
          {
            Key: 'commanddefinition',
            Value:
              '<CommandDefinition Id="layer.run"><Actions><JavaScriptFunction Library="$webresource:base.js"/></Actions></CommandDefinition>',
          },
        ],
      }),
    },
  ],
  'active',
  new Map(),
);
assert.equal(candidate.auditFinding, 'Unmanaged override');
assert.equal(candidate.auditItem.definitions.length, 2);
cmd.mergeLayerDefinitions(candidate, [{ msdyn_componentjson: 'broken' }], 'active', new Map());
assert.equal(candidate.auditFinding, 'Unmanaged override');
assert(
  audit.rows
    .find((r) => r.logicalName === 'hide.global')
    .dependencies.includes('Target control: Mscrm.Global.Existing'),
);
const fieldAudit = cmd.ribbonAudit([
  rec(
    'field',
    'account',
    false,
    '<EnableRule Id="field.rule"><ValueRule Field="statuscode" Value="1"/></EnableRule>',
  ),
]);
assert(fieldAudit.rows[0].dependencies.includes('Field: account.statuscode'));
console.log(
  'Unmanaged audit passed: standalone command override, new button/command/rule candidates, global hide, equivalent XML duplicate, same-ID table isolation, managed button affected by unmanaged command, missing flags, unsafe XML, parent gap, modern layers and denied lookup.',
);
dom.window.close();
