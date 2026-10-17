/* Synthetic metadata only. This file is never packaged into the Dataverse solution. */
(function () {
  'use strict';
  const ids = {
    base: '11111111-1111-4111-8111-111111111111',
    active: '22222222-2222-4222-8222-222222222222',
    table: '33333333-3333-4333-8333-333333333333',
    diff: '44444444-4444-4444-8444-444444444444',
    command: '55555555-5555-4555-8555-555555555555',
    modern: '66666666-6666-4666-8666-666666666666',
    global: '77777777-7777-4777-8777-777777777777',
    page: '88888888-8888-4888-8888-888888888888',
  };
  const baseCommand =
    '<CommandDefinition Id="demo.approve"><EnableRules><EnableRule Id="demo.canApprove"/></EnableRules><Actions><JavaScriptFunction Library="$webresource:demo_base.js" FunctionName="Approve"/></Actions></CommandDefinition>';
  const customCommand =
    '<CommandDefinition Id="demo.approve"><EnableRules><EnableRule Id="demo.canApprove"/></EnableRules><Actions><JavaScriptFunction Library="$webresource:demo_custom.js" FunctionName="Approve"/></Actions></CommandDefinition>';
  const schema = (names) =>
    names.map((LogicalName) => ({
      LogicalName,
      IsValidForRead: true,
      AttributeType: LogicalName === 'contextentity' ? 'Lookup' : 'String',
    }));
  window.GetGlobalContext = () => ({ getClientUrl: () => 'https://example.test' });
  window.fetch = async (path) => {
    const url = new URL(path);
    if (url.origin !== 'https://example.test')
      throw Error('The synthetic demo does not connect to Dataverse.');
    let value;
    const p = url.pathname.split('/').pop();
    if (p === 'solutions')
      value = [
        {
          solutionid: ids.base,
          friendlyname: 'Example Managed Release',
          uniquename: 'ExampleManagedRelease',
          ismanaged: true,
          version: '2.0.0.0',
        },
        {
          solutionid: ids.active,
          friendlyname: 'Example Active Layer',
          uniquename: 'ExampleActiveLayer',
          ismanaged: false,
          version: '1.0.0.0',
        },
      ];
    else if (p === 'ribbondiffs')
      value = [
        {
          ribbondiffid: ids.diff,
          entity: 'account',
          solutionid: ids.base,
          ismanaged: true,
          rdx:
            '<Button Id="demo.approve.button" Command="demo.approve" LabelText="Approve account"/>' +
            baseCommand +
            '<EnableRule Id="demo.canApprove"><BoolRule Default="true"/></EnableRule>',
        },
        {
          ribbondiffid: ids.command,
          entity: 'demo_request',
          solutionid: ids.active,
          ismanaged: false,
          rdx: '<Button Id="demo.new.button" Command="demo.new" LabelText="New request action"/><CommandDefinition Id="demo.new"><Actions><JavaScriptFunction Library="$webresource:demo_request.js" FunctionName="Process"/></Actions></CommandDefinition>',
        },
        {
          ribbondiffid: ids.global,
          entity: null,
          solutionid: ids.active,
          ismanaged: false,
          rdx: '<HideCustomAction HideActionId="demo.hide.global" Location="demo.global.control"/>',
        },
      ];
    else if (p === 'ribboncommands')
      value = [
        {
          ribboncommandid: ids.command,
          entity: 'account',
          solutionid: ids.active,
          ismanaged: false,
          commanddefinition: customCommand,
        },
      ];
    else if (p === 'ribbonrules')
      value = [
        {
          ribbonruleid: ids.command,
          entity: 'demo_request',
          solutionid: ids.active,
          ismanaged: false,
          ruledefinition:
            '<EnableRule Id="demo.ready"><ValueRule Field="statuscode" Value="1"/></EnableRule>',
        },
      ];
    else if (p === 'ribboncustomizations')
      value = [
        {
          ribboncustomizationid: ids.global,
          entity: null,
          solutionid: ids.active,
          ismanaged: false,
        },
      ];
    else if (p === 'EntityDefinitions')
      value = [
        { LogicalName: 'account', MetadataId: ids.table },
        { LogicalName: 'demo_request', MetadataId: ids.command },
        { LogicalName: 'contact', MetadataId: ids.global },
      ];
    else if (p === 'Attributes' && url.pathname.includes("'appaction'"))
      value = schema([
        'appactionid',
        'name',
        'buttonlabeltext',
        'uniquename',
        'context',
        'contextentity',
        'solutionid',
        'ismanaged',
        'onclickeventtype',
        'onclickeventjavascriptfunctionname',
      ]);
    else if (p === 'Attributes')
      value = schema([
        'canvasappid',
        'name',
        'displayname',
        'canvasapptype',
        'solutionid',
        'ismanaged',
      ]);
    else if (p === 'appactions')
      value = [
        {
          appactionid: ids.modern,
          name: 'Review request',
          buttonlabeltext: 'Review request',
          uniquename: 'demo.review',
          context: 1,
          _contextentity_value: ids.table,
          solutionid: ids.active,
          ismanaged: false,
          onclickeventtype: 0,
        },
      ];
    else if (p === 'canvasapps')
      value = [
        {
          canvasappid: ids.page,
          name: 'demo_review_page',
          displayname: 'Review page',
          canvasapptype: 2,
          solutionid: ids.base,
          ismanaged: true,
        },
      ];
    else if (p === 'solutioncomponents')
      value = [
        { objectid: ids.modern, componenttype: 372, _solutionid_value: ids.active },
        { objectid: ids.page, componenttype: 300, _solutionid_value: ids.base },
      ];
    else if (p === 'msdyn_componentlayers') {
      const filter = url.searchParams.get('$filter') || '';
      value = filter.includes('appaction')
        ? [
            {
              msdyn_order: 1,
              msdyn_solutionname: 'ExampleManagedRelease',
              msdyn_componentjson: JSON.stringify({
                Attributes: [
                  { Key: 'solutionid', Value: ids.base },
                  { Key: 'ismanaged', Value: true },
                ],
              }),
            },
            {
              msdyn_order: 2,
              msdyn_solutionname: 'ExampleActiveLayer',
              msdyn_componentjson: JSON.stringify({
                Attributes: [
                  { Key: 'solutionid', Value: ids.active },
                  { Key: 'ismanaged', Value: false },
                ],
              }),
            },
          ]
        : [];
    } else if (p.startsWith('RetrieveRequiredComponents'))
      value = [{ requiredcomponenttype: 1, requiredcomponentobjectid: ids.table }];
    else if (p.startsWith('RetrieveDependentComponents') || p === 'webresourceset') value = [];
    else throw Error('No synthetic response for ' + p);
    return { ok: true, json: async () => ({ value }) };
  };
})();
