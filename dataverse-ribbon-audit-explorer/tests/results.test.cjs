const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { JSDOM } = require('jsdom');
const dom = new JSDOM('', { runScripts: 'outside-only' }),
  w = dom.window;
for (const f of ['core', 'commands']) w.eval(fs.readFileSync('src/' + f + '.js', 'utf8'));
const records = [
  {
    ribbondiffid: 'one',
    entity: 'account',
    solutionid: 'solution1',
    rdx: '<Button Id="button" Command="run" LabelText="$LocLabels:label"/><LocLabel Id="label"><Titles><Title description="Friendly button"/></Titles></LocLabel><CommandDefinition Id="run"><EnableRules><EnableRule Id="rule"/></EnableRules><Actions><JavaScriptFunction Library="$Webresource:custom.js" FunctionName="Run"/></Actions></CommandDefinition><EnableRule Id="rule"><CustomRule Library="/_static/test.js" FunctionName="Enabled"/></EnableRule>',
  },
  {
    ribbondiffid: 'two',
    entity: 'account',
    solutionid: 'solution2',
    rdx: '<Button Id="button" Command="run"/>',
  },
  {
    ribbondiffid: 'three',
    entity: 'account',
    solutionid: 'solution1',
    rdx: '<MenuSection Id="not.a.button" Command="menu"/>',
  },
];
const result = w.DECommands.focusedClassic(records);
assert.equal(result.rows.length, 1);
const b = result.rows[0];
assert.equal(b.name, 'Friendly button');
assert.equal(b.solutionIds.length, 2);
assert.equal(b.sourceIds.length, 2);
assert(b.dependencies.some((d) => d.includes('Script: custom.js')));
assert(b.dependencies.some((d) => d.includes('Platform script: /_static/test.js')));
assert(!b.dependencies.some((d) => /unresolved/i.test(d)));
assert.equal(w.DECommands.focusedClassic([{ rdx: '<!DOCTYPE bad><Button/>' }]).notes.length, 1);
const sources = new Map([
  ['ms', { _publisherid_value: 'd21aab70-79e7-11dd-8874-00188b01e34f' }],
  ['third', { _publisherid_value: 'other' }],
]);
assert.equal(
  w.DECommands.definitionOrigin([{ solutionId: 'ms', isManaged: true }], sources).origin,
  'Out of the box',
);
assert.equal(
  w.DECommands.definitionOrigin([{ solutionId: 'third', isManaged: true }], sources).origin,
  'Not verified',
);
assert.equal(
  w.DECommands.definitionOrigin([{ solutionId: 'third', isManaged: false }], sources).origin,
  'Custom',
);
assert.equal(
  w.DECommands.definitionOrigin(
    [
      { solutionId: 'ms', isManaged: true },
      { solutionId: 'third', isManaged: false },
    ],
    sources,
  ).origin,
  'Custom',
);
assert.equal(w.DECommands.definitionOrigin([], sources).origin, 'Not verified');
const layers = w.DECommands.solutionLayers(
  [
    { msdyn_order: 2, msdyn_solutionname: 'unknown', msdyn_componentjson: 'not JSON' },
    {
      msdyn_order: 1,
      msdyn_solutionname: 'known',
      msdyn_componentjson: JSON.stringify({ Attributes: [{ Key: 'solutionid', Value: 'sol' }] }),
    },
  ],
  'component',
  new Map([
    [
      'sol',
      {
        solutionid: 'sol',
        friendlyname: 'Known',
        uniquename: 'known',
        ismanaged: false,
        version: '1.0',
      },
    ],
  ]),
);
assert.equal(layers[0].order, 1);
assert.equal(layers[0].managed, false);
assert.equal(layers[1].managed, null);
assert.equal(layers[0].solutionName, 'Known');
console.log(
  'Focused ribbon regression passed: exact buttons only, duplicate layers merged, solutions retained, labels, scripts, rule references, platform scripts external and unsafe XML rejected.',
);
dom.window.close();
